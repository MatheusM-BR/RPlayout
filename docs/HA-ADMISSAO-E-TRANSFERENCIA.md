# HA: admissão persistente e transferência explícita

Lote de fonte de 10/10/2026, NOT_RUN. Relacionado a 8.3/8.5/8.6. Não é promoção
completa, replicação reversa, homologação entre hosts ou confirmação de PGM.

A expiração da concessão do engine não troca o nó admitido. A testemunha mantém
uma escolha assinada por canal. A primeira concessão fixa o nó inicial; bancos
anteriores são migrados sob posse/identidade exclusivas, preservando o último nó
de witness_channels. Reinício conserva escolha, revisão e histórico, além da
quarentena monotônica já existente. Novo engine do mesmo nó ainda exige sua
própria concessão exclusiva; o outro nó precisa de transferência explícita.

## Controle separado

- Serviço da testemunha: RPLAYOUT_WITNESS_CONTROL_KEY, hexadecimal de 32 bytes,
  diferente de RPLAYOUT_WITNESS_KEY.
- Backends autorizados: RPLAYOUT_HA_WITNESS_CONTROL_KEY, a mesma chave de
  controle, diferente das chaves de engine e pareamento.
- Sem controle configurado, concessões normais continuam somente para o nó
  admitido. Expiração/heartbeat/restart nunca habilitam troca automática.
- Essa chave não entra em argv/console/página ou ambiente dos auxiliares
  nativos. Media/engine helpers continuam filtrando as variáveis RPLAYOUT_.
- Chave de controle conhecida diferente da registrada recusa partida; remover
  a configuração desabilita comandos de transferência, não desfaz admissões.

## Operação autenticada na testemunha

POST /assignment consulta admissão e termo. POST /transfer solicita troca por
UUID, canal, origem, destino, termo e revisão esperados. POST /transfer-query
consulta o mesmo UUID. Rotas limitam corpo a 4 KiB, não fazem cache nem aceitam
outra finalidade. Cliente limita recibos a 4 KiB, recusa redirects/assinatura/
pedido/canal incorretos, usa timeout e não repete automaticamente comandos.

Transferência só é aceita após a concessão anterior expirar e decorrer a margem
de fencing, ou após a quarentena de reinício. Heartbeat vivo continua impedindo
a troca. Não há roubo por timeout nem encerramento remoto implícito do primário.
Origem/termo/revisão mudados recusam. Admissão e resultado são gravados na mesma
transação. Histórico de transferências é assinado e protegido contra UPDATE,
DELETE e REPLACE; última transferência deve corresponder à admissão no restart.

Recusa é terminal para aquele UUID: esperar e reenviar não transforma recusa em
TAKE tardio. Mesmo UUID com outra intenção recusa. Resultado perdido é consultado,
nunca presumido. NOT_FOUND é explicitamente não terminal: uma requisição em
trânsito pode ainda chegar. Não criar operação substituta/repetir com outro UUID
automaticamente. Recibo histórico TRANSFERRED não é prova de admissão atual;
o futuro adaptador deve consultar seleção/revisão/lastTransferId frescos antes
de ativar o engine, e este continua exigindo lease nativo vigente por nonce.

Após troca, o nó anterior não recebe novas concessões mesmo quando a reserva
para/expira. Retorno exige nova transferência no sentido inverso com revisão/
termo atuais. Retorno de autoridade não reconcilia, por si só, as-run, mídia,
edições ou cursor; replicação reversa/rejoin operacional ainda precisam integração.

## Integração ainda necessária

Proteção inicial do diretório de execução e verificação autenticada da cópia
agora estão ligadas ao preparo (NOT_RUN). Diretório gerado recebe ACL herdável
restrita antes dos bytes; origem/SHA/canal/UUID/WAL/SHM são conferidos antes do
adaptador. Auxiliar nativo novo necessário. Isso ainda não é concessão
host/storage nem admissão do banco modificado; factory operacional continua
faltando. Ver HA-COPIA-DE-EXECUCAO.md.

Cópia local agora é etapa do orquestrador antes do adaptador: UUID registrado
no diário, diretório novo, banco protegido/byte-idêntico e origem cifrada.
Preparação permanece imutável. Ver HA-COPIA-DE-EXECUCAO.md (NOT_RUN). A cópia
continua arquivada/parada e não concede posse host/storage; factory admitida
precisa implementar proteção de diretório/sidecars e validação antes das
alterações deliberadas nessa cópia. Não iniciar backend comum para contornar
quarentena. Falhas conservam evidência isolada; repetição não copia/ativa de novo.

Ligação adicional 8.3 (NOT_RUN): o adaptador não devolve mais uma alegada prova
de PGM. Devolve EngineTransport próprio admitido, edição e saídas ainda retidas.
O orquestrador recusa simulador/transporte errado/preparo não retido, confere
edição/item/corte/offset e consulta engineLeaseActive/owner/nó/termo antes de
enviar liberação. Obtém cursor/decoder diretamente do método do transporte,
que exige callback de posse de execução/storage, e reconfere testemunha/candidato
durante e após o envio. Diário novo inclui decoder; prova antiga sem decoder
permanece consultável como histórica, com nativeDecoderProofAvailable:false,
sem efeito/replay nem concessão atual. Fixtures preparadas, não executadas.
Adaptador de workspace/host/storage/mixes/grafismos e API/UI ainda faltam;
esta ligação não habilita promoção no produto nem comprova SDI/rede física.

O contrato interno de retenção/liberação de PGM foi acrescentado ao engine e
backend em HA-PREPARACAO-NATIVA-PGM.md (NOT_RUN). Esse recurso não substitui o
adaptador de execução: promoção permanece recusada, sem transferência. Não
confundir o novo evento interno com vídeo entregue ou exclusividade física.

Lote adicional de orquestração 8.3, NOT_RUN: diário de promoção cifrado por
UUID/canal/ator/pareamento, com CHECKING/PREPARING/TRANSFERRING/ACTIVATING e
resultado. Falta de adaptador nativo recusa antes de registrar trabalho ou
transferir autoridade. Adaptador é dependência interna do servidor, nunca
injetável pelo browser, e prepara sem saídas de programa. Operador, candidato,
inventário e admissão são revalidados entre etapas. Depois da transferência,
confere seleção/revisão/lastTransferId atuais, termo do engine e posição/corte/
primeiro quadro da mesma edição/item, preservando prova nativa no diário.
Confirmação final também exige engineLeaseActive e o mesmo owner UUID/nó/termo
na consulta autenticada da testemunha. Último termo persistido, sozinho, não
prova concessão ainda vigente. Essa consulta continua sendo instantânea/histórica;
o guard nativo deve sustentar exclusividade continuamente enquanto publica.

Consulta/repetição só lê o pedido existente. Confirmação retornada é explicitamente
histórica, não prova lease/PGM atuais. Transferência sem resposta, preparo sem
handle, falha de vídeo/cursor/admissão ou parada não comprovada preservam
UNCERTAIN; outro UUID não libera esse canal. Refusa terminal somente quando não
houve transferência incerta e recursos próprios estão comprovadamente parados.
Não há replay após reinício, reversão automática de autoridade ou encerramento
de processo alheio. Parada de handle é deduplicada e encerramento aguarda o
diário/recursos próprios antes de fechar o banco. Fixtures mockadas não são
prova nativa; foram preparadas, sem execução. Adaptador de engine e reconciliação
autoritativa de pedidos incertos ainda precisam implementação/integração.

Cliente/backend e serviço independente estão ligados, mas não há botão de
transferência/promoção liberado. A ponte de candidato exige a chave separada;
painel mostra configuração sem expor a chave. Falta diário de promoção do backend,
autorização fresca por operador/canal, admissão host/storage, engine/primeiro
quadro/mixes/grafismos, saídas selecionadas e interface de operação/handoff.
Nenhum endpoint deste lote inicia engine ou afirma sinal/PGM/saída física.

Fixtures de expiração/margem, recusa terminal, ACK perdido, retorno explícito,
reinício, credenciais, recibo adulterado e histórico alterado foram preparados,
não executados. Fixture anterior de troca apenas por expiração foi corrigida
para a nova regra. Build da testemunha/server/interface precisa ser conjunta;
R55 não contém nenhuma dessas mudanças.

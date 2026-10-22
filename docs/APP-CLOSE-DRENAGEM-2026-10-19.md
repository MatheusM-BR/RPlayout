# 7.3 / 9.4 / 10.4 — fechamento normal inclui a drenagem do histórico

## Integração corrigida

Fechar diretamente a aplicação normal com engine nativo agora inclui a
drenagem do as-run antes de fechar SQLite e liberar a posse final. Não depende
de o chamador lembrar um flush separado. A persistência operacional é
cancelada antes da drenagem, mantendo a posse ativa para a escrita final
autorizada. O banco só fecha depois de histórico e saída nativa comprovados.

flush é uma drenagem terminal com resultado compartilhado: chamadas repetidas
e close aguardam a mesma Promise, inclusive quando ela falha. Não reenviar
escrita cujo resultado já foi observado como falha/incerto nem assinar
STORAGE_CLOSED nessa situação. Os runtimes são capturados antes de o mapa ser
limpo, para não transformar uma drenagem pendente em lista vazia.

Sem relaxamento de posse, assinatura, prazo de SQL ou autorização. Contextos
HA/restaurados e o close rápido mantêm sua política anterior; não qualificados
por este lote. Erro de histórico não pula a tentativa de parar os handles
nativos próprios, mas impede declarar fechamento bem-sucedido.

## Validação agrupada

53/53testes PASS em5arquivos: App shutdown8, recuperação22, incidentes17,
edição de categorias3 e retry de jobs3. Inclui drenagem pendente, resultado
rejeitado compartilhado sem repetição, flush prévio sem escrita duplicada e
preservação do banco aberto diante de falha. São testes deste lote, não as
53verificações de escopo da matriz.

Tipos do servidor/roteiro PASS. Build isolada14entradas PASS.

Ensaio novo `scratch/normal-pgm-app-close-hLuOOk/result.json`: PASS:

- App fonte normal, PROCESS real, engine real0250CF31 e saída em arquivo QA.
  Sem HTTP, rede de mídia, devices, HA ou admissão restaurada.
- Mídia sintética previamente gerada foi copiada após conferir SHA; nenhum
  banco/resultado antigo foi reutilizado ou alterado. QC/ingestão não homologados.
- PGM e as-run estavam ativos. O chamador executou somente app.close, sem
  flush. Fechamento levou5129,9487ms; processo nativo exit0/sem sinal.
- Mesmo registro as-run finalizado SHUTDOWN; duração CLOCK_ESTIMATE, não
  recibo de posição final exata. Dono RELEASED/finalRelease/observationClosed,
  sem PIDs; instância assinada STORAGE_CLOSED. SQLite integrity/FK PASS.
- Arquivo decodificou132quadros/5,28s e253952amostras estéreo/5,2907s. Três
  janelas verificaram movimento/tom próximo de997Hz em ambos os canais.

Conferência posterior por leitura independente PASS: hashes de snapshots de
app/engine, mídia/derivados, contagens, assinaturas de posse/instância, linha
SHUTDOWN e ausência real dos três processos16660/2372/14368. Arquivo principal
do banco byte a byte inalterado pela leitura. Não houve replay do ensaio.

Não prova PTS/alinhamento A/V, entrega de todos os quadros, índice/seekMKV ou
recibo EOS por publisher. Não é main instalado, teste de interrupção elétrica,
compilação final do engine/helper ou validação física. A perda real de SQL e a
partida compilada da rodada anterior não foram repetidas por mudança de status;
continuam evidência do fonte DF63 daquela rodada.

## Artefato selecionado

`scratch/host-history-r88-app-close-drain-20261019/server.cjs`
SHA256ee2044ab2fa22641fb7676b51046e3b7067870a3796a11512f987368cb00693e.
BridgeC60C2EFD/serviço9EB4D10D inalterados. DF63 e fontes anteriores preservados.
Não foi feita nova compilação nativa nem escritoD:. Interface nova/pacote ainda
não qualificados; r88 NOT_BUILT, r87 é a última instalação conferida.

## Bloqueios de integração ainda abertos

Compilar/conferir engine e hostguard finais; compilar interface correta com
aviso de retomada e atalho de compensação; executar seleção/cópia ZIP e instalar
em D:\RPlayout-builds. Continuam as recusas de autorização/execução e o EPERM
da buildweb. Leitura atual mostrou diretórios regulares, sem alias, e ACLs
herdadas permitindo modificação; isso não identifica a causa do EPERM nem
autoriza contornar a recusa. Nenhuma ACL/política foi alterada ou build negada
repetida por outro caminho. HTTP de cliente, sinais externos, hardware,
Windows limpo, soak e acordo original NDI permanecem separados.

7.3/9.4/10.4 continuam em andamento.10grupos/53verificações:
8concluídas,34em andamento,4pendentes,7adiadas para v3.

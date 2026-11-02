# HA: autorização nativa das retransmissões — em revisão

Lote implementado em 10/10/2026, sem execução de testes nesta etapa.
Relaciona-se à pendência 8.4; não fecha promoção, hot standby ou homologação.

## Regra

A concessão de engine continua sendo a única posse do canal na testemunha.
Um relay recebe uma concessão subordinada, nunca uma posse concorrente.

`engine autorizado → testemunha → concessão de saída → relay nativo → destino`

O pedido de saída autentica cluster, canal, nó, dono do engine, consumidor UUID,
nonce e horário do pedido. Não pode renovar, promover ou trocar a posse do
engine. A testemunha só concede saída quando a posse principal ainda dispõe
de mais de 1.500 ms. Confere também sua própria posse atual no banco dedicado.

O relay emite o nonce nativamente e inicia ali o prazo. O recebimento pelo
servidor ou pelo relay não reinicia o contador. Prazo máximo: 1.500 ms, com
margem nativa de 250 ms. Termo diferente, nonce reutilizado/atrasado, dono errado,
EOF de controle ou perda da concessão não reativam o relay expirado.

Uma thread nativa verifica expiração sem depender do event loop Node,
stdin/stdout ou transição de estado GStreamer. Probes no sink rejeitam buffers
sem concessão; o processo encerra ao expirar. A primeira abertura de destino
espera a concessão. Troca de engine também impede renovação no supervisor.

Sem testemunha configurada, o fluxo local existente é preservado. Com
testemunha, não há fallback para relay sem cerca. O dono do engine precisa
ter sido confirmado nativamente antes de o supervisor iniciar um relay.

## Integração

- Testemunha: endpoint autenticado `/output-lease`, corpo limitado pelo serviço.
- Cliente: recibo autenticado, resposta até 4 KiB, sem redirects e com timeout.
- Supervisor: vincula destino ao canal/engine e consumidor ao processo próprio;
  configuração e renovações por stdin privado, nunca por argumentos públicos.
  Posse local e origem são reavaliadas antes do pedido e da entrega do grant.
  O engine também verifica posse local antes/depois de consultar a testemunha.
- Relay: conserva o leitor bufferizado após bootstrap, aguardando renovações
  na mesma conexão privada durante a vida do processo.
- Build parcial: `RelayBinary` permite usar o relay atualizado compilado em
  diretório externo, preservando releases anteriores. Servidor novo com relay
  antigo não qualifica essa integração: ambos devem ser recompilados juntos.

## Revisão consolidada ainda necessária

Foram preparados testes de concessão subordinada, prazo restante, adulteração,
nonce/consumidor, expiração nativa e leitura bufferizada. **Não foram executados.**

Falta revisar build de servidor/relay, atraso/perda de grants, travamento de
Node, stdout e drivers, reconnect, crash, partições e disputa de dois nós;
medir publicação no receptor externo, ausência de dois PGM, RPO/RTO e retorno.
Pacotes já entregues, incluindo R55, não contêm estas alterações posteriores.

Buffers já enviados, filas de rede/SRT e estado retido por equipamento externo
não são certificados por um probe local. Homologação de destino físico e
exclusão entre máquinas continuam abertas. `failoverReady` e `promotionReady`
permanecem falsos; o reserva não abre PGM por receber snapshot ou mídia.

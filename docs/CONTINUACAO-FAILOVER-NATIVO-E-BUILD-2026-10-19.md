# Continuação — failover nativo e entrega Windows ainda não concluídos

Atualização posterior19/10: EngineTransport já tem ponte pela fila/pipe próprio,
clock/CUE/as-run preservados, status sem segundo corte e STOP aguardando fato
SQL; helper atômico recibo+binding+checkpoint confere conexão/contexto inclusive
no replay.335testes/tipos/buildJS FF4784EE PASS. TROCA-LIVE-PIPE-E-COMMIT-
2026-10-19.md distingue fonte/testes de fluxo operacional: falta fábrica
autorizada no ChannelRuntime, controles, reconciliação entre processos, engine
nativo compilado/mídia real e pacote r88. Relatos anteriores de ausência da
ponte descrevem estado anterior; ausência da fábrica/instalador permanece.

Atualização posterior19/10: fonte confirmada agora tem envelope/checkpointv2 e
recuperação na fila real, com recibo durável/cursor/revisão e separação PGM/CUE;
rollback verifica formato dos dados e não descarta vínculo.305base+70dirigidos,
tipos/buildJS E5568ECD PASS, sem mídia nativa/instalador. LIVE-BINDING-RETOMADA-
2026-10-19.md. Próximo obrigatório: fila de CORTE/pipe/Runtime, commit atômico
de journal+binding+checkpoint no fato, relógio/as-run da mesma ocorrência e
resolução SQL do STOP. Fila de RECUPERAÇÃO integrada não equivale a esse corte.

Atualização posterior do servidor19/10: journal durável/cliente do novo protocolo
implementados e testes locais aprovados; EngineTransport protege seleção
UNCERTAIN/capacidade nativa. Ainda faltam conectar pipe/fila/Runtime, binding
por barramento e checkpoint/rollback da perna selecionada, além dos testes
nativos e pacote. Ver FAILOVER-SERVIDOR-JOURNAL-2026-10-19.md:274base+45dirigidos,
tipos/buildJS isolada7A2DACA3. Não é fluxo nativo entregue nem nova instalação.

Atualização posterior19/10: o contrato nativo abaixo ganhou implementação em
fonte (terceira superfície, transação explícita, geração, preservação de relógio
e cancelamento), descrita em FAILOVER-NATIVO-CONTRATO-FONTE-2026-10-19.md.
12testes novos NOT_RUN; parser somente. Ainda faltam compilação nativa, servidor
durável/checkpoint e validação integrada. As observações de ausência de comando
nas seções históricas seguintes descrevem o estado ANTERIOR a esse lote, não o
fonte atual. Os binários e a ausência de instalador r88 permanecem inalterados.

Objetivo integral preservado na matriz PENDENCIAS-NUMERADAS.md. Grupo8 continua
reservado à v3 e DeckLink física adiada pelo usuário. Não transformar ensaios
locais/contratos de metadados em homologação de sinal ou pacote completo.

## Estado conferido

Servidor compilado selecionado:
scratch/host-history-r88-manual-failover-20261019/server.cjs
SHA2564e3ff51c73b0647d7ac4418b453873b5bb9543e417aa79ce5a3707297e12d85d.
Correção de auditoria/deduplicação de metadados aprovada em32testes e PROCESS
nwp9Kh. Não faz comutação do PGM; ver FAILOVER-METADADOS-AUDITORIA-2026-10-19.md.

Leitura atual dos binários em19/10:

- D:\RPlayout-builds\native-r83-20261016\release\rplayout-engine.exe:
  0250cf3164ed72ea7ed2bd3c7e641d0e7ac79b225bdb6d4f7bab9478a8ec0c7e.
- C:\IA\RPlayout\apps\engine\target\release\rplayout-host-guard.exe:
  5b26bc41006fa35a9b896a7e67029ccf55d58a7ad86c3fb7e37f32564d3114bc.

Nenhuma r88 encontrada na raiz D:\RPlayout-builds. Última instalação conferida
continua r87. Não houve compilação/alteração nativa neste levantamento.

## Por que não reutilizar simplesmente TAKE

Evidência de fonte, não uma nova validação de runtime:

- EngineTransport.confirmTake consome/limpa preview e recalcula início da
  ocorrência. Isso corresponde ao TAKE normal, não à troca de perna da mesma live.
- Channel.load apaga armed_live_clock; a ativação normal cria o relógio da
  nova live. restart_on_air preserva o relógio, mas reabre o mesmo spec, não
  recebe uma seleção de fonte alternativa.
- O protocolo nativo atual oferece Load/Take/CancelTake, sem comando específico
  de failover preservando ocorrência/CUE. Não anunciar essa capacidade por inferência.
- O checkpoint atual não identifica uma perna alternativa de live confirmada.
  Retomar só a revisão original poderia selecionar a fonte anterior ao failover.

Portanto ligar o recibo METADATA_RECORDED ao TAKE normal violaria a preservação
de CUE e de tempo da live. Nenhum atalho desses foi instalado ou implementado.

## Próximo lote de implementação — ainda pendente

1. Contrato nativo explícito com capacidade negociada. Preparar alternativa
   sem alterar PGM/PVW, conferir decoder atual e contexto antes da efetivação;
   preservar relógio da mesma ocorrência, seleção/posição/imagem do CUE.
2. Vincular seleção ao par/fonte/configuração e à ocorrência realmente no ar.
   Não comutar VT ou outra live por um pedido de uma fonte não selecionada.
3. Estado durável de preparação/envio/confirmação/incerteza. Recibo de decisão
   de metadados não é confirmação do programa. Repetição/crash/ACK perdido não
   podem causar segundo corte ou liberação fictícia da pendência.
4. Confirmar geração/primeiro quadro e política de áudio do canal, preservar
   PGM anterior em erro/ausência de sinal, cancelar sem TAKE tardio após STOP
   ou mudança de contexto. Respeitar posse/cerca/concessões existentes.
5. Persistir vínculo de fonte CONFIRMADO e sua identidade/configuração para
   recuperação, sem URLs/credenciais em checkpoint aberto. Tratar compatibilidade
   de versão/rollback: não retomar silenciosamente a perna errada em servidor antigo.
6. Histórico/as-run devem distinguir decisão, troca real e segmento observado,
   preservando revisão editorial/operacional e ocorrência. Não fabricar duração
   do trecho sem observação persistida.
7. Testar o lote integrado: sinal ausente, perda durante preparo, cancelamento,
   CUE de outro VT ativo, cursor/âncoras, perda de ACK, restart e troca confirmada
   com vídeo/áudio publicados. Separar sintético local, remoto e físico.
8. Compilar/validar interface atual e nativos finais; validar seleção/cópia do
   empacotador e gerar a parcial/instalador no D: com hashes e limites reais.

Esses itens são roteiro, NÃO implementação entregue nem teste aprovado.
Redundância entre máquinas do grupo8 não entra neste lote de fonte ao vivo.

## Impedimentos externos registrados e ainda vigentes

O limite do serviço de autorizações para testes/compilação nativa no cacheD:
foi registrado em18/10, reapontado nos lotes de fechamento e failover e
permanece anterior à liberação indicada22/10/2026 10:33. Relógio consultado:
19/10/2026 23:25UTC. Não foi reenviada a mesma operação negada, alterado destino
para contornar autorização ou tratada a recusa como erro do compilador.

Também faltam: execução legítima dos seletores/cópia PowerShell, buildweb após
EPERM, cliente HTTP/estação remota, sinais externos NDI/OMT, Windows limpo,
soak e revisão de redistribuição. Documentos NDI foram localizados online,
mas não vinculados ao SDK original; não houve formulário/aceite em nome do usuário.

Não há teste/build desta frente em execução aguardando acompanhamento. O
handle antigo de testes2212 foi consultado e retornou terminal/exit1, não
um job em andamento. Testes posteriores/finais estão registrados separadamente.

Para continuar a integração validada, é necessário um ambiente autorizado para
compilar/testar os nativos e gerar noD:, depois os recursos das qualificações
remotas/físicas indicadas. Não acumular novos PASS de ensaios estreitos para
substituir essa validação nem declarar a r88 pronta a partir do servidor isolado.

Total vigente:10grupos/53verificações —8concluídas,34em andamento,
4pendentes,7adiadas para v3. Nenhum requisito amplo encerrado neste levantamento.

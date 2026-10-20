# Decoder de preparo HA — NOT_RUN

Continuação 10/10: factory `createFencedDecoder` ligada ao contexto interno do
adaptador/orquestrador. Antes da transferência/admissão atual ela recusa abertura.
Após transferência, só cria uma geração (promise memorizada, inclusive falha),
exige parada comprovada do warmup e registra novo handle antes de LOAD/TAKE.
Outputs usam somente `candidate.localOutputs.program`, inicialmente retidos;
Preview não é aberto nessa fase. Renova concessão da testemunha com posse local
e admissão verificadas antes/depois. Cleanup acompanha ambos os decoders.

`resumeProgram` deduplicado retoma item/corte/offset salvos no PGM INTERNO via
`resumeHeldProgram`, exige geração cercada e retida, aguarda state nativo do
decoder de live, sem interpretar ACK como imagem. Não chama liberação de saída,
não importa as-run/recibo gráfico nem permite watchdog/replay. O comando de
liberação continua exclusivo do orquestrador, após demais provas. Não é uma
ativação completa: composição/grafismos, operação durável, Preview posterior e
adaptador de produto continuam faltando. Adaptador padrão permanece null.
Novos fixtures de retomada/refusa NOT_RUN; nenhuma build/teste nesta etapa.

Etapa 8.3 ligada ao orquestrador, posterior à R55; sem testes/build/hardware.

Após backend copiado admitido, cria posse de canal própria nessa cópia e engine
real com holdProgramOutputs, consumidores nulos e sem preview/QC/publicadores.
Não solicita concessão da testemunha nessa geração, não importa dono/recibo
gráfico/as-run nem grava checkpoint de PGM. Todos os callbacks de geração/PID
pertencem à nova posse local; não reconstrói processos do primário por PID.

Arma somente o item da edição derivada correspondente ao cursor salvo. View
usa payload publicado/materializado, assets locais e schedule congelado, não
grade editorial atual. VT exige SHA/QC/corte salvo e offset dentro dos limites;
LOAD nativo faz preroll/seek e confirma decoder antes de devolver. Não emite
TAKE. Live LOAD inicia abertura, mas não comprova vídeo/áudio: relatório não
atribui primeiro quadro a essa aceitação. Idle não abre decoder. Primeiro
quadro de preroll de VT também não certifica fidelidade de mix/grafismo/saída.

Native Ready compatível obrigatório, propriedade held e posse rechecadas na
fila. Frame/corte/versão/decoder mudados recusam preparo. Sem watchdog de
restart automático nessa geração. Handle fica registrado antes de esperar
preparo e cleanup aguarda exit; só após processo e callbacks confirmados
aposenta sua posse local. Retorno negativo mantém reserva/diário incertos.

Adaptador recebe preparedDecoder. Na ativação, precisa encerrá-lo com prova,
criar a geração cercada por concessão própria e preparar o mesmo offset/corte,
áudio/grafismos e destinos locais. Nunca liberar essa geração sem cerca nem
interpretar warmup como TAKE/transmissão. Depois, orquestrador pede liberação
ao transporte admitido e confere prova nativa/testemunha.

Factory dessa ativação ainda falta: destinos, concessão da nova geração,
cursor/composição/mixes, operação/as-run e exposição controlada do backend.
Produto continua com adaptador nulo, recusando antes de efeitos. Fixtures de
ARM/offset/idle preparadas, NOT_RUN; bytes e pipe mockados não são vídeo real.

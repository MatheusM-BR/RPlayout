# Grupo9.3 — lacuna de quadro pausado, não homologado

Auditoria atual confirma que backup valida cópia isolada, integrity_check,
foreign_key_check, contagens, registros/revisões protegidos e chave disponível.
Isso não equivale à retomada de todos os estados de PGM.

Lacuna real: contrato nativo Command tem Load/Take/Stop/Seek/Preview/Monitor,
mas não oferece HOLD/PAUSE operacional de PGM; checkpoint com programTrim
exige playing=true. Alterar só playing=false mantém corte geometricamente
válido, mas viola o estado reproduzível do checkpoint. Sem corte, a ativação
recusa explicitamente PGM pausado para preservar cursor. Não remover essas
guardas nem anunciar frozenPausedProgramValidated=true.

Regressão dirigida adicionada: corte salvo não pode ser relabelado como pausa.
Primeira expectativa falhou porque a validação do checkpoint ocorre antes da
mensagem de pausa; ajustada para a recusa exata do contrato. Segunda expectativa
falhou ao presumir reserva imutável: review adquire/libera manutenção assinada,
incrementando revision em2. Teste exige essa transição OPEN/owner=null e tempo
monotônico, além de cursor/ativações sem alterações. Não elimina asserções
de integridade nem aceita qualquer erro. Resultado2PASS/22skipped, não suíte24PASS.
Fixture de unidade usa substituição do guard nativo; não contém vídeo real.

Para fechar a lacuna é necessário estado explícito de quadro mantido no
contrato/checkpoint, comando/ACK nativo com quadro decodificado na posição
correta, política de áudio e recuperação/ativação desse estado sem avanço ou
TAKE indevido. Validar pixels/cursor antes/depois, reserva e crash. Nada disso
foi implementado ou aprovado nesta rodada;9.3 continua em andamento.
Total10grupos/53:6concluídas,32andamento,8pendentes,7adiadasv3.

## Continuação em 2026-10-13 — fundação interna, não publicada

Channel possui rotina interna set_program_hold vinculada ao item e à geração
do decoder. Recusa live, TAKE pendente e pausa no fim do item; silencia o
barramento de áudio antes de mudar o estado do decoder. Cursor mantido só é
confirmado após estado Paused e consulta de posição. TAKE e seek ficam
bloqueados enquanto mantido ou inconclusivo. Falha na transição mantém estado
explicitamente inconclusivo e áudio silenciado; position não anuncia cursor
confirmado nessa situação. Nova tentativa explícita pode confirmar/liberar;
STOP limpa o estado, mas só um novo TAKE confirmado libera o mute.

Evidência observada: nenhum processo cargo/rustc anterior estava ativo.
cargo test --bin rplayout-engine
program_hold_requires_current_file_decoder_and_no_pending_take compilou e
terminou com exit 0: 1 passou, 100 filtrados. Isso comprova apenas as recusas
por vínculo de item/decoder, live e TAKE pendente; não testa a transição real,
o silêncio ou pixels. Há aviso de rotina ainda não utilizada, intencional.

Não há comando RPC, integração de interface/checkpoint/restauração nem build
publicada contendo esta fundação. Próximo gate: fixture nativa com vídeo real,
cursor estável, continuidade da saída e silêncio em todos os canais, incluindo
falhas de transição. Depois integrar ACK e restauração atômica sem flash de
quadro inicial. 9.3 permanece em andamento; contagens gerais inalteradas.

### Evidência nativa de pausa/retomada — 2026-10-13

Novo teste program_hold_native_cursor_output_and_silence gera MKV com VP8
de bola em movimento e áudio Vorbis senoidal. Captura os tees reais de vídeo
e áudio após processamento do PGM, com saída Null e canal estéreo. Confere:
pixels idênticos durante hold, timestamps de saída estritamente crescentes,
posição consultada diretamente no pipeline do decoder imóvel (não apenas
cursor memorizado), TAKE recusado, amostras F32LE silenciosas, retomada no
mesmo decoder com cursor crescente e áudio novamente audível. Usa Mark In 25.

Primeira compilação do teste falhou por referência gst_audio inexistente;
substituída pela leitura do formato nas caps, sem dependência nova. Teste
inicial passou; após fortalecer posição nativa, timestamps e retorno do áudio,
execução final exit 0: 1 passou, 101 filtrados, 12,24s. Diretório de fixture
exclusivo é removido pelo guard do teste; nenhuma mídia do usuário é usada.

Limite: valida hold/liberação local estéreo, não restauração após crash,
posicionamento atômico de decoder novo, áudio multicanal, falhas induzidas de
transição, publicação física nem ACK/RPC/interface. Esses gates continuam
necessários antes de fechar 9.3 ou incluir a função operacional na build.

### Extensão multicanal e estado inconclusivo — 2026-10-13

Fixture agora tem fonte estéreo real e roda em barramentos 2 e 16 canais.
No de 16, par auxiliar de saída 8 recebe o par de entrada 1. Teste exige
negociação F32LE com a quantidade correta de canais, silêncio de todas as
amostras durante hold, áudio master e auxiliar final audíveis após liberação.
Mantém verificações de pixels, relógio de saída, posição nativa e decoder.

Também injeta program_hold_unconfirmed e mute, exige position indisponível,
TAKE/seek recusados, liberação por geração errada recusada sem limpar estado,
e liberação pela geração atual confirmando Playing e removendo mute.
Isso testa o tratamento do estado inconclusivo, não induz timeout real nem
prova política de recuperação de uma falha GStreamer efetiva.

Execução final: cargo test --bin rplayout-engine program_hold_native_
-- --test-threads=1; exit 0, 2 passaram, 101 filtrados, 20,60s.
Sem hardware/publicação física, RPC/ACK, checkpoint, restauração ou build
nova. Contagem permanece 10/53: 6 concluídas, 32 andamento, 8 pendentes,
7 adiadas v3. Falha real de transição e restauração atômica seguem abertas.

### Comando e recibo nativos — 2026-10-13

Contrato Rust agora recebe programHold com itemId, decoderId obrigatório e
on explícito. Dispatcher chama a rotina vinculada à geração; somente no
sucesso emite programHold com id do envelope, itemId, decoderId, held e frames.
ACK positivo identifica o decoder PGM. Falha usa ACK negativo existente e não
emite recibo de confirmação. Ainda não há contrato/consumidor TypeScript nem
controle HTTP/interface; restauração continua protegida pelas guardas atuais.

Teste de wire confirma campos e correlação e rejeita ausência de decoderId.
Fixtures reais de estéreo/16 canais passam agora pelo dispatcher para HOLD,
mantendo asserções de pixels/posição/áudio. Execução final cargo test --bin
rplayout-engine program_hold -- --test-threads=1: exit 0, 4 passaram, 100
filtrados, 20,77s. Não foi teste de stdout/ACK ponta a ponta com processo
separado, timeout real ou supervisor; tampouco uma build instalável nova.

Próximos passos: consumidor tipado com correlação de recibo/ACK, estado
explícito confirmado/inconclusivo na telemetria, checkpoint e recuperação
atômica. Não autorizar pausa/restauração pela mera existência do comando.
9.3 e totais gerais permanecem inalterados.

### Consumo protegido do recibo no servidor — 2026-10-13

EngineTransport reconhece programHold e só guarda recibo para pedido pendente
com item/decoder/on idênticos ao comando e PGM atual da mesma geração. ACK
positivo sem recibo ou com decoder/PGM divergente rejeita como inconclusivo.
Comando privado exige identidade nativa, estado booleano e decoder inteiro
positivo; recibo exige frames inteiros não negativos. Não há rota pública,
botão, mudança de playing/checkpoint nem retomada automática implementados.

Dois testes do validador passaram usando Vitest local (exit 0). Cobrem ausência
de geração/estado, item vazio, pedido/item/decoder/estado divergentes e cursor
inválido. Não comprovam ainda consumo/ACK por processo separado; próximo gate
é teste do transport para ausência de recibo, stale generation e timeout.

Invocação pnpm falhou ao tentar buscar metadata pnpm@10.33.0 na rede; execução
local direta evitou reinstalação/download. Checagem de tipos local terminou
exit 1 por TS2352 em ha-return-sequence-plan.test.ts: fixture incompleta de
Rundown. Não houve diagnóstico nos arquivos desta mudança, mas typecheck
global NÃO aprovado. Grupo HA está adiado; arquivo não foi alterado para
mascarar o erro. Contagens permanecem inalteradas, 9.3 em andamento.

### Transporte: correlação e timeout — 2026-10-13

Sete casos dirigidos em engine-transport.test.ts exercitam o método request
privado e o consumidor real de stdout, com processo substituído por streams.
Confirmação correta resolve; ausência de recibo, id diferente, decoder
diferente, troca do PGM antes do ACK e decoder divergente no ACK rejeitam
como inconclusivos. Recibo sem ACK expira em 30s com relógio de teste: pedido
é rejeitado e kill solicitado, sem reenviar programHold. Kill solicitado
não prova encerramento físico, pixels ou recuperação do programa.

Comando executado com Vitest local: engine-transport.test.ts -t programHold.
Exit 0: 7 passaram, 139 filtrados (146 no arquivo), 32ms de testes. Não é
suíte inteira aprovada nem teste de engine Rust em processo separado. Falha
de timeout intencional aparece no log. Não altera interface, checkpoint ou
estado playing; próxima integração precisa telemetria explícita e contrato
de recuperação para não tratar um ACK genérico como prova de pausa.
9.3 permanece em andamento, totais 10/53 inalterados.

### Telemetria explícita e proteção do checkpoint — 2026-10-13

State nativo inclui programHold com itemId/decoderId/status/frames, ou null
sem PGM. Estados RUNNING, HELD e UNCONFIRMED; só HELD contém frames confirmados.
Dispatcher anuncia estado após sucesso e caminho de erro já anuncia o estado
real. Status existente consulta essa informação sem repetir o comando.

Servidor valida o vínculo e o formato do estado, expõe programHold em health
somente para processo/canal/decoder atual ativo, e impede cursor HELD,
UNCONFIRMED ou payload inválido de virar evidência de checkpoint playing.
Mensagem da mesma geração sem campo não apaga hold já conhecido; mudança de
geração limpa o vínculo anterior. Isso ainda não persiste checkpoint pausado.

Resultado final servidor: 10 testes dirigidos passaram, 139 filtrados, exit 0;
inclui preservação do estado em mensagem sem campo, rejeição de estado de
decoder anterior e limpeza da leitura ao fechar. Rust: 4 testes dirigidos
passaram, 100 filtrados, exit 0, 20,57s. Typecheck continua exit 1 somente
com diagnóstico TS2352 da fixture HA já registrada; aprovação global não
alegada. Ainda faltam consumidor operacional, persistência, restauração
atômica e comprovação ponta a ponta de stdout/status com engine separado.
Nenhuma nova build foi publicada; totais e status de 9.3 inalterados.

### Persistência de HELD, sem habilitar recuperação — 2026-10-13

Checkpoint aceita programHold explícito HELD com decoder histórico positivo
e frames inteiros. Exige engine real, playing=false, item/grade/revisão,
corte+SHA e elapsed idêntico a frames, dentro do corte. Pausa por mera troca
de playing continua recusada. Posse preserva checkpoint HELD do predecessor
não resolvido, assim como checkpoint playing. Decoder histórico não autoriza
comando numa nova geração.

Runtime salva cursor HELD recebido da telemetria atual junto ao corte e
revisão, não como playing. Estado inconclusivo, pausa sem corte/revisão ou
item divergente preservam checkpoint anterior. State do transporte não
anuncia playing para hold inseguro. recoverCheckpoint recusa PGM pausado
antes de liberar proteção; nenhuma restauração automática de quadro habilitada.

Testes checkpoint/recovery/restored-review: 42 passaram, exit 0. Verificam
persistência exata, corrupção recusada sem sobrescrita, pausa sem prova,
quarentena, cursor pausado protegido, ausência de replay e estado inconclusivo.
Primeira rodada tinha 38 passados/1 falha por expectativa antiga de 33 migrações;
fonte upgrade-backup-requests.ts comprova migração 50. Teste atualizado exige
lista exata 1..50 e nome durable-upgrade-backup-requests, preservando checks
dos nomes 31/32/33. Não removeu asserção nem alterou esquema de banco.

Não é recuperação congelada concluída: falta abertura/preparação atômica de
novo decoder na posição, confirmação de quadro antes da publicação, continuidade
do silêncio, integração operacional e teste de crash/processo separado.
9.3 continua em andamento e nenhuma nova build foi publicada.

Typecheck desta rodada primeiro encontrou duas fixtures novas de health
incompletas: preenchidos restarts/deaths/stalls/error, sem cast unknown nem
remoção de checagem. Nova execução termina exit 1 apenas pelo TS2352 anterior
em ha-return-sequence-plan.test.ts. Typecheck global permanece não aprovado.

### Decoder novo ativado em pausa — 2026-10-13

Rotina interna restore_program_hold exige PGM/armado vazios, nenhum TAKE
pendente e arquivo com cursor dentro do corte. Usa startOffsetFrames no
preroll/seek existente, confirma Paused, prontidão de vídeo/roteamento e posição
nativa exatamente igual ao cursor solicitado. Ativa seletores sem iniciar
Playing e sem desmutar áudio. Falha de preparação descarta decoder armado.
Não é RPC nem está ligada à recuperação do servidor.

Fixtures estéreo/16 canais agora param o item anterior e restauram novo item
com cursor 61 relativo ao Mark In 25. Confirmam HELD, posição nativa imóvel,
pixels estáveis e diferentes do quadro anterior e silêncio de todas as
amostras. Recusam sobrescrita de PGM ainda ativo. Execução dos dois casos
nativos exit 0: 2 passaram, 102 filtrados, 21,02s. Após ajuste de descarte em
falha, cargo check exit 0. Ajuste de falha ainda precisa teste induzido.

Limite importante: igualdade com referência do quadro absoluto 86 ainda
não comprovada; pixels diferentes/estáveis não bastam para afirmar quadro
exato, nem ausência de flash durante comutação. Falta capturar a transição
inteira, comparar referência e testar crash com processo separado antes do
contrato de restauração/ativação do servidor. Build e totais não mudaram.

### Quadro restaurado comparado com referência independente — 2026-10-13

Teste decodifica o MKV em pipeline independente uridecodebin, seek ACCURATE
em PAUSED e conversões/escala/caps equivalentes ao PGM. Compara pixels
restaurados com quadros absolutos 85/86/87. Exige erro médio por byte abaixo
de 1 no alvo 86 e menor que nos dois vizinhos (não somente imagem diferente
ou cursor numérico correto). Pipeline de referência é fechado após leitura.

Estéreo: caso dirigido passou, exit 0, 1 passado/103 filtrados, 14,37s.
16 canais: caso dirigido passou, exit 0, 1 passado/103 filtrados, 13,99s;
erros observados para 85/86/87: 1,4726041667 / 0,0 / 1,4981828704.
Portanto nessa fixture os bytes do alvo restaurado coincidiram exatamente
com a referência do quadro 86. Critério geral mantém tolerância para conversão.
Ambos mantêm estabilidade de cursor/pixels e silêncio após restauração.

Ainda não captura todos os quadros da transição (appsink atual descarta filas
antigas), não prova ausência de flash nem crash/processo separado. Guardas
de recuperação automática continuam ativas; não há nova build ou fechamento
de 9.3. Próximo gate: captura contínua da ativação e áudio desde antes da troca.

### Captura contínua da preparação/ativação — 2026-10-13

restore_program_hold agora silencia o barramento antes de load/preroll, não
somente antes da seleção final. Guardas de PGM vazio e corte/cursor válidos
continuam executadas antes dessa mudança. Em falha de load, PGM vazio não
ganha áudio; preparação bem-sucedida mantém mute até liberação explícita.

Teste instala probes BUFFER nos pads sink de tee-video e tee-audio antes da
rotina de preparação, após STOP/estabilização do estado vazio. Captura todos
os buffers nessa passagem, independente da fila limitada do appsink. Só
aceita pixels do estado vazio antes do alvo, ou pixels do alvo; após alvo
não permite retorno ao vazio nem qualquer quadro intermediário. Exige
silêncio de todos os buffers de áudio capturados. Não cobre a transição STOP
anterior, nem saída codificada/física; cobre preparação/ativação nativa local.

Execução final program_hold_native_ --test-threads=1 --nocapture: exit 0,
2 passaram, 102 filtrados, 22,84s. Estéreo: 38 quadros/153 buffers áudio;
16 canais: 21 quadros/30 buffers áudio. Ambos erro de referência alvo 0,0,
vizinhos 85/87 com erro 1,4726041667/1,4981828704. Captura observou somente
vazio→alvo estável e nenhum som. Não é crash/restart nem ACK de novo processo.

Próximo gate: processo separado e recibo de restauração ligado à geração nova,
antes de conectar checkpoint/servidor. 9.3 em andamento, nenhuma build nova,
totais 10/53 inalterados (6/32/8/7).

### RPC de restauração e falha de preroll exposta/corrigida — 2026-10-13

Rust recebe restoreProgramHold com ItemSpec (corte/startOffsetFrames), chama
preparação pausada e emite recibo programHold com id do pedido, itemId, decoderId
da geração nova e cursor confirmado. State é anunciado, ACK positivo identifica
decoder PGM. Ainda não há consumidor de restauração no servidor.

Passagem do teste pelo dispatcher revelou falha intermitente estéreo: 4
passaram/1 falhou na primeira rodada. Diagnóstico dirigido reproduziu a falha
e mediu quadro indevido antes do alvo, erro médio idle/old/target
11,4035763889 /22,7946527778 /20,2229629630. O quadro final seguia correto;
logo validação do alvo sozinha não certificava ausência de flash.

Causa no código: STOP remove decoder, mas mantém seletor na superfície anterior;
load escolhia slot 0 quando on_air era vazio. Preparação/seek podia ocorrer
na superfície ainda selecionada e aparecer no PGM antes de TAKE. load agora
escolhe superfície oposta ao active-pad quando PGM lógico é vazio. Para PGM
ativo mantém A/B anterior. Isso protege preparação inicial/pós-STOP, não apenas
restauração. Não relaxou critérios do probe nem aceitou quadro indevido.

Após correção, rodada program_hold dirigida exit 0: 5 passaram, 100 filtrados,
22,50s. Captura estéreo 37quadros/150buffers e16canais20quadros/31buffers;
somente vazio→alvo, áudio silencioso; referência alvo0,0 nos dois casos.
Não substitui ensaio repetido/crash/processo separado nem nova build. Recuperação
automática continua bloqueada até consumo seguro do novo recibo.

Regressão do load afetado: valid_mark_in_is_ready_and_missing_video_preserves_program
passou, exit0,1passado/104filtrados,20,27s. Mantém Mark In, recusa mídia sem
vídeo e corte além do fim sem substituir PGM atual. Não é homologação de toda
reprodução/CUE nem suíte nativa inteira.

### Consumo do recibo de restauração no transporte — 2026-10-13

Pedido privado restoreProgramHold exige arquivo (não live), corte válido e
startOffsetFrames explícito inteiro dentro do corte. Ausência não vira zero.
Recibo é correlacionado por id/item/cursor/held=true, com decoder positivo
da geração nova (não exige geração histórica do checkpoint). Para resolver
ACK positivo, exige recibo e State HELD com mesmo item/decoder/cursor, além
de decoder do ACK igual ao do recibo. Falta/divergência rejeita inconclusivo.

Sete casos do transport mock passaram (exit0,7PASS/147filtrados): confirmação,
recibo ausente, cursor errado, estado ausente, decoder de estado divergente,
estado RUNNING e decoder divergente no ACK. Quatro testes de validador passaram
(exit0), incluindo arquivo/cursor explícitos e identificação da geração nova.
Não é engine em processo separado, não registra retorno editorial/as-run e
não autoriza sozinho startup de checkpoint pausado. Runtime continua recusando
recuperação automática até montagem/verificação de versão e teste de crash.

Typecheck global ainda exit1 apenas pelo TS2352 HA previamente registrado.
Não há build nova; contagens/status de9.3 inalterados.

### Encerramento e nova geração em processos reais — 2026-10-13

Novo verificador scripts/verify-held-program-process.mjs gera mídia local,
abre engine compilado debug com saída Null, LOAD/TAKE, espera posição, HOLD
vinculado à geração e salva cursor/trim/SHA em fixture JSON. Encerra somente
seu filho por SIGKILL, exige evento exit e só então cria novo processo. Envia
restoreProgramHold com cursor salvo, compara recibo/ACK/State HELD e consulta
status. Exige amostras de posição imóvel e output clock ativo. Finaliza filho
novo por shutdown e preserva logs/resultados na pasta exclusiva de scratch.
Não usa banco real, runtime servidor, standby ou publicação física.

Build debug cargo build exit0. Execução verificador exit0:
scratch/held-process-D8lPUK/result.json. Engine SHA256
495c3fdb53f8abd62a010e09063e4a24857ce000a9321834f16db3b4f8892ed4.
PID anterior32144 exit SIGKILL observado; novo10332 shutdown exit0. Cursor6
relativo ao Mark In25 preservado, recibo held=true/decoderId1 da nova geração,
12 amostras nativas com mesmo cursor e saída ativa. DecoderId pode reiniciar
em1 num processo novo: geração não pode ser comparada só pelo número entre
processos; recibos precisam estar ligados ao filho atual e pedido pendente.

Isso prova ensaio controlado de novo processo/contrato/cursor, não restauração
operacional SQLite/as-run/posse nem pixels do subprocesso ou queda do host.
Pixels/silêncio são evidência independente dos testes Rust anteriores. Próximo
passo: montar arquivo/revisão verificados no runtime e consumir o novo recibo
antes de liberar proteção do checkpoint. Não há nova build instalável nem
fechamento de9.3; totais10/53(6/32/8/7) mantidos.

### Recuperação pausada preparada no transporte — 2026-10-13

recoverHeld reserva uma operação, exige grade atual/PGM vazio, cursor inteiro,
assertProgramTrim, spec de arquivo aprovado com SHA. Verifica identidade/SHA
antes e após restoreProgramHold; reconfirma filho/contexto editorial/identidade
de execução e posse ao longo das esperas. Só monta corte/rundown/cursor e
limpa recoveryCursor após State HELD/recibo/ACK da geração e versão consistentes.
Retorna prova item/decoder/frames. Não chama callback de TAKE/as-run, nem está
ligado ao startup/runtime; estes precisam commit explícito de recuperação.

Três testes dirigidos mock com arquivos reais de bytes/SHA passaram: montagem
confirmada sem callback TAKE; alteração antes do comando bloqueia envio;
alteração durante preparação recusa commit, não monta corte e mantém health
não ready, sem repetição automática. Primeira fixture tinha Mark In diferente
do publicado e foi corretamente recusada; ajustado corte publicado da fixture,
não guarda de produção. Teste de alteração inicialmente produziu ENOENT tardio
porque listener reagia a shutdown do cleanup; listener agora injeta somente em
restoreProgramHold. Execução final exit0,3PASS/154filtrados,sem erro pendente.

Próximo passo: callback/commit operacional de recuperação pausada e teste
runtime/posse/checkpoint, sem usar confirmação de TAKE como registro de pausa.
Nenhuma nova build;9.3 e totais permanecem em andamento/inalterados.

### Guarda contra watchdog converter pausa em reprodução — 2026-10-13

Inspeção do registro operacional mostrou que AsRun reconcilia predecessor
com RESTART e que runtime nativo escreve no callback de confirmação, não no
poll periódico. Portanto não basta chamar recoverHeld e limpar checkpoint:
é necessário commit explícito de segmento/identidade recuperada antes de
liberar a proteção. Startup permanece recusando pausa até essa integração.

Risco concreto corrigido: handler exit do transporte preservava apenas item,
frames/corte e restore reenviava recover normal (PLAYING), perdendo a pausa.
RecoveryCursor agora preserva HELD/UNCONFIRMED e, para HELD, cursor confirmado.
restore bloqueia retomada comum desses modos sem repetir LOAD/TAKE. Pedido
recoverHeld também mantém intenção HELD enquanto confirmação/versão não forem
concluídas. A recuperação pausada futura deve consumir esse modo explicitamente.

Dois testes dirigidos de watchdog mock passaram, exit0,2PASS/157filtrados:
exit SIGKILL mantém modo/cursor e restore não envia comandos. Não certificam
commit de as-run, recuperação do host nem startup integrado. Total10/53
continua6concluídas,32andamento,8pendentes,7v3; build não publicada.

### Commit do runtime e startup de checkpoint HELD — 2026-10-13

recoverCheckpoint passa a aceitar somente pausa explícita programHold HELD
validada pelo schema, mantendo recusa de pausa legada sem prova. Aplica as
mesmas guardas de dono/predecessor, cadência, canais, revisão publicada e corte.
Dispatch de pendingRecovery usa recoverHeld, nunca recover/TAKE normal.

recoverHeld aceita commit assíncrono dentro da fila nativa, antes de limpar
recoveryCursor. Runtime reconfirma tentativa, execução, revisão, item/cursor,
corte, HELD/decoder e posse. Aguarda AsRun.follow com newTake=false, preserva
executionId, reconfirma contexto e só então libera proteção. Novo servidor
gera segmento de continuidade após reconciliação RESTART do predecessor,
não transfere/reescreve sua linha como TAKE. Ainda falta comprovação durável
do conjunto as-run/checkpoint/posse com engine real e restauração de gráficos.

Testes checkpoint-recovery:14PASS/exit0, incluindo commit confirmado e recusa
de as-run preservando checkpoint, sem recover normal. Transporte dirigido:
12PASS/147filtrados/exit0. Fixtures de transport tinham atribuições a trim
readonly; corrigidas por construção de cópia imutável heldView, sem relaxar
tipo de produção. Startup de HELD está integrado em código, mas não homologado
ponta a ponta. Watchdog HELD permanece bloqueado até commit correspondente.
9.3 em andamento; nenhuma build instalável nova.

### Commit com SQLite/posse/as-run reais — 2026-10-13

Teste de runtime agora usa Checkpoints, AsRun e ExecutionOwnership reais em
SQLite isolado, com engine ainda substituído. Cria segmento do predecessor,
salva HELD, libera dono sem engines e reivindica nova posse legítima. Executa
recuperação do runtime e verifica checkpoint, assinaturas/vínculo do as-run,
continuidade de executionId e foreign_key_check vazio.

Primeiro ensaio expôs lacuna real: predecessorResolved permanecia false,
portanto Checkpoints.write recusava substituir HELD antigo apesar do quadro
confirmado. commitHeldRecovery agora marca predecessor resolvido SOMENTE
após HELD/posse/contexto e AsRun.follow concluídos e reconfirmados. Não remove
guarda de Checkpoints nem resolve predecessor antes da prova nativa.

Rodada de runtime após correção:15PASS/exit0. Extensão com trigger SQLite
RAISE(ABORT) na inserção do novo segmento garante checkpoint anterior/dono
histórico intactos, nenhuma nova linha as-run e predecessorResolved=false.
Expectativa inicial da fixture chamou assertOwned no dono já substituído,
corretamente recusado; mudou para comparar ownerRunId histórico do checkpoint.
Rodada final dirigida:2PASS/14filtrados/exit0 (16casos no arquivo). Sucesso
produz segmento anterior RESTART e novo segmento no cursor25, ligado ao dono
atual, com checkpoint HELD/decoder8 e executionId preservado.

Limite: banco/assinaturas/registro são reais, evento nativo é mock. Ensaio
de dois engines reais anterior é independente. Falta combinar ambos no mesmo
teste ponta a ponta e injetar crash entre etapas de commit, além de gráficos.
9.3/totais/build não encerrados ou alterados.

### Publicação/runtime/SQLite/engine reais juntos — 2026-10-13

Novo scripts/verify-held-runtime.mts gera mídia, banco isolado file-backed,
acervo APPROVED, grade e publicação pelo serviço real. Runtime com posse real
abre engine debug/Null, TAKE confirmado, HOLD ligado ao decoder e checkpoint.
Encerra somente seu engine, observa exit e retirada do PID na posse; fecha
runtime e cria outro dono/runtime. recoverCheckpoint usa publicação real e
recoverHeld com commit real de AsRun/Checkpoints. Não há mocks nesse ensaio.

Primeira execução não dirigia o ciclo periódico após Ready: checkpoint único
era chamado antes do segundo engine pronto e pendingRecovery não era consumido.
Timeout da fixture; processos foram encerrados com confirmação no finally.
Verificador passou a chamar checkpoint como o loop real do servidor. Não
removeu guarda Ready nem mudou produção para contornar a espera.

Execução final via tsx local exit0: scratch/held-runtime-ghamxT/result.json.
Engine SHA495c3fdb53f8abd62a010e09063e4a24857ce000a9321834f16db3b4f8892ed4,
PID anterior23344 encerrado. Cursor9 relativo ao Mark In25, corte25..400,
SHA de mídia/revisão/executionId preservados. Checkpoint mudou do dono anterior
para dono novo com playing=false/HELD; predecessorResolved=true. Novo as-run
ligado à posse atual inicia no cursor9, anterior encerrado ENGINE_FAILURE.
Cursor segue imóvel após1,2s; foreign_key_check vazio e filhos encerrados
com closeConfirmed no cleanup. Evidência result refere estado antes do cleanup.

Limites: simula queda do engine, não mata o processo servidor nem energia do
host; runtime novo é criado no mesmo processo verificador. Não há saída física,
captura de pixels do subprocesso, crash entre commits, gráficos ou backup
restaurado nessa rodada. Pixels/silêncio foram provas Rust separadas. Não
fecha9.3 nem constitui pacote Windows atualizado. Totais10/53(6/32/8/7).

### Checkpoint e resolução do predecessor na mesma transação — 2026-10-13

commitHeldRecovery agora escreve o checkpoint da geração nova ANTES de limpar
tentativa/proteção. Resolução do predecessor e Checkpoints.write compartilham
transação SQLite IMMEDIATE (transações internas são savepoints). Falha de
write reverte predecessorResolved e mantém payload/dono/cursor anterior.
AsRun.follow ainda precede essa transação: não é atomicidade do conjunto todo.

17testes checkpoint-recovery PASS/exit0, incluindo trigger real na atualização
do checkpoint. Falha de as-run mantém1linha; falha de checkpoint pode deixar
2segmentos auditáveis, mas nunca checkpoint novo ou predecessor resolvido.
Proteção/runtime seguem inconclusivos, sem repetição automática.

Ensaio real scripts/verify-held-runtime.mts --fail-checkpoint exit0:
scratch/held-runtime-gbCD8x/result.json. Após quadro HELD confirmado pelo engine,
trigger SQLite recusou atualização. Payload anterior inteiro idêntico,
cursor9/corte/SHA/revisão/execução/dono preservados; predecessorResolved=false,
health.ready=false, PGM playing=false/HELD. Dois segmentos as-run presentes;
erro explícito PGM não recuperado. Filhos próprios encerrados e observados no
cleanup. Não afirma rollback do as-run, ausência de queda de energia ou replay
seguro após outro restart nesse estágio. Essas lacunas continuam abertas.

9.3 em andamento, sem build nova; totais10/53(6/32/8/7) inalterados.

### Transação conjunta as-run/checkpoint/posse — 2026-10-13

AsRun.followHeldWithCommit agora serializa reconciliação, segmento novo,
vínculo assinado, resolução do predecessor e checkpoint numa transação SQLite
IMMEDIATE síncrona. Helpers SQL do AsRun tornados síncronos; fila continua
Promise serial para callers. Não aguarda decoder/HTTP dentro da transação;
callback thenable é recusado. Em rollback restaura também open/reconciled e
motivos em memória. Eventos de integração ficam diferidos até commit; rollback
descarta eventos, evitando anunciar segmento não gravado.

Runtime só libera proteção após essa operação e reconfirmação.25testes
asrun/proveniência/checkpoint passaram/exit0. Falha de checkpoint agora mantém
somente segmento anterior, em vez das2linhas registradas na etapa anterior.
Rodada real --fail-checkpoint PASS/exit0: scratch/held-runtime-GLyGHf/result.json,
cursor7/payload antigo intactos, predecessorResolvedfalse, runtime não ready,
asrunCount1. Sucesso real PASS/exit0: scratch/held-runtime-xQLQMh/result.json,
PID33048→32712, cursor7/execução/corte/SHA/revisão preservados, novo dono,
HELD/ready e novo segmento vinculado. Filhos encerrados com confirmação.

Isso demonstra atomicidade SQL/rollback induzido, não kill do servidor no
meio da transação nem queda de energia. Falta ensaio de término abrupto do
processo do backend e recuperação, backup/gráficos, watchdog HELD e pacote.
Typecheck ainda exit1 só pelo TS2352 da fixture HA conhecida; global não PASS.
9.3 e contagens10/53(6/32/8/7) permanecem em andamento/inalteradas.

### Cadeia local de tentativas interrompidas — 2026-10-13

Antes do ensaio de kill do backend, identificada lacuna de contexto: rollback
pode manter checkpoint do dono original, mas uma tentativa intermediária já
reivindicou posse. Novo dono só aceitava predecessor imediato. ExecutionLease
agora consulta cadeia assinada recoveredRunId de até32 níveis, mesmo canal/host,
sequência decrescente, sem abertura pendente/estado UNCERTAIN, e parada de
servidor/engines comprovada (ou liberação explícita válida). Para ao encontrar
predecessorResolved, ciclo ou contexto sem prova. Não admite replay de cursor
anterior a uma tentativa confirmada; não infere morte remota.

Runtime usa canRecoverCursorFrom para startup/commit/backoff. AsRun reconcilia
somente os IDs dessa cadeia verificada, não só predecessor imediato vazio;
vínculos das linhas continuam assinados e fechamento é restrito aos donos
com parada comprovada. Consulta não altera posse. Observer de morte injetado
na classe Ownership é propagado à Lease, sem bypass do verificador real.

56testes posse/checkpoint/proveniência PASS/exit0 após alteração. Teste adicional
da cadeia as-run PASS/exit0(1passado/35filtrados): geração original com linha
aberta, tentativa intermediária vazia interrompida e terceira geração deixam
original RESTART e apenas1segmento aberto no cursor750, vinculado ao dono atual.
Também testados adulteração de assinatura e bloqueio além de predecessor já
confirmado. Não é kill real do backend: esse gate continua pendente.
Build/totais10/53(6/32/8/7) inalterados,9.3 em andamento.

### SIGKILL real durante a transação — 2026-10-13

scripts/verify-held-transaction-crash.mts usa banco file-backed, cofre isolado,
posse/AsRun/Checkpoints de produção. Worker em outro processo reivindica dono,
escreve segmento+checkpoint+resolução dentro de followHeldWithCommit, marca
ponto após SQL mas antes de COMMIT e aguarda. Pai encerra somente o filho
observado por SIGKILL e exige exit antes de reabrir banco.

Primeiro ensaio falhou por PID do wrapper tsx diferente do worker; não foi
considerado PASS. Wrapper foi encerrado no cleanup; consulta posterior mostrou
worker25604 ausente. Ensaio corrigido inicia Node diretamente com flags do
loader ativo, de modo que PID declarado no marcador deve igualar ChildProcess.
Nenhuma parada por enumeração ampla nem processo de produção foi utilizada.

Execução final exit0: scratch/held-tx-crash-GQr94R/result.json. Worker26020
SIGKILL observado. Reabertura comprova payload checkpoint original intacto,
predecessorResolvedfalse, somente1as-run ainda aberto e integrity_check ok.
Nova posse legítima admite cursor da cadeia não resolvida e transação completa
de recuperação resulta em checkpoint do dono novo/cursor25,2segmentos e
somente1aberto, vínculos assinados validados. Guardas de parada continuam reais.

Limite: worker executa transação de produção, não servidor HTTP/runtime com
engine; cursor/trim/SHA são fixture de banco, não mídia medida. É prova real
de crash/rollback SQLite e retomada da cadeia, complementar ao ensaio nativo
anterior, não teste combinado de queda do backend+engine ou energia do host.
Ainda faltam crash após commit/antes da confirmação, gráficos, backup,
watchdog HELD e pacote atualizado.9.3 e totais10/53(6/32/8/7) inalterados.

### SIGKILL após COMMIT, antes da confirmação — 2026-10-13

Verificador de transação ganhou --after-commit. Worker confirma transação
com cursor28 distinto do anterior25 e é encerrado antes de entregar resultado
ao controlador. Reabertura exige checkpoint novo/dono novo/decoder8 e
predecessorResolvedtrue; não aceita voltar ao checkpoint original. Nova posse
admite cursor do dono confirmado e recusa cursor do ancestral já resolvido.
Continuidade mantém28/executionId, as-run com3segmentos e apenas1aberto;
assinaturas/vínculos e integrity_check são verificados.

Execução exit0: scratch/held-tx-crash-Z8rqgq/result.json, worker18608 SIGKILL
observado, cursor28 preservado e checkpoint25 bloqueado para recuperação.
Ramo antes-de-COMMIT também executado com código atualizado: exit0,
scratch/held-tx-crash-hPUWIA/result.json, worker30192 SIGKILL observado,
payload25 intacto e recuperação pela cadeia não resolvida até dono novo.

Ambos usam worker de transação de produção, sem engine/HTTP e com metadata
de fixture; não equivalem a término do servidor completo com PGM físico.
Completam evidência das duas janelas SQL, não todo9.3. Permanecem gráficos,
backup, watchdog pausado, ensaio combinado backend+engine e pacote. Totais e
build inalterados.

### Watchdog de HELD integrado ao commit — 2026-10-13

EngineTransport.restore não converte modo HELD em recover/TAKE. Se há corte,
grade e callback de commit pausado, chama recoverHeld; UNCONFIRMED ou ausência
de prova/callback continua bloqueada. Runtime lê checkpoint HELD correspondente
e reconfirma item/cursor/corte/contexto antes de commitHeldRecovery atômico.
Só após callback e guardas finais recoveryCursor é limpo. Falha permanece
inconclusiva, sem repetição automática. Dois testes de bloqueio anteriores
passaram após integração (HELD sem callback e UNCONFIRMED).

Verificador real ganhou --watchdog-held. Execução exit0:
scratch/held-runtime-Q54xjk/result.json. Engine33584 morto/exit observado;
watchdog reiniciou para10148, restarts1/deaths1/errornull/readytrue. PGM continua
HELD no cursor10/corte25..400, SHA/revisão/executionId e ownerRunId preservados.
Checkpoint pausado, predecessor resolvido,2segmentos as-run com só1aberto;
cursor permanece imóvel após1,2s. Apenas saída Null, sem pixels subprocesso
ou transmissão física; filhos próprios encerrados com confirmação no finally.

Watchdog HELD está implementado e validado localmente nessa fixture. Ainda
faltam backend completo terminado/reiniciado com engine, backup/restauração
de gráficos e pacote novo;9.3 não fechado. Totais10/53(6/32/8/7) inalterados.

### Grafismos/eventos durante HELD — 2026-10-13

Inspeção encontrou scheduler.tick chamado apenas por existência de onAir,
mesmo playing=false. Isso podia disparar deixa ou automação já vencida no
cursor pausado durante recuperação. fireDueGraphics agora bloqueia todo fluxo
automático enquanto native health não ready/recuperação pendente. Depois do
commit, permite o fluxo já existente de composição confirmada vinculada ao
checkpoint, mas impede scheduler/legacy cues enquanto playing=false. Retomada
playing=true volta ao agendador com o mesmo cursor/duração montada.

18testes checkpoint-recovery passaram/exit0. Caso novo confere tick não chamado
em PGM mantido e chamado após liberação, com duração nativa75 no cursor50.
Não é prova de render da composição recuperada ou de dispositivo externo;
essas validações permanecem separadas. Não altera controles manuais de grafismo
nem confirma SVG por mera existência do checkpoint.9.3/totais/build inalterados.

### Composição confirmada restaurada em HELD — 2026-10-13

Verificador --graphics-held grava SHOW de STATION_LOGO pelo GraphicCommandLedger
e Graphics.triggerLayerConfirmed reais, recebe ACK do engine e vincula recibo
ao checkpoint. Após queda do engine/runtime novo, restaura vídeo HELD e chama
fireDueGraphics: composição anterior vinculada é restaurada pelo caminho
COMPOSITION_RESTORE, com novo recibo CONFIRMED e checkpoint apontando para ele.
Exige mesma string SVG da camada, camada ativa e cursor/playingfalse preservados.
Não dispara scheduler nem novas deixas para realizar essa restauração.

Primeiro ensaio expôs guarda pós-commit errada: canRecoverCursorFrom recusava
checkpoint antigo após predecessor já resolvido, embora transação tivesse
gravado checkpoint novo correto. Guarda pós-commit agora exige payload novo
do dono atual/item/cursor/execução/decoder, não reautoriza o ancestral antigo.
Guardas antes/do commit continuam usando cadeia não resolvida. Fixtures mock
agora persistem write em read, e teste SQLite espera tentativa limpa/erro nulo,
não somente observar linha gravada.18testes checkpoint-recovery PASS/exit0.

Ensaio real final exit0: scratch/held-runtime-SY13W1/result.json. Engine33024
→23620, cursor10 mantido, execução/SHA/corte preservados; camada logo ativa,
SVG igual, novo recibo nativo confirmado e checkpointBound=true. Campo restored
do resultado foi capturado antes da restauração gráfica; graphicsEvidence e
asserção de checkpoint certificam atualização posterior do recibo.

Limites: sem captura de pixels/saída física, physicalPixelsValidatedfalse.
É evidência de vínculo/ACK/composição declarada, não homologação de render,
visibilidade/tamanho do logo ou todos os timers/dispositivos. Ainda faltam
backup e backend completo, pacote e demais gates da matriz.9.3/totais/build
inalterados.

### Backup de HELD com recibo gráfico — 2026-10-13

Inventário do backup inclui savedHeldCheckpoints, separado de playing. Campo
opcional no schema de recibo mantém leitura de relatórios antigos sem default
ou reescrita de conteúdo assinado. Inventário novo conta HELD confirmado e
mantém executionResumeAllowedfalse; não transforma estado salvo em licença
para abrir PGM na restauração.

Ensaio --graphics-held --backup-held exit0:
scratch/held-runtime-et5ocF/result.json. Backup gerado e validado por cópia
isolada/read-only com integrity/foreignKeys ok, tabelas/revisão/posse/as-run/
recibo gráfico protegidos. Checkpoint da cópia idêntico ao ativo no momento
da cópia: HELD/cursor7/corte25..400/SHA/execução/revisão/dono/recibo. Inventário
1checkpoint,0playing,1held,1publicação ativa,1as-run aberto. Depois ensaio
recupera engine/runtime e composição, com novo recibo vinculado; isso usa banco
da fixture original, não ativa o arquivo do backup.

8testes inventário/backup PASS/exit0 (5+3). Rodada adicional restoration-records
teve9PASS/1falha: criação de hard link retornou EPERM no ambiente, antes da
asserção de recusa; validação de hard link NÃO homologada nessa execução.
Não removeu teste nem guarda de segurança para contornar restrição.

Limites: confirma backup preservado/restaurável estruturalmente, não ativação
quarentenada de banco copiado com HELD nem recuperação em outra conta/máquina.
Manifesto hardlink, backend completo+engine, pixels gráficos e pacote ainda
abertos.9.3 e totais10/53(6/32/8/7) inalterados.

### Gate de ativação do backup HELD — 2026-10-13

Revisão de restauração continua não ativando checkpoint HELD por mera validade
da cópia. Diagnóstico específico agora distingue HELD confirmado (contrato
nativo implementado no runtime local) de pausa legada: backup HELD exige
admissão pausada das saídas preparadas e ativação continua recusada. Recusa
preserva payload/cursor e registros de ativação, antes de abrir recursos.

Três testes dirigidos PASS/exit0(22filtrados): HELD explícito validado no
schema ainda precisa gate nativo da restauração; pausa legada recusada; troca
isolada de playing com corte recusada. Não removeu guarda, não habilitou TAKE
nem chamou a preservação da cópia de restauração no ar.

Próximo requisito real: contrato de admissão deve comprovar modo HELD/cursor
na geração preparada, com saídas ainda retidas, e só então ativar backend de
backup. Admissão atual comprova cursor/quadro/corte, mas não modo pausado como
parte do recibo de saídas. Implementação/validação disso ainda pendente.
Não houve nova build;9.3 e totais10/53(6/32/8/7) inalterados.

### Modo pausado no cursor de admissão nativo — 2026-10-13

ProgramAdmissionCursor inclui paused explícito no engine. HELD só produz
paused=true se arquivo, decoder Paused, mute ativo, cursor nativo igual ao
mantido e quadro real preparado. UNCONFIRMED recusa admissão. Vídeo mantido
não precisa entregar quadro novo para satisfazer recência, pois posição e
estado pausado são reconfirmados; PLAYING/live mantêm guardas de recência.
Idle declara pausedfalse e ausência de quadro/corte.

Parser do servidor exige pausedtrue explícito, arquivo/corte e cursor exato
quando requested paused=true; admissão normal rejeita HELD. Recibos antigos
sem campo continuam apenas no caminho não pausado; não viram prova de pausa.
Não altera orquestração/redundância do grupo8 adiado, nem habilita ativação
do backup: ainda falta preparar/consumir essa prova no backend de restauração.

17testes de contrato PASS/exit0; cargo check PASS;2fixtures nativas
program_hold_native_ PASS/exit0(103filtrados,22,54s), agora exigem cursor de
admissão pausedtrue/elapsed61/quadro confirmado após estabilidade/referência
de pixels e silêncio. Não é release de saídas externas nem handoff de backup.
Binário debug de ensaios anteriores ainda é geração anterior a essa mudança;
nenhum pacote novo nem resultado antigo atribuído ao contrato novo.
9.3 e totais10/53(6/32/8/7) permanecem em andamento/inalterados.

### Consumidor do recibo pausado na liberação — 2026-10-13

releaseProgramOutputs pode receber solicitação explícita paused=true. Antes
de despacho exige HELD vinculado ao item/decoder/cursor e corte montado. Modo
normal recusa HELD/UNCONFIRMED antes de abrir saída. Pedido pendente carrega
modo esperado; parser confere campo nativo e cursor exato, prova resultante
preserva pausedtrue. Reconferência após autorização/ACK exige mesma geração,
concessão e estado HELD/cursor. Defaults não pausados preservados, sem alterar
orquestração/adapters de redundância do grupo8 adiado.

17testes do parser PASS;1teste de transport para backup paused admission
PASS/exit0(159filtrados): preparo mock HELD com SHA/corte, saída retida, tentativa
normal recusada sem dispatch, recibo pausado correspondente confirma liberação
declarada mantendo playingfalse. Mock de stdout não é publicação/cerca física.

Ainda falta estágio de preparação/ativação do backend restaurado ligar esse
modo e provar saídas nativas reais. Guarda de review backup HELD permanece;
nenhuma ativação automática, nova build ou fechamento de9.3. Totais10/53
(6/32/8/7) inalterados.

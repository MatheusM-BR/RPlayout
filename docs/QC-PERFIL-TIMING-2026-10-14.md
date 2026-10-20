# QC — perfil e elegibilidade operacional consistentes

Falha instalada r63/3eGNj8: DB já320, runtime ainda exigia640.
Primeira correção/6I9YV5: perfil atualizado, timing conservava DROPPED.
applyCommittedQcProfile agora incrementa loadEpoch e reconstrói as visões
com os mesmos itens/versões/revisão, perfil atual e estado PGM. Não reconfigura
decoder, não publica editorial, não altera aprovação da mídia.

Regressão dirigida com refresh impedido de instalar:640→DROPPED,
320→disponível, transporte intacto PASS. Types servidor PASS.
6V67ru falhou na sonda antes do TAKE; saída separadamente decodificada PASS,
sem causa exclusiva comprovada. Registros anteriores preservados.

Replay0EHhX2 PASS: servidor fonteE5E95ECD compilado, Node/engine/proxy/probe/
MediaMTX dos runtimes instalados r63, PATH mínimo, DB/mídia próprias, PGM saída
nula. CUE RTSP320x180/desvio19,624; TAKE BLOCKED/perfil640 recusado409 conserva
PGM/origem/CUE. Perfil320 restaurado/reaprovação→TAKE nativo confirmado,
as-run hash/revisão. Cleanup próprio do harness concluído.

Evidência:scratch/RPlayout-ingest-qc-take-0EHhX2/result.json.
compiledServerOverride:true: não é validação da r63 original. Ainda falta
empacotar e validar edição com correção; hardware/browser/remoto/soak abertos.

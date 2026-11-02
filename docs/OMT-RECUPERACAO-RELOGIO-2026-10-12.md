# OMT — relógio após interrupção

## Evidência atualizada em 13/10/2026

Sete testes unitários OMT passaram. O teste nativo
`native_publisher_transmits_video_and_audio_to_loopback_receiver` passou
explicitamente, com libomt/libvmx e GStreamer do pacote r54: 1 PASS,
104 filtrados, 13,47s. Verificou publicação, recepção pelo appsrc, áudio,
CUE independente sem PGM, TAKE, formato original 320x180 no compositor
640x360, perda de sinal e retorno de imagem vermelha/áudio após reset do
emissor, mantendo o decoder. Saída principal Null, fonte sintética própria.

A primeira execução no isolamento terminou pelo watchdog (exit 124,
stage=4, abertura do receptor). A repetição autorizada fora do isolamento
passou, sem alteração de código/runtime/ACL. Não atribuir aquele timeout
ao produto nem considerar este ensaio homologação de fonte externa real.

O histórico NOT_RUN abaixo descreve o lote original, não o estado atual.

Inspeção do receptor encontrou rebase de timestamp usando apenas o fim antigo
do áudio/vídeo. Após pausa real esse fim pode estar atrás do running-time do
pipeline, tornando o retorno atrasado nos elementos sincronizados.

FrameClock agora recebe running-time na primeira entrega, após >=2s sem frame
válido e quando o relógio do emissor reinicia. A base comum é o maior valor
entre running-time e fins anteriores. Áudio/vídeo recebem DISCONT na primeira
entrega após rebase; o offset subsequente do timestamp do emissor permanece.
Timestamps negativos usam contagem contínua sem reinicializar cada pacote.
Timeout ou frame inválido não renova a última entrega válida.

Não afirma que um frame da fila do emissor seja recente. Buffer antigo do
emissor, troca de geração entre pacotes e sincronismo físico ainda precisam
de ensaio e políticas próprias. Não altera sozinho autorização de TAKE.

Fixtures novos preparados NOT_RUN: abertura com running-time não zero,
retorno no tempo corrente após reset, offset áudio/vídeo e DISCONT uma vez,
timestamp não especificado sem resets repetidos. Fixtures anteriores mantidos.
Código não compilado ou executado neste lote. Nenhuma nova build.

Prioridade: fechar grupo 2 e depois 3. DeckLink 2.2 adiada expressamente pelo
usuário em 12/10, continua pendente de homologação e não bloqueia o avanço
das outras verificações. NDI/OMT externos e automação real não homologados.

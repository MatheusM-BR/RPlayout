# Recuperação de entrada NDI/OMT — 16/10/2026

## Escopo e critério

Ensaio local com emissores nativos próprios, banco QA isolado e PGM parado.
Um único CUE; interromper o emissor; exigir ausência de sinal; republicar com o
mesmo nome e outro processo, mas com imagem e áudio diferentes. Aprovar somente
com quadros decodificados e PCM medido, sem reiniciar engine/decoder ou repetir
CUE. Isso não homologa uma entrada externa, hardware, rede remota ou estabilidade
prolongada; tampouco prova interrupção de um VT que esteja no PGM.

## OMT — aprovado neste cenário, r71 instalada

Evidência: `scratch/qc-native-browser-fVENXc/result.json` e
`assertions-input-recovery.json` (verificador independente aprovado).

- Sem sobreposição de servidor, web, devices ou engine da fonte.
- Um CUE; receptor PID 27376 e decoder 1 preservados após LOST/NO_VIDEO.
- Imagem real 428×240: média 122,974 → 17,056; desvio 71,444 → 14,839.
- Áudio estéreo: 998/998 Hz → 1512/1512 Hz (tons de referência 997/1511 Hz).
- Ambos os emissores encerraram com código 0, sem encerramento forçado ou erro.
- Servidor, carrier e família nativa próprios encerrados; grade/as-run vazios.

## NDI — falha reproduzida e correção na fonte

Histórico preservado, sem transformar falha em aprovação:

1. `TT77nf`: leitor de imagem não encerrou mesmo após produzir 75 JPEGs.
   Ajuste no leitor QA: modo somente vídeo; áudio permanece validado por outro
   leitor real com frequência e energia. Não se ampliou timeout nem se reduziu
   critério de imagem. Esse ensaio não chegou à recuperação.
2. `42rvLQ`: vídeo/áudio inicial aprovados; perda confirmada; uma consulta HTTP
   expirou após o retorno. Esse resultado não determina sozinho a causa.
3. `VxdEVR`: consultas e heartbeat responderam sem falhas, emissor voltou
   saudável, mas o receptor ficou LOST e contador parado em 281 quadros por
   todo o prazo de recuperação. Assim se isolou uma falha nativa real.

O plugin incorporado é gst-plugin-ndi 0.15.3-e92296285. No código dessa revisão,
`receiver.rs` converte ausência por timeout em EOS e encerra a thread receptora;
`ndisrc/imp.rs` propaga esse EOS. O padrão de recepção é 5000 ms.

Referências primárias consultadas:

- [Propriedades ndisrc](https://gstreamer.freedesktop.org/documentation/ndi/ndisrc.html)
- [Receiver da revisão incorporada](https://github.com/GStreamer/gst-plugins-rs/blob/e92296285/net/ndi/src/ndisrc/receiver.rs)
- [Fonte NDI](https://github.com/GStreamer/gst-plugins-rs/blob/main/net/ndi/src/ndisrc/imp.rs)

Correção em `apps/engine/src/channel.rs`: definir `connect-timeout=0` e
`timeout=0`, mantendo a assinatura NDI viva. Zero desativa apenas esse EOS do
plugin; a detecção independente de sinal recente (2 s), os portões de prontidão
e o prazo limitado de TAKE não foram desativados. Também não se mudou o modo de
timestamps por suposição. Erros nativos reais não são convertidos em sinal bom.

Engine release compilado: SHA256
`161FB00373BC8791B002157C36E1689EB0F2B00D3DE25F154B8E89041582AFB2`.
Teste da configuração NDI: 1 aprovado. Testes nativos dirigidos `live_`: 7
aprovados, incluindo perda de buffers com preservação do PGM até sinal válido.
Uma primeira compilação do teste falhou por nome de função do próprio teste;
corrigida para o construtor existente, sem ocultar essa tentativa.

Ensaio `CTtr22` aprovado, com asserção independente em
`assertions-input-recovery.json`: engine da fonte sobre servidor, web, devices e
runtime instalados r71. Um CUE; receptor PID 20716/decoder 1 preservados;
LOST registrado; média da imagem 123,036 → 17,057 e áudio 998/998 → 1512/1512 Hz.
Primeira consulta saudável 76 ms após o emissor retornar pronto; prova completa
de imagem/PCM terminou 9147 ms depois. Esses tempos incluem amostragem local,
não são uma medida universal de latência. Sem falhas de consulta/heartbeat ou erros dos
emissores; todos os processos próprios encerrados. Não equivale a validar uma
nova instalação, pois o engine é uma sobreposição explícita.

## Estado inicial de CUE

Falha adicional observada: telemetria inicial com zero quadros aparecia como
LOST antes de qualquer aquisição. O servidor agora mantém o tally CUEING ou
TAKE_PENDING durante preparação. O diagnóstico medido continua NO_VIDEO, sem
inventar prontidão, ocultar erro real ou liberar TAKE. Após aquisição, a perda
continua resultando em LOST. Lote dirigido aprovado: 163 testes de transporte e
4 do analisador de áudio (167 casos). Tipos estritos dos leitores de imagem/PCM
aprovados. A primeira checagem completa do servidor detectou seis acessos de
índice possivelmente indefinido no novo helper QA; correção apenas de tipo,
JavaScript equivalente. A checagem completa posterior do servidor passou
(`tsc --noEmit -p apps/server/tsconfig.json`, processo 31829, saída 0).
Build do servidor com avisos de dependências e todos os binários nativos
`--release --locked --bins` passaram. SHA256 do servidor novo:
`E4A01600E18EFC6439C3A87BFCD7D4944B959257412FBF005A85914345A3B619`.

## Entrega e limites

O ZIP r71 original permanece intacto e não contém estas duas correções novas.
A r72 parcial foi empacotada sobre os arquivos imutáveis do manifesto
da instalação r71 QA, preservando seus avisos de runtime/licenças; somente os
arquivos do manifesto entram, não o banco/perfil QA. Catálogo e 7.094 hashes
aprovados, 7.095 entradas; `scratch/r72-zip-integrity-20261016/result.json`.
ZIP 540.199.563 bytes / SHA256
`D01CA4D02A8E230BBB56C5AEBB735663F9CDCCD065665E211296AA305325D6F5`.
Isso não aprova o instalador/startup r72. Ver `BUILD-PARCIAL-R72.md`.
Nenhuma limpeza, mudança de rede operacional ou migração de pastas foi feita.
Contagem preservada: 10 grupos / 53 verificações; 7 concluídas, 35 em andamento,
4 pendentes e 7 adiadas à v3. DeckLink física adiada; sem emissor externo NDI/OMT
e sem licença original do SDK NDI, publicação final continua não homologada.

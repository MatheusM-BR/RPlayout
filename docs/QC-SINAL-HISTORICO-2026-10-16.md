# QC — sinal recente e histórico de entradas, 16/10/2026

Resultado: **lote local implementado e conferido**, sem fechar 2.1/3.7 no
escopo amplo. R78 parcial gerada; instalador/startup desta edição NOT_RUN.

## Problema e implementação

A linha de entrada mostrava medições armazenadas, inclusive “quadro 40 ms”,
mesmo após a fonte ficar IDLE. O verde era derivado apenas do estado READY,
ou até de SRT OPTIMAL, sem reavaliar a idade da amostra.

`qc-live-source-status.ts` agora separa seleção, barramento, medições recentes
e dados históricos. Fonte desligada/IDLE/medição vencida não tem selo verde;
formato/áudio/idade retidos recebem **Última amostra (histórica)** e explicação
de que pertencem à coleta. Não se transforma ausência de medição em certeza
de ausência de sinal. O quadro recente soma tempo desde a coleta; áudio tem
validade independente. Políticas de instabilidade do canal são respeitadas.
Dados de PGM não são emprestados ao PVW ausente. Telemetria SRT identifica-se
como rede, não confirma vídeo.

`QcLiveSourceRow.tsx` foi extraído para testar o HTML real. Há um tick por
segundo para a lista visível expirar medições mesmo sem novos eventos; a hora
da avaliação vem de cada render. Não há novo decoder, conexão de fonte,
polling por entrada, permissão de rede, CUE/TAKE ou alteração do engine.

## Validação e falhas preservadas

- 78 casos distintos afetados PASS: rodada de77 em5arquivos, replay final18
  do helper com17sobrepostos. Tipo web PASS, build final PASS. Erro inicial
  de tipo somente no teste (delete de campo obrigatório) corrigido antes
  do tipo PASS. Iniciador pnpm sem saída foi explicitamente interrompido;
  testes executados diretamente com Node incluído, não contabilizar tentativa.
- `scratch/qc-native-browser-iYCEKg/result.json`: FAIL antes da mídia,
  configuração da distribuição não autorizada no ambiente restrito, 0capturas,
  sem emissores iniciados; processos próprios encerrados. Não desativar proteção.
- `scratch/qc-native-browser-gPFOlH`: prova visual encontrou defeito no lote:
  tick armazenava uma hora anterior à nova amostra WS; a guarda de relógio
  futuro retirava a medição apesar do vídeo. `ndi-current-ax.txt` preservado.
  Controlador terminou FIXTURE_FINISHED, mas **a prova funcional é FAIL**.
  R77 foi gerada antes dessa descoberta e é superada/não recomendada. Sua
  integridade ZIP não certifica funcionamento. Não apagar/reclassificar o caso.
- Correção: tick apenas solicita render; leitura Date.now ocorre em cada render.
  Web final `index-BsVZYGz4.js` SHA256
  `8B0D3FCBD44724DE835FCBE491531F6A5A0629EA9A688ECA520EFD76A2499F1D`.
- `scratch/qc-native-browser-A4Uy5d`: replay afetado PASS, duas descobertas
  NDI/OMT oficiais de emissores sintéticos locais. Navegador abriu direto QC,
  sem visitar Master: NDI com medição recente/verde; troca para OMT recente/
  verde, NDI amarela/NÃO SINTONIZADA com histórico explícito. Screenshot
  `omt-history.jpg`, observações `ndi-current-ax.txt`, `omt-current-ax.txt` e
  `omt-history-dom.json` (inclui classes, títulos e vídeo428×240/ready4/play).
- Estados nativos observados separadamente: decoders1/2 entregaram quadros,
  medidas recentes de vídeo/áudio, H264+Opus no PVW e HQdesligado/0readers.
  `observe-qc-native-state.mts` precisou da mesma permissão do servidor QA
  para loopback; a tentativa restrita recebeu EACCES, não é falha do sinal.
- `verify-qc-source-history-evidence.mjs` releu os registros e produziu
  `assertions-source-history.json` PASS: asset final solicitado com200,
  snapshot nativo conserva NDI/IDLE/medição, histórico não verde, fonte atual
  verde, vídeo428×240 real, PGMnull/playingfalse/grade-asrun0. Nenhuma captura
  PCM/GRAY8 nativa foi repetida: este lote altera diagnóstico, não mídia.
- Aba própria fechada; controle stop próprio; sessão terminal exit0;
  dois emissores exit0/semforce/errors[], servidor/carrier/família nativa
  encerrados. Nenhuma aba/dado operacional do usuário alterado.

## Artefatos e limites

R78: `release/RPlayout-1.1-parcial-20261016-r78-instalador.zip`, 540.206.044bytes,
SHA256 `D6A254CEBD4BB0448564AF3369D2862A92C0CA89B1018546A121D9B0B8E750D4`.
Integridade em memória PASS:7.094hashes/7.095entradas; evidência
`scratch/r78-zip-integrity-20261016/result.json`.
Engine191CD1E1/servidorA709115F/devicesD7396F7C preservados, sobreposição
explícita de engine/servidor/web na instalação QA r71 para o teste. Não é
instalação r78. R77 preservada:540.205.869bytes/SHA256
`37EA7226E1BD78C653467C4D14B4F3C17A9C33F0B8086CD96C4006826A9D1090`.

Não houve cenário visual de WebSocket congelado: vencimento é coberto por
testes dirigidos do domínio, não alegar essa prova de interface. Não é
homologação remota, de hardware, emissores externos, fidelidade, escuta humana,
CPU/RAM/rede ou soak. Campo browserValidated global do controlador permanece
false; não convertê-lo em aprovação integral de QC. Notices/NDI continuam
REVIEW_REQUIRED; DeckLink física adiada; grupo8v3. Sem cleanup/migração/rede.

Totais preservados: **10grupos/53verificações**, 7concluídas/35andamento/
4pendentes/7v3. Grupo3:2concluídas/5andamento. Próximos passos são medir o
consumo e a continuidade nas condições documentadas e validar o pacote atual
instalado; não repetir por status o fluxo de mídia nativo inalterado.

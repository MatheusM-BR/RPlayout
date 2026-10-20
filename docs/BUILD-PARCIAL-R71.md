# RPlayout r71 — parcial instalável para teste interno

Destino: release/RPlayout-1.1-parcial-20261015-r71-instalador.zip.
Gerado540199538bytes, SHA256
50F6DAFC8745E9F64A71D6707D807EDC8BC792556ECC429E95DC1DEC365E9973.
Registro externo posterior à geração; o README já incorporado não é alterado.
Integridade externa PASS:7094hashes de manifesto/7095entradas, leitura em
memória sem extração/execução. scratch/r71-zip-integrity-20261015/result.json.
O README incorporado antecede estas conferências externas. Posteriormente,
instalação real r71/7atalhos/perfilVERIFIED e startup2513ms passaram em QA;
nativo instaladoNDI/OMT/PVW+encerramento/injeção de perdaPASS BS8rwI, sem
overlays. Ver INSTALACAO-R71-E-LIFECYCLE-2026-10-15.md. Não é Windows limpo,
replay visual instalado ou homologação final/Setup.exe assinado. O ZIP não mudou.

Integra a r70 e o lote QC: consultas de catálogo/telemetria independentes,
GETs limitados a 10s/sem sobreposição, seleção e última lista preservadas em
falha de consulta, aviso explícito e contexto novo por canal. Falha de JPEG de
arquivo não invalida mais os scopes da inspeção WHEP ao vivo. Inclui diagnóstico
opcional --trace do auxiliar de descoberta, sem alterar stdout JSON padrão.

Testes dirigidos: 31 casos/5 arquivos PASS; correção JPEG/scopes 53/3 PASS
(3 casos sobrepostos: **81 distintos/7 arquivos**, não 84). Tipos web e builds
web/servidor/engine release locked PASS. Não repetidas suítes não afetadas.

QA local ABuYjy com servidor/engine instalados r68 e overlay web declarado:
NDI e OMT nativos com imagem/áudio sintéticos descobertos e selecionados no QC,
sem Master/TAKE/PGM. Navegador 428x240 e receptor separado com imagem real.
Telemetria503 preservou fontes/preview; catálogo timeout~10s preservou vídeo,
bloqueou seleção nova e recuperou. Qualidade OMT640x360: scopes falharam na
primeira versão, guard corrigido, replay dirigido confirmou amostras e retorno
428x240; encoder HQ desligado. Não é teste de fidelidade original sem perdas.

Limite do controlador inicial: diagnóstico final de um sender OMT sem horário;
encerrava broker/carrier antes dos senders. Não afirmar execução sem erros ou
soak validado. Provas de imagem/QC continuam restritas aos instantes observados.
Controlador posterior registra fronteira/horário e encerra senders primeiro;
essa melhoria do controlador ainda não foi reexecutada. Produto não é afetado
pela ordem de fechamento do controlador. Fontes externas continuam abertas.

Web index-DG6oIPgn.js SHA256
CD7665DEA5B70B1B9CBA4D9FB9AF667085869E22F67C868B3105EACED818C173.
Servidor5F33C58E58E2D26294FAD3EFF71F994C82D093AE0F6159DAC91BDE8508A64607.
Engine3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
DevicesD7396F7C17C95440446F7BD9590D6581706EA00F4C0FA6CED329B9C4A1438B5D.
Node/SQLite/runtimes embutidos; produto sem tsx/tsc/pnpm globais. Controlador QA
usa ferramentas locais de teste: não demonstra Windows limpo.

Build para teste interno, redistribuição **REVIEW_REQUIRED**: acordo original
NDI SDK indisponível, MSVC/codecs/licenças em conferência. Notices não são
liberação jurídica. Não instala drivers DeckLink; homologação adiada pelo
operador. Faltam demais verificações, estação remota, carga/soak, Windows limpo,
upgrade/recuperação/redistribuição e publicação. Grupo8 fica para v3.

Nenhuma limpeza/migração C→D ou alteração de rede/conta operacional. R70 e
pacotes anteriores preservados. Não transferir prova do overlay para uma
instalação não executada da r71. Localhost local; IP/nome:porta para remoto.
Total10 grupos/53 verificações:7 concluídas/35 em andamento/4 pendentes/7v3.
Ver QC-NDI-OMT-CONSULTAS-2026-10-15.md e PENDENCIAS-NUMERADAS.md.

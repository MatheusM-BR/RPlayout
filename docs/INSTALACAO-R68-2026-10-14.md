# R68 — instalação completa e validação local parcial

ZIP escolhido:release/RPlayout-1.1-parcial-20261014-r68-instalador.zip,
SHA256 F9A14A9AD0F885BB6A06D11862FDB01388EE087DF30080D6775C154F04D645EB.
Não foi reconstruído/substituído o pacote. Estes ensaios usam a edição instalada,
não o backend de desenvolvimento ou um override de servidor.

## 10.1/10.4 — Instalador real

Script verify-installed-partial.ps1 executou o INSTALAR.ps1 incorporado no ZIP,
com destino novo scratch/r68-installed-qa-20261014 e atalhos em
scratch/r68-shortcuts-qa-20261014. Não alterou Menu Iniciar/atalhos operacionais.
Evidência:scratch/r68-install-evidence-20261014/result.json, PASS/exit0.

Preflight antes de materializar o bundle:2.928.336.896bytes disponíveis,
2.828.406.110 necessários para bundle+estimativa de instalação+margemQA128MiB.
Conteúdo expandido1.420.584.262bytes; estimativa do instalador2.153.997.638.
Recibo VERIFIED, espaço conferido antes da extração, perfil de dados/mídia
isolado na instalação nova, sete alvos/diretórios de atalhos conferidos.
Nenhum servidor iniciou automaticamente, instalação antiga não modificada.
Isso não é ensaio de upgrade/rollback, energia, quota UNC ou Windows limpo.

## 10.2 — Startup com Node/módulos do pacote

verify-portable-server.mjs executado pelo Node v24.16.0 **instalado**.
PASS/exit0 em2.536ms, scratch/RPlayout-portable-server-ZZHDH6/result.json.
PATH mínimo sem PowerShell/globalNode/pnpm; NODE_PATH/NODE_OPTIONS removidos
do filho. better-sqlite3 resolve dentro do pacote, não do checkout/global.
Banco/cofre/mídia próprios; engine e saídas desativados neste smoke.
HTTPhealth/interface/asset200; JS servido tem hash do arquivo instalado.
Servidor próprio encerrou antes da gravação do resultado.

Servidor5F33C58E58E2D26294FAD3EFF71F994C82D093AE0F6159DAC91BDE8508A64607.
WebCc-PfGGg/E80385B2132DF5B9381C6469C58CDD1E0D8511319CE0318414E0A1A680D49FA0.
Não comprova ausência de qualquer DLL pré-instalada do sistema nesta máquina;
cleanWindowsValidated permanece false. Resolve o gate local de startup/module,
não toda a qualificação de dependências nativas/licenças.

## 3/5/10 — Arquivo, proxy, CUE e TAKE nativos instalados

verify-ingest-qc-take.mts --installed-package=r68 --cue-qc, PASS/exit0,
scratch/RPlayout-ingest-qc-take-ec33c0/result.json.
Node/servidor/engine/probe/proxy/GStreamer/MediaMTX da instalação, PATH mínimo
do produto e nenhum override de servidor. Controlador de QA usa ferramentas
TypeScript do checkout para fixture/asserções; o produto não usa tsx/tsc.
Portas fixas de broker conferidas livres antes da criação; nunca tomou/parou
um broker operacional. Dados/vídeo sintético/pastas são exclusivamente próprios.

- Vídeo MKV/VP8/Vorbis local com caminho Unicode passou scanner/probe real,
  preservação/hash/arquivo de versão e proxy real. Proxy retornado pela API
  tem hash do arquivo gerado e vídeo/áudio decodificáveis320x180/10fps.
- Publicação operacional aprovada e primeiro arquivo confirmado em engine
  nativo. CUE do segundo item entregou quadro RTSP realmente decodificado:
  320x180, JPEG8004bytes, desvio77,76836 (não preto uniforme).
- Leitor finito agora reutiliza verifyPublishedPicture: solicita/aguarda
  keyframe/AU e observa75 quadros para evitar concealment de entrada mid-GOP.
  Mesmos critérios de dimensão/desvio>10; não afrouxa aprovação e não mede
  latência de navegador. Esse ajuste é só no controlador de teste.
- QC bloqueado e perfil incompatível após CUE recusaram TAKE implícito,
  mantendo item/startedAt do PGM e seleção CUE. Perfil compatível/reaprovação
  permitiram TAKE; as-run contém SHA/revisão da edição executada.

Engine3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
Originalec95a8a728c7e83fb89d841983fe29e4818c52ff3387a441bcb467fe792721a2;
publicação b45c37f4-7969-490d-aeb9-1f77788a3440.
Imagem:installed-cue-last.jpg na pasta de evidência, inspecionada como barras.
STOP/finalização aguardam a família nativa própria encerrar; exit0 foi observado.
Nenhum PID histórico foi morto. Instalações/bancos/reports anteriores preservados.

Saída PGM null: preservação de item/origem confirmada por estado/as-run, não
por quadro SDI/NDI/OMT físico. Entrada é arquivo sintético, não live externo.
Não é QC no navegador/qualificação física/Windows limpo/performance/soak.

## Pendências e espaço

R68 tem instalação/startup locais e cenário nativo de arquivo comprovados;
as marcações NOT_RUN do README interno são anteriores aos ensaios e superadas
somente nestes escopos. Não foram editados ZIP nem recibos para fingir aprovação.
Todos os marcos10.x ainda têm gates abertos: Windows limpo/recuperação guiada,
grupo dependente completo, sinais reais, licenças e publicação final.
6.1 visual completo e6.3 alterações de segurança por UI seguem separados.
DeckLink física adiada; grupo8 v3;192.168.42.172 não foi acessado.

Após os ensaios, C:939.347.968bytes livres (aprox0,94GB). Nenhuma limpeza feita.
Não criar outra instalação completa de QA sem nova capacidade confirmada.
Testes prolongados/grandes devem ter orçamento de arquivos explícito.

Total10 grupos/53 verificações:6 concluídas/36 em andamento/4 pendentes/7v3.

# RPlayout r35 — instalador parcial para teste

Inclui a r34 e o lote de fallback QC: codec original não reproduzível no
navegador usa quadros JPEG explícitos, sem anunciar reprodução ou áudio;
falha do quadro limpa medição e safe area, mostra indisponibilidade e permite
nova tentativa. Retorno ao proxy permanece leve e não aprova nem aciona PGM.

A sonda atualizada preserva proporção e pixel aspect ratio em JPEG square-pixel,
sem faixas pretas incorporadas ou ampliação da fonte, limitada a 3840x2160.
O cache picture-v2 não reutiliza nem apaga quadros da geometria antiga.

Validação local: 50 testes afetados, 12 nativos, tipos e compilações passaram.
JPEGs reais incluem vertical UHD e SD anamórfico. Navegador e servidor compilado
conferidos com FFV1 próprio: JPEG, falha de quadro injetada em relay isolado,
retry e retorno ao proxy. Nenhuma decisão QC/as-run criada; engine PGM estava
desativado. Não equivale a homologação de todos os formatos ou sinais físicos.

Extraia TODO o ZIP e execute INSTALAR.cmd em uma pasta NOVA. Faça backup de
dados e cofre antes de migrar. Inclui Node, dependências de produção/SQLite,
GStreamer e runtimes NDI/OMT/MSVC; não exige pnpm, tsx ou tsc no destino.
DeckLink requer o driver oficial Blackmagic Desktop Video.

Instalador parcial sem teste de instalação, conforme solicitado. Não é
Setup.exe assinado, não inicia o servidor automaticamente e não foi homologado
em Windows limpo. Não aprovado para operação no ar. Releases anteriores mantidas.

Total:10 grupos,1 concluído/9 abertos;53 verificações de fechamento,
5 concluídas/23 em andamento/25 pendentes.

Registro externo após empacotamento (não incluído no LEIA-ME interno):
536327613 bytes; SHA-256
26B129E45966A7DE20019E7C4B190E348339098CCC986FB39C6C3316656CA27D.

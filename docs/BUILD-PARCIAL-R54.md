# RPlayout r54 — build parcial instalável de teste

## Engine e runtimes da instalação r54

verify-rplayout-package.ps1 -SkipDeferredHa terminou exit0: manifesto completo,
assinaturas MSVC Microsoft, SQLite com Node portátil, plugins e engine com
PATH somente do pacote/Sistema. Engine confirmou ready/shutdown e carregou
vcruntime140.dll da própria pasta, não do runtime global. Presença de plugin
DeckLink/NDI não é placa/sinal homologado. HA explicitamente não testado.

Teste de dois processos com Node/GStreamer/engine release instalados PASS/exit0:
scratch/held-process-IFJ2Wo/result.json. SHA do engine igual ao manifestado
F81907B864B4F2D5208FD5265021AD95109EEA1D346E54108B5B9669CEB4CCB8.
PID30044 encerrou SIGKILL observado; novo31976 restaurou HELD/cursor6,11amostras
imóveis, relógio de saída ativo e shutdown exit0. Mídia gerada localmente;
saída Null. Sem tsx/tsc/pnpm ou GStreamer global nesse ensaio.

Continuam abertos Windows limpo, lançamento pelos atalhos, mídia/preview
remotos, licenças de redistribuição por componente e sinais físicos. Não
transforma testes locais em homologação integral de playout/publicação.

## Resultado atual: instalador e smoke local aprovados

O diagnóstico anterior de startup foi esclarecido: o servidor chegava a HTTP
listening, mas o verificador isolado recebia EACCES na conexão local. Não era
falta de SQLite nem bloqueio do startup. Mantidos abaixo os resultados negativos
históricos; eles não representam defeito comprovado do servidor.

Teste autorizado restrito a127.0.0.1, fora desse isolamento, usando o servidor
original extraído do ZIP (compiledServerOverridefalse), PASS/exit0 em
scratch/RPlayout-portable-server-fswIWj/result.json. Startup2407,332ms, health
HTTP200/oktrue, interface servida e JS correspondente ao pacote
SHA dc1c4d02c63caf3724995d4c6989865c930a9aa714c3094ba26e2c78d2c2bdf1.
Node portátilv24.16.0, SQLite/banco criado, PATH mínimo sem PowerShell no PATH,
engine/media/transmissão desativados e servidor encerrado/exit observado.

Instalador/hashes/recibo/7atalhos já passaram no ensaio isolado. Não é Windows
limpo, abertura pelos atalhos, PGM nativo ou SDI/NDI/OMT físico homologados.
ZIP r54 não foi alterado; hash publicado permanece válido. Trace de diagnóstico
é mudança posterior no código e não substituiu o servidor nesse PASS.

Edição 2026-10-13. Não é versão 100% homologada.

Extraia o ZIP inteiro e execute INSTALAR.cmd em uma pasta NOVA. Não substitua
instalação, banco ou cofre existentes; a atualização de perfil requer seu
fluxo próprio. Preserve backups e cofre antes de qualquer atualização.

Inclui servidor compilado, interface, engine release atualizado, Node,
better-sqlite3 e runtimes portáteis da base validada. Execução não exige
pnpm, tsx ou tsc. Drivers/placas e homologação dos sinais físicos permanecem
dependências específicas de hardware, não eliminadas por empacotamento.

Integra correções recentes de compensação/retorno e recuperação local de PGM
pausado: comando/recibo ligados ao decoder, pausa silenciosa, checkpoint HELD,
commit atômico de as-run/checkpoint/posse, continuidade após falha e bloqueio
de eventos automáticos durante pausa. Engine distingue pausa no recibo de
admissão. Ativação de backup HELD permanece bloqueada até completar seu gate.

Evidências locais estão em GRUPO-09-RECUPERACAO-PAUSADA-2026-10-12.md e na
matriz PENDENCIAS-NUMERADAS.md do projeto. Testes de engine/runtime/SQLite,
watchdog e falhas de transação não certificam SDI/NDI/OMT físicos nem Windows
limpo. DeckLink continua adiada e redundância do grupo 8 permanece para v3.

Builds observadas: servidor/interface/engine release e typecheck do servidor
PASS. A fixture incompleta que impedia tipos foi preenchida, sem alterar
lógica de HA ou executar sua homologação. Aviso de bundle web acima de 500kB
permanece. Hash do engine release:
F81907B864B4F2D5208FD5265021AD95109EEA1D346E54108B5B9669CEB4CCB8.

Matriz: 10 grupos / 53 verificações — 6 concluídas, 32 em andamento,
8 pendentes e 7 adiadas para v3. Verificação do ZIP/instalador desta edição
será registrada após geração; não confundir build bem-sucedida com instalação
ou publicação física aprovada.

## Histórico: instalador validado; teste de rede inicialmente impedido

INSTALAR.ps1 do ZIP executado em scratch/r54-installed-qa-20261013 por
PowerShell nativo exit0. Catálogo/hashes completos e recibo integrity VERIFIED,
serverStartedfalse/previousInstallationModifiedfalse conferidos. Perfil/cofre
por instalação e7links em scratch/r54-shortcuts-qa-20261013 verificados;
menu Iniciar e instalação anterior não alterados. Links não foram abertos.

Smoke servidorFAIL em30s e observação90s, sem resposta da API. Processos de
servidor próprios encerrados e exit observado. Diagnóstico persistente:
scratch/RPlayout-portable-server-ox9EIt e dIWh3S. Banco chegou a50migrações,
0canais; causa da espera ainda em análise. R54 NÃO funcionalmente homologada.

SQLite portátil separadoPASS(scratch/portable-storage-cYnPz1), abertura e
término do helper33992 confirmados com Node/binding/bridge/service incluídos
e PATH mínimo. Não comprova startup inteiro. Trace opcional de lifecycle sem
dados sensíveis adicionado ao código posteriormente; não integra o ZIP r54.

## Evidência de geração e conteúdo

Empacotador exit0. ZIP gerado em
release/RPlayout-1.1-parcial-20261013-r54-instalador.zip, 537838347 bytes.
SHA256: 15C127464F0FF7E20FD726DBCF6C6C76A55B9A7C0BE665D5D0B355EB0AA616DC.

ZIP externo contém edição, INSTALAR.cmd/ps1, LEIA-ME e payload. Conferência
do payload real (6650 entradas) confirmou engine com SHA da compilação acima,
Node portátil, servidor compilado, interface, manifesto e pacote/binding
better-sqlite3: apps/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node.
Cópia de QA em scratch/r54-zip-qa-20261013/payload.zip.

Isso não é conferência integral dos 6650 hashes, execução do instalador r54,
teste com PATH limpo, abertura por atalhos nem homologação Windows limpo.
Pacote disponível como parcial para teste; esses gates permanecem abertos.

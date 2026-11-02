# RPlayout r57 — parcial de teste

Atualização do lote instalado: QC de áudio completo PASS IKccBA e troca
de arquivo/versionamento/publicação imutável PASS NHULzk. Ambos usam API
e binários da r57 instalada, banco/mídia próprios, saída nula. Medição sem
calibração externa; sem browser ou sinais físicos. Detalhes e limites em
docs/PENDENCIAS-NUMERADAS.md, resultados nas respectivas pastas scratch.
10.2 agora em andamento (execução nativa comprovada, licenças/qualificação
externa ainda abertas). Totais atuais: 10/53; 6 concluídas, 33 em andamento,
7 pendentes e 7 v3. Contagens e NOT_RUN abaixo são registros históricos.

## Atualização: instalação integral validada nesta máquina

CUE/PVW publicado e TAKE implícito de arquivo PASS:
`scratch/RPlayout-ingest-qc-take-GfoBlR/result.json`. Mesmos binários
instalados, MediaMTX incluído com bind loopback e portas previamente
conferidas livres. CUE do segundo VT preservou item/origem de PGM;
leitor RTSP decodificou JPEG real 320x180, desvio de luminância 17,738,
não apenas ACK/telemetria. BLOCKED e perfil alterado depois do CUE
recusaram TAKE sem itemId, preservando PGM e seleção CUE. Reaprovação e
perfil válido permitiram TAKE do item em CUE; as-run confirmou hash/revisão.
Processos próprios encerrados pelo harness; nenhum PID histórico morto.
Não homologa navegador, escuta humana, live NDI/OMT/SDI ou estação remota.

Fluxo integrado de arquivo no pacote instalado PASS:
`scratch/RPlayout-ingest-qc-take-9HDvs3/result.json`. Servidor compilado
SHA 28dbb9c6bd8801b003cf1641ca7f4bc99ffabe8a190376791f7110fcd26d979c,
engine RELEASE do pacote, Node/probe/proxy/GStreamer incluídos e PATH
mínimo. Importação real de caminho Unicode, metadados/hash, arquivo de
versão, proxy servido e decodificado, aprovação QC por perfil, publicação
operacional e TAKE nativo confirmados. PENDING recusou inserção;
BLOCKED/perfil incompatível recusaram TAKE preservando origem PGM;
reaprovação permitiu TAKE e as-run vinculou hash e revisão publicada.
Proxy 320x180/10fps sem upscale da fonte, 973765 bytes.

O harness usa código-fonte apenas para criar o banco/estrutura inicial
isolada; a API, ingestão e reprodução usam os artefatos instalados.
Primeira execução VCVJ91 falhou numa expectativa obsoleta de upscale
para 240p; corrigida para a geometria original 320x180 e reexecutada.
Não qualifica CUE publicado, navegador, sinais físicos ou Windows limpo.

Ensaio nativo do engine RELEASE instalado PASS:
`scratch/held-process-EqvzKi/result.json`, SHA do engine igual ao pacote.
Vídeo sintético com áudio em caminho Unicode `Fonte-ação.mkv`, LOAD/TAKE,
HOLD, encerramento observado do processo original e restauração em novo
processo no quadro 8. Cortes 25..400 preservados; 11 amostras estáveis de
posição e relógio de saída ativo; shutdown final exit 0. Usou somente Node
e GStreamer incluídos, PATH mínimo. Não certifica pixels/escuta, browser,
runtime do servidor, protocolos físicos ou falha elétrica.

Instalador original executado com exit 0 em
`scratch/r57-installed-qa-20261013`; recibo VERIFIED e sete atalhos
conferidos (destino, diretório de trabalho e executável existente).
Nenhuma instalação operacional anterior foi alterada.

Verificação integral do pacote PASS: manifesto/tamanhos/SHA256, SQLite
com Node incluído, assinaturas Microsoft do MSVC app-local, plugins
GStreamer e engine ready/shutdown com PATH portátil. Engine carregou
vcruntime140.dll da própria instalação. HA explicitamente não testada.
O verificador foi corrigido para ler o manifesto em UTF-8 no Windows
PowerShell 5.1; a primeira execução falhou por leitura Unicode incorreta,
não por ausência do arquivo. A segunda execução terminou com exit 0.

Servidor instalado PASS em 2188 ms, Node v24.16.0 incluído, PATH mínimo,
banco isolado criado, health/interface 200 e saída observada.
Evidência: `scratch/RPlayout-portable-server-5TivjF/result.json`.
Engine/transmissão desativados nesse ensaio de servidor.

Removidas apenas as cópias QA r54-installed-qa-20261013 e
r55-installed-qa-20261013, após autorização e conferência dos recibos e
ausência de redirecionamentos. ZIPs, código e relatórios preservados;
as cópias podem ser recriadas pelos instaladores. Cerca de 2,9 GB liberados.

Os registros NOT_RUN abaixo são históricos, superados pelos resultados
acima. Ainda faltam reprodução integrada desta edição, sinais físicos,
Windows limpo, homologação remota e demais critérios da matriz.
Totais mantidos: 10 grupos / 53 verificações; 6 concluídas, 32 em andamento,
8 pendentes e 7 adiadas para v3. Não equivale a homologação 100%.

Startup diagnóstico de extração SELECIONADA PASS BfFKA0:5854entradas
originais doZIP,797GStreameromitidas;Nodeincluído/PATHmínimo,SQLite criado,
health/interface200,2164ms,serverexitobservado. Engine/saídas desativados.
Não é instalação completa nem ensaio do runtime de mídia. Instalação/atalhos/
startup integral com engine continuam abertos. Receipt da seleção em
scratch/r57-startup-selected-20261013/startup-extraction-receipt.json.

Integridade internaPASS:6651entradas/6650arquivos manifestados,hashes e
tamanhos conferidos;engineRelease3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
Resultado scratch/r57-zip-integrity-20261013/result.json. VerificadorInMemory
com margemGC>=3payloads,sem cópia temporária de538MB/extrair instalação.
Instalação/startup permanecemNOT_RUN; não confundir integridade com execução.

ZIP538655472bytes,SHA256
F5218E653A68A7942169F2946B20A88FDC5D559552560E3BF41194C0B55A607C.
Catálogo externo conferido (edição,instalador,LEIA-ME,payload).
Integridade interna/instalação/startup r57 aindaNOT_RUN; não herda r56.
Types/builds servidor,interface eengineReleasePASS nesta geração.

Inclui restauração explícita de backup HELD com preparação nativa local,
saídas retidas/admissão pausada, liberação separada PVW, ledger de tentativa/
confirmação e encerramento aguardando callbacks antes de fechar SQLite.
Também inclui diagnóstico PVW no Master (entrega do decoder, não browser).

Lote agrupado:56testes PASS (concessão local/admissão/checkpoints/review).
Ensaios de fonte/debug:backupHELDpositivo OscZ5z;falhapré-release b1HILN;
pós-recibo lKiyOO;multicanalparcial ETqFHB;renovação negada II7Lg6;
crashNode pós-recibo sGTADu. Todos usam arquivos sintéticos/saídaNull,
não sinais físicos/queda elétrica. Crash preserva STARTING/reserva/origem,
retryrecusado; não libera automaticamente reserva inconclusiva.

Pacote ainda parcial: instalação/startup desta edição NOT_RUN. R56mantida.
DeckLink física adiada,grupo8v3nãoorquestrado. Homologação remota,Windows
limpo e licenças integrais continuam abertas.10grupos/53verificações:
6concluídas,32em andamento,8pendentes,7v3.

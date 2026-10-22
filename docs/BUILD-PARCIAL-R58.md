# RPlayout r58 — parcial de teste, não homologada

Fluxo integrado de arquivo CUE/PVW/TAKE desta instalação PASS uvbX0L:
scanner/proxy/QC/publicação reais, MediaMTX incluído em loopback,
quadro RTSP decodificado 320x180 (desvio luminância 17,738). CUE preservou
item/origem PGM; TAKE implícito após BLOCKED/perfil incompatível recusado
sem perder CUE. Reaprovação/perfil válido enviou o item em CUE ao PGM;
as-run confirmou hash/revisão. Banco e mídia próprios, saída PGM nula.
Evidência scratch/RPlayout-ingest-qc-take-uvbX0L/result.json.
Não homologa browser, escuta humana, NDI/OMT/DeckLink ou rede remota.
Registros NOT_RUN de reprodução abaixo são superados apenas nesse escopo.

Atualização de QA: instalação integral em scratch/r58-installed-qa-20261014
PASS (exit 0/recibo VERIFIED); sete atalhos conferidos. Verificação integral
do pacote PASS: hashes/tamanhos, SQLite incluído, assinaturas MSVC,
plugins e engine ready/shutdown com CRT da própria pasta e PATH portátil.
HA explicitamente não executada (v3). Servidor instalado PASS em 2727 ms,
Node v24.16.0/PATH mínimo, banco próprio, health/interface 200, encerramento
observado. Evidência scratch/RPlayout-portable-server-0vMBVc/result.json.
Interface servida index-PQSvNklv.js. Nenhuma instalação anterior alterada.

Inventário da instalação: 548 avisos, 126 metadados npm, 19 apontamentos,
REVIEW_REQUIRED; scratch/license-inventory-dSvc6C/result.json.
JSON de procedência/inventário não é contado como texto de licença.
Node/GStreamer/OMT/MediaMTX com avisos presentes; NDI/MSVC ainda abertos.
NOT_RUN de instalação/startup nos registros abaixo é histórico superado;
testes integrados de reprodução DESTA edição, browser/remoto, Windows
limpo e sinais físicos não foram qualificados por essa rodada.

ZIP gerado: release/RPlayout-1.1-parcial-20261014-r58-instalador.zip,
540171029 bytes, SHA256
83293FB231D50F22F3067378C05B7FD66ED72B5BFB8EE489FA12ACC775AB6B1C.
Integridade interna PASS: 7095 entradas / 7094 arquivos manifestados,
tamanhos/hashes conferidos. Engine SHA
3F0C9616A55CC83EE0C31E6A12C17EE952F35A3BC2C14B41DD685025B1969D65.
Evidência scratch/r58-zip-integrity-20261014/result.json.
Instalação/startup desta edição NÃO VALIDADOS; integridade não os substitui.

Inclui servidor e interface atuais, engine RELEASE locked, atribuição NDI
na interface e inventários de avisos JavaScript, Node, GStreamer e Rust.
Preserva todas as releases anteriores. Não instala driver DeckLink.

Fonte dos avisos: Node v24.16.0 com procedência/hash; distribuição GStreamer
correspondente à base conferida; Cargo.lock e avisos Rust conferidos;
Drizzle vinculado ao commit oficial. Coleta de frontend/servidor acompanha
os módulos incorporados. Os inventários são REVIEW_REQUIRED, não parecer
jurídico nem autorização final de distribuição.

Ainda faltam aviso completo abstract-logging, termos efetivos NDI/MSVC e
revisão integral de redistribuição/codecs. Não tratar como publicação final.

Builds de código PASS (servidor, interface e cargo release --bins --locked).
Instalação e testes funcionais DESTA edição ainda NOT_RUN. Evidências r57
são históricas e não são automaticamente transferidas para esta edição.
NDI/OMT físicos, estação remota e Windows limpo continuam abertos.
DeckLink física adiada; grupo 8 reservado à v3, sem testes HA nesta entrega.

10 grupos / 53 verificações: 6 concluídas, 33 em andamento, 7 pendentes,
7 adiadas para v3. Não equivale a homologação 100%.

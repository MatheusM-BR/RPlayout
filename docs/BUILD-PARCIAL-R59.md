# RPlayout r59 — parcial de teste, não homologada

QA integrado: arquivo CUE/PVW/TAKE PASS4MZuSe, imagem RTSP real320x180,
PGM/origem preservados durante CUE e recusa de TAKE por QC/perfil.
Reaprovação permitiu TAKE implícito do CUE e as-run hash/revisão.
Serviço/Node/probe/proxy/engine/MediaMTX da instalação, banco/mídia próprios,
PATH mínimo e distribuição loopback, saída PGM nula. Resultado em
scratch/RPlayout-ingest-qc-take-4MZuSe/result.json. Não é sinal físico,
teste visual dos scopes instalados, Windows limpo ou estação remota.

QA posterior: instalação integral PASS em scratch/r59-installed-qa-20261014,
recibo VERIFIED, 7 atalhos com alvo/diretório/executável conferidos.
Servidor instalado PASS2170ms, Node incluído/PATH mínimo, banco próprio,
health/interface200, asset index-DyNF8__v.js SHA
c82e6e261acc89cee8c69938d1e2d258e3b20e6761462ec23cd48ad8189c6175.
Encerramento observado, engine/transmissão desativados nesse ensaio.
Evidência scratch/RPlayout-portable-server-sjJ67g/result.json.
NOT_RUN de instalação/startup abaixo é histórico superado; não comprova
reprodução integral/hardware/Windows limpo, nem transfere testes r58.

ZIP540172023 bytes, SHA256
4346CF430BAC463F6E5E255D55A868F8EFC319BAF217C29DCC7AEF0F8E3A4232.
Integridade PASS:7095 entradas/7094 arquivos manifestados, hashes/tamanhos
conferidos. Evidência scratch/r59-zip-integrity-20261014/result.json.
Isso não comprova instalação/startup ou funcionamento desta edição.

Integra o lote scopes/áudio: buffers reutilizados, identidade de medição
estável, gradiente único do espectro, cache de cores do vetor sem reordenar
pontos e Parade por canal apenas quando não há sobreposição entre colunas.
QC mostra frequência efetiva4Hz parado/até10Hz em reprodução e custo local
p95 de desenho, reiniciado ao mudar fonte/versão/qualidade/layout.

Lote18 testes PASS, types/build web PASS (index-DyNF8__v.js), builds servidor
e engine release locked PASS. Comparação Canvas2D local:6 pares sintéticos
com pixels idênticos, ganho dependente de padrão/layout, não do QC integral.
Documentos QC-CANVAS-COMPARACAO-2026-10-14.md e matriz de pendências.

Avisos Node/GStreamer/Rust, inventários JS e atribuição NDI mantidos.
Inventário REVIEW_REQUIRED não autoriza distribuição final: faltam aviso
abstract-logging, termos NDI/MSVC e revisão de redistribuição/codecs.

Instalação/startup/testes funcionais desta edição NOT_RUN. Provas r58 são
históricas, não transferidas automaticamente. Não homologa hardware/sinais
NDI/OMT, estação remota, Windows limpo, CPU/rede ou carga prolongada.
DeckLink física adiada; grupo8 reservado à v3, nenhuma validação HA.
Releases anteriores preservadas, sem alteração de bancos operacionais.

10 grupos / 53 verificações:6 concluídas,33 em andamento,7 pendentes,7 v3.

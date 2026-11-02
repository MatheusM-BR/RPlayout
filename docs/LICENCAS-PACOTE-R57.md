# Auditoria de avisos e redistribuição — r57

Estado: REVIEW_REQUIRED, não autoriza publicação final. O inventário verifica
SHA/tamanho dos avisos e metadados lidos contra o manifesto da instalação.

Decisão do usuário em 19/10/2026: uso interno e testes, sem distribuição.
A próxima entrega será interna; não autoriza publicação pública ou upload de
binários ao GitHub. Separar a revisão de redistribuição futura da conferência
dos termos de uso interno e dos avisos dos componentes. REVIEW_REQUIRED não
foi convertido em aprovação; nenhum contrato foi aceito em nome do usuário.
Esta anotação não altera a r57 nem os pacotes já gerados.

Atualização19/10, sem alterar r57: documentos oficiais NDI localizados viaweb;
SDK6.3.2 citado na documentação, mas relação entre termos e DLL não comprovada.
Coleta local falhou DNS/nenhum PDF; REVIEW_REQUIRED e ausência do acordo do
pacote original permanecem. Próximo passo não é caçar licença de Tools ou
repetir pedido do arquivo antigo: obter SDK correspondente/confirmação oficial.
Ver NDI-TERMOS-LOCALIZADOS-2026-10-19.md. Nada autoriza publicação/aceite automático.

Drizzle: atualização supera pendência de pin/inclusão registrada abaixo.
Commit 03f6239c53c7132cf8ef08ff4f0cf70a1009de3f, coleta
scratch/js-notice-origin-pjx8MG, aviso incorporado via
RPLAYOUT_NOTICE_OVERRIDE_DIR nos 12 artefatos rebuildados PASS.
3 testes do coletor PASS, inclusive recusa de texto alterado/hash divergente.
Inventário server.cjs agora aponta somente abstract-logging sem aviso.
Versão é comparada antes de usar override; documentos sem commit fixo
não são aceitos. Nada altera retroativamente a r57 ou autoriza publicação final.

14/10: origem dos dois avisos JS investigada, evidência em
scratch/js-notice-origin-0QfhPr/result.json. Drizzle 0.36.4: LICENSE
oficial localizado no tag cujo package.json confirma nome/versão, SHA256
c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4.
Ainda falta fixar commit/procedência e integrar a coleta ao bundle.
abstract-logging 2.0.1: registry oficial informa commit
80dfaef91ee87008f4ed2b6e78921d383bccd406, mas LICENSE nesse commit retorna
404; README distribuído remete a um link externo MIT. Não foi substituído
por texto MIT genérico. Aviso completo/aplicabilidade permanecem abertos.

Rust: inventário offline/locked de Cargo para Windows gerado em
scratch/rust-notices-bezFtw/inventory.json: 75 pacotes, 144 avisos originais,
nenhuma ausência nesse conjunto. Cargo.lock SHA256
696205230e7b5d96f9a78f4bc862f2408425f21c1bf8ad8d882a60b2a0c57286.
É o grafo conservador resolvido (inclui build/test), não prova quais crates
foram ligados em cada executável nem cobre DLLs do GStreamer/OMT/NDI/MSVC.
Empacotador aceita RustNoticesDirectory, confere lock/hash/caminhos e inclui
avisos+inventário em licenses/rust. Nova build ainda não gerada com os avisos.

Servidor: coleta de avisos por metafile esbuild implementada em
scripts/bundle-notices.mjs e integrada aos 12 artefatos de build.
Build PASS; dois testes dirigidos PASS (texto/hash fiel, licença do filho
não atribuída ao pai). Inventários em apps/server/dist/third-party/*.json,
avisos originais copiados e hash de cada executável JS registrado.
75 pacotes distintos incorporados; faltam avisos diretos de abstract-logging
e drizzle-orm. Não inventar textos nem confiar apenas em SPDX; localizar
os avisos correspondentes à versão/origem e revisar NOTICE quando aplicável.
server.cjs permanece com SHA 28dbb9c6bd8801b003cf1641ca7f4bc99ffabe8a190376791f7110fcd26d979c.
Inventário cobre o bundle JS, não o better-sqlite3 externo/native/Rust.
Novos relatórios seguem na próxima build pelo empacotamento recursivo de dist;
não foram acrescentados retroativamente à r57.

Continuação da interface: atribuição/link NDI implementados no seletor
canônico, descoberta e adição de item. Cinco testes de markup PASS,
types web PASS. pnpm inicial falhou ao buscar metadados; validação concluída
pelos executáveis locais já instalados, sem download do gerenciador.
Não afirma certificado NDI nem autorização completa de distribuição.

Build da interface PASS com inventário de módulos efetivamente incorporados:
apps/web/dist/third-party/inventory.json, quatro pacotes (React, React DOM,
scheduler e Zod), quatro textos de licença copiados sem alteração, SHA256
registrados e nenhuma ausência de aviso nesse conjunto. Plugin em
apps/web/build/third-party-notices.ts, integrado ao Vite. O empacotador já
inclui recursivamente dist, portanto os documentos seguem na próxima build.
Status REVIEW_REQUIRED: não cobre servidor/Rust/runtime/termos comerciais.
Frontend atual index-PQSvNklv.js; ainda NÃO incluído na r57 instalada.

Node: aviso oficial v24.16.0 coletado em scratch/node-notices-qjLdex,
156926 bytes, SHA256 4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18.
Versão executada e SHA do node.exe incluído conferidos contra manifesto;
origem https://raw.githubusercontent.com/nodejs/node/v24.16.0/LICENSE.
Empacotador aceita `-NodeNoticesDirectory` e recusa versão/origem/hash
incompatíveis. Inclui LICENSE e provenance em licenses/node no novo ZIP.
Não modifica r57 retroativamente, não é autorização final de publicação.

Continuação: fonte local GStreamer conferida contra todas as entradas do
runtime da base r30 (CRT adicional Microsoft separado e assinado).
206 arquivos de avisos correspondentes localizados. O empacotador streamed
aceita `-GStreamerDistributionDirectory` para incluí-los em
`licenses/gstreamer`, também cobertos pelo manifesto/hashes do novo ZIP.
Helper: scripts/get-matching-gstreamer-notices.ps1. Conferência exit 0;
nenhum arquivo da r57 ou instalação operacional foi modificado.
A próxima build precisa passar esse parâmetro explicitamente; a omissão
não corrige automaticamente o pacote. Node/NDI/MSVC/Rust/frontend e
obrigações de fontes/redistribuição continuam em revisão.
Executar: Node incluído + scripts/verify-license-inventory.mjs + pasta instalada.
Evidência: scratch/license-inventory-0feAK8/result.json.

126 metadados npm, 120 arquivos de aviso, 21 apontamentos. Ausência de aviso
direto não prova ausência de licença: requer localizar e atribuir corretamente
o texto, sem usar a licença de um pacote filho para justificar o pai.

- OMT: LICENSE.txt presente e verificado; examinar separadamente libvmx.dll.
- MediaMTX: LICENSE presente e verificado; revisar dependências incorporadas.
- Node e GStreamer: sem aviso no diretório do runtime; incluir documentos
  correspondentes às versões/builds efetivamente distribuídos e dependências.
- NDI/MSVC: sem aviso nas pastas padronizadas; localizar termos e evidência
  de origem/distribuição autorizada. Não substituir por licença inventada.
- Rust/frontend: inventariar também dependências incorporadas nos binários,
  não cobertas apenas pelo node_modules de produção.

Documentação primária consultada:

- https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html
- https://docs.ndi.video/all/developing-with-ndi/sdk/licensing
- https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files

A documentação do GStreamer distingue o framework de plugins/dependências
e obrigações de distribuição. A documentação NDI contém condições de uso
e atribuição; a documentação atual não prova qual contrato se aplica à DLL
incluída. Conferir origem, versão e termos efetivos antes de liberar.
Não é parecer jurídico nem afirmação de que todos os apontamentos são
infrações. Não retirar codecs silenciosamente para fazer a auditoria passar.

10.2 e 10.5 permanecem abertos. R57 é entrega parcial de teste; funcionamento,
hashes e assinatura Microsoft não encerram a revisão de redistribuição.

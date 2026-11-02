# RPlayout r61 — parcial de teste, não homologada

QA posterior: instalação integral PASS em scratch/r61-installed-qa-20261014,
recibo VERIFIED e7 atalhos com alvo/diretório conferidos. Smoke instalado
PASS2719ms, Node incluído/PATH mínimo/banco próprio/interface200 atual
index-DXm-VHg6.js SHA313ea501550e1b35d91d572143ae8a7c022cdf6be50644c7d08d9bd178ec47e4.
Evidência scratch/RPlayout-portable-server-tjodUu/result.json, processo encerrado.
Engine/PGM desativados neste smoke. NOT_RUN abaixo é histórico superado apenas
para instalação/startup local; não valida reprodução/QC visual/Windows limpo.

Gerada release/RPlayout-1.1-parcial-20261014-r61-instalador.zip,
540173172 bytes SHA256
E784598DFF950493D275ECFD8072C7FB7E637E59413903F9B7AB8E2E8C37AAA6.
Integridade PASS7094 arquivos/7095 entradas em
scratch/r61-zip-integrity-20261014/result.json. Build web index-DXm-VHg6.js,
servidor e engine release locked PASS. Não prova instalação ou startup.

Integra r60 e lote de ingestão/QC/auditoria:
- Recuperação em lote aguarda todos os pedidos e identifica resultados parciais.
- Consultas de workflow limitadas/canceláveis, sem abortar mutações de retry.
- Seleção trocada descarta respostas antigas; clique duplicado bloqueado.
- MEDIA_JOB_RETRY_REQUESTED atômico com fila, ator/versão/tentativas/confirmação.
- Auditoria legível e detalhes CSV; histórico private,no-store.

Evidências de fonte: recuperação visual real de cache Eucuje, sem aprovação
automática; fila/rotas28 casos PASS, fronteira auditoria10 casos PASS,
cliente API e políticas de consulta PASS. Não somar reexecuções como casos novos.
Types servidor/web aprovados nos lotes correspondentes. Provas não equivalem
a execução deste pacote; instalação/startup e teste funcional r61 NOT_RUN.

Sem homologação externa NDI/OMT; DeckLink física adiada. Grupo8 reservado v3.
Licenças/redistribuição final REVIEW_REQUIRED, incluindo NDI/MSVC/codecs
e aviso abstract-logging. Não é publicação100% validada.

Totais10 grupos/53 verificações:6 concluídas,35 em andamento,5 pendentes,
7 para v3. Releases e bancos operacionais preservados.

# RPlayout r82 — parcial instalável interna

Destino: `D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r82-instalador.zip`.
R80/r81/projeto e evidências anteriores preservados. Registro pré-geração;
hash/tamanho/instalação posteriores serão documentados sem alterar o ZIP.

Corrige os sete pontos de entrada PowerShell de instalação, restore e upgrade:
importam Utility/Management do PSHOME da versão executada, sem depender de um
PSModulePath herdado de outra versão. Não muda configuração da máquina e não
instala PowerShell, Node, módulos JS ou ferramentas globais adicionais.
14 casos de bootstrap sob Windows PowerShell5 passaram, com caminhos herdados
e módulo estrangeiro prioritário; não são 14 fluxos completos de upgrade.

Servidor6B3E024C/launcher101A28C9/engine191CD1E1/web8B0D3FCB inalterados da r81,
sem necessidade de recompilar código não alterado. A r81 continua imutável.
Backup online da r80 durante arquivo nativo: READY, hash conferido, mesmo UUID
retorna o mesmo resultado e preserva PGM/cursor. Preparação na r81 FAIL antes de
restore por Get-FileHash indisponível devido à seleção de módulo conflitante.
Essa falha não foi reclassificada. R82 inclui o reparo, mas o ensaio completo
restauração/STAGE/ACTIVATE/adoção desta edição está NOT_RUN neste README.

Nenhuma instalação operacional, banco, cofre, mídia ou firewall alterado.
Não certifica Windows limpo, versão antiga de schema, downgrade/rollback,
hardware, fontes externas NDI/OMT, estação remota ou estabilidade prolongada.
Redistribuição REVIEW_REQUIRED: acordo original NDI ausente. DeckLink física
adiada; grupo8 reservado à v3. Parcial interna, não entrega final homologada.

Matriz segue 10 grupos/53 verificações. O estado pós-ensaio deve ser consultado
em PENDENCIAS-NUMERADAS.md; o artefato r81 anterior não homologa a instalação r82.

## Pós-geração

540.389.751bytes, SHA256
`72C6126684784BEC46BA3B4D1B5EE2F10B75671C889541BF595B64AF42EBFE80`.
Instalação QA integral/recibo/perfil/7destinos de atalhos PASS no D:.
TvKSa7 chegou à ativação, mas o engine191CD1E1 falhou ao configurar QC antes
do barramento PVW retido. FAILED autenticado, origem/cursor/as-run/perfil e
backup preservados, conforme conferência independente. Não recomendar r82
para retomar por esse fluxo; r83 inclui o reparo nativo. R82 permanece imutável.
Relatório `BACKUP-UPGRADE-R83-2026-10-16.md`.

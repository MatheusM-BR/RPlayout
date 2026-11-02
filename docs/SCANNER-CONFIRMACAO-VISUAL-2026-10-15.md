# 6.1 / 6.5 — conferência e repetição de varredura na página

## Implementação na fonte, posterior à r69

ScanCommandDialog agora limita a conferência GET a 10 segundos e permite
fechar enquanto a leitura está pendente. Fechar/cancelar troca somente GET,
nunca gravação. Desmontagem, StrictMode e mudança de raiz/modo invalidam a
conferência antiga. Falha de leitura não autoriza scan nem presume fila vazia.

Registro, retomada, repetição, reabertura após incerteza e fechamento com
resultado incerto têm confirmação na página. O checkbox começa desmarcado
por identidade/revisão/ação; trocar intenção revoga o consentimento anterior.
Há trava síncrona contra envios duplicados e os controles de gravação ficam
bloqueados enquanto aguardam resposta. Não há window.confirm neste diálogo.

O pedido enviado captura profundamente a conferência original (UUID, revisões
e pastas), modo, raiz e tipo. Repetição reutiliza exatamente esse objeto; não
busca nova revisão silenciosamente nem cria outro UUID após erro HTTP.
Recibo sem identidade/raízes/modo correspondentes não anuncia confirmação.
Retomada conserva o lote original; não reescreve seu modo pelo modo exibido
para uma nova varredura. Autoridade, CAS e deduplicação permanecem no servidor.

Mensagens distinguem registro pendente, COMPLETED, FAILED e UNKNOWN, sem
confundir varredura concluída com mídia aprovada no QC. Alteração de conta,
permissão ou processo operacional não faz parte desse lote.

## Testes de software

39 testes distintos / 6 arquivos PASS, não 38+39. Tipos web PASS, build web
PASS; aviso de tamanho do bundle preexistente. Inclui captura profunda/chave
de consentimento, recibo divergente, UNKNOWN, transporte GET cancelável vs
POST sem abort, markup desabilitado antes da conferência e contratos existentes
do backend de scan/recovery (autoridade fresca, revisão original e auditoria).

Última interface compilada: index-VDbA1LYp.js, SHA256
786A9D1F26BC204A5687CE69D9EDD452C0C3741DBF9614558DE430367F8F09BE.
Não está no ZIP r69, que foi preservado e não sobrescrito.

## Observação visual e persistência — lDk7DU

Fixture: scratch/editorial-read-browser-lDk7DU. Servidor/Node instalados r68
intactos; web da fonte explicitamente indicada por --source-web. Controlador
QA usa tsx local e banco próprio, não representa requisito do produto.
Web observada COhBd2bE, SHA256
8310f83a63a506197cf4e60205dd0d0fb173fed1b352de9fa2652a23cefaaee4;
servidor5F33C58E. Isso NÃO qualifica outra instalação ou Windows limpo.

Sonda instalada configurada somente para permitir um scan de diretórios
vazios sintéticos; nenhum arquivo de mídia, execução nativa da sonda, engine,
broker ou saída física foi homologado neste cenário. Interface/navegação
automatizada ficaram nesse QA, sem contas/permissões/privacidade operacionais.

1. GET de conferência retido: indicador de consulta e confirmação desabilitada;
   erro recuperável após 10009ms, sem POST de varredura nessa fase.
2. Reabertura sem falha: pastas Unicode e consentimento desmarcado; botão
   desabilitado até autorização explícita.
3. POST real registrou o pedido no backend. Gateway de QA esperou o upstream
   terminar200 e substituiu SOMENTE a resposta por502. Tela preservou UUID
   ff388841-b06a-447a-96ff-5549ebc84371 e bloqueou novo scan/retry automático.
4. Consentimento de repetição foi marcado; trocar para reabrir deixou o novo
   consentimento desmarcado. A reabertura não foi executada; prova antiga
   permaneceu preservada. Retornar à repetição exigiu novo consentimento.
5. Restabelecida a resposta, repetição explícita enviou corpo SHA256 idêntico
   ao primeiro. Backend200 devolveu o mesmo lote
   343b8ea5-5d3d-42af-ad49-0604aa8cb898 em COMPLETED. Uma decisão manual
   MEDIA_SCAN_QUEUED, duas API_MUTATION, um lote relacionado, nenhuma retomada.
   Três OUTROS lotes automáticos vazios constam separadamente; não alegar
   que havia apenas um lote total no banco.
6. Outra conferência retida foi fechada durante leitura: GET cancelado em
   6094ms, antes do deadline. Não houve POST adicional.
7. As-run0, conta mutada0, POST ao receptor externo sintético0. A aba própria
   foi fechada e o processo próprio terminou exit0. Evidência final não se
   baseia apenas em arquivo de lock ou intenção de encerramento.

Asserções read-only: result.json, scan-evidence.json e assertions-scan.json,
gerado por scripts/verify-editorial-read-evidence.mjs em modo scan: PASS no
escopo declarado. Screenshots: scan-review-timeout.png,
scan-consentimento-limpo.png e scan-mesmo-pedido-confirmado.png.

Após o cenário, a mensagem de COMPLETED foi esclarecida, a captura passou
a exigir também canEdit e foi adicionado aviso de que retomada conserva o
modo/raízes históricos. Essa pequena diferença final teve testes/tipos/build;
não foi repetido todo o cenário visual por mudança de texto. Os hashes
distintos acima delimitam a evidência, sem ocultar a diferença.

## O que ainda falta

6.1: demais editores/confirmadores ainda têm consultas sem prazo e caixas
nativas (metadata/remoção de ativo, templates/artes e regras, entre outros).
Fechar o conjunto dessas interfaces e qualificação integrada, sem presumir
que o teste deste diálogo as cobre. 6.5: cenário visual de retomada de dono
morto/incerto e demais reservas/legado continuam abertos; contratos de backend
não equivalem a recuperação visual/native completa. Não agir no grupo8v3.

Incorporar o lote numa próxima build consolidada; a r69 é a última parcial
entregue e não contém esta alteração posterior. Não fazer limpeza/migração.
Totais mantidos:10 grupos/53 verificações,6 concluídas/36 em andamento/
4 pendentes/7 v3. Testes automatizados não somam requisitos encerrados.

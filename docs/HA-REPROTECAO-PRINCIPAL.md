# Reproteção isolada no principal — NOT_RUN

Atualização 11/10: provas de assinaturas de execução/distribuição/servidor/
manutenção/restauração/ativação preservadas como histórico estrangeiro. Worker e
parent confirmam mesmo atestado do selo; originais não são reassinados como posse
local. API/página mostram evidência, sem autoridade/PGM. Checkpoints são JSON e
journals HA em operator_decisions usam proteção padrão já coberta; ainda falta
revisão semântica, não uma suposta decifragem especial desses registros. NOT_RUN.

Orquestração/diário/API/página integrados em lote; nenhum teste/build executado.
Fora R55. Usa o mesmo 12º auxiliar ha-return-review-worker.cjs.

Recebimento completo próprio deve ter ponte autenticada. Pedido estrito com
rekeyId/transferId/channelId, sem caminhos/chaves do navegador. Administrador,
canal, controle de transporte e sessão estável reconferidos. UUID repetido consulta
mesma intenção; uma reproteção por recebimento, sem retry/overwrite automático.

Diário cifrado ACCEPTED antes da cópia, REKEYING antes do auxiliar, resultado
REKEYED_STAGED somente após confirmação. Espaço e quota reservam outra cópia
mais 256 MiB de margem/journal; falhas/parciais continuam reservadas.
Diretório UUID novo e privado, rekeyed.db vazio com identidade conferida.
SHA recebido e cópia bruta conferidos antes da reproteção. SQLite escreve somente
nessa derivada; arquivo recebido e banco ativo não são abertos em escrita.

Importador confere pareamento/exportação, PK, hash do ciphertext e inventário
completo conhecido; recifra no cofre do principal na transação e remove a ponte
da derivada (ela permanece na evidência recebida). Worker confirma fingerprint
do cofre realmente usado; parent exige correspondente ao seu cofre. Sem chave
privada copiada, sem criar/trocar automaticamente chave ausente.

Após auxiliar, exige consolidação sem WAL/SHM/journal pendentes e releitura do
SHA/identidade do destino; origem permanece com mesma identidade/tamanho/tempos.
Diário conserva SHA original recebido, SHA reprotegido, tamanho, número de campos
e fingerprint. Timeout/cancelamento/perda de posse/falha deixa FAILED/parcial,
não aprova nem libera banco. Query histórica não confirma estado atual da derivada.
API/página não revelam caminhos ou plaintext/chaves.

operationalApproved/publicationAuthorized=false. Abrir PGM, instalar banco,
selecionar cursor ou transferir autoridade NÃO faz parte deste comando.
Cobertura atual protectedColumns; contextos customizados de journals/checkpoints
continuam exigindo tratamento e validação próprios antes de restauração.

Faltam revisão do conteúdo reprotegido/contextos especiais, edição/mídia/cursor/
comandos, retenção/geração perdida, integração de plano operacional e retorno/rejoin;
testes de byte/key/ciphertext/PK/schema/crash/quotas/cancelamento/permissões,
homologação, build e publicação. Fixtures de contrato adicionadas: NOT_RUN.

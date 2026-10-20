# Construtor isolado do candidato de retorno — NOT_RUN

Atualização: orquestração integrada em fonte no HaReturnStore/API/UI, também
NOT_RUN. Ver HA-ORQUESTRACAO-CANDIDATO-RETORNO.md. Ausência de integração abaixo
é histórico da etapa anterior; candidato STAGED ainda não autoriza operação.

Atualização: bootstrap genérico openDatabase agora recusa marcador
ha_return_candidate_origin ANTES de alterar journal/migrar/abrir a operação.
Nem proveniência ilegível/vazia libera essa cópia. Inspeção privada usa driver
readonly; fluxo de retorno deverá gerar derivada explicitamente validada, sem
apagar marcadores para contornar o bloqueio. Guard também NOT_RUN.

Auxiliar/runner implementados em fonte, sem executar testes/typecheck/build.
Fora R55. A orquestração pública de materialização ainda NÃO foi ligada: faltam
intenção/diário/quota/SHA/identidade antes/depois/API/UI no HaReturnStore.
Não anunciar candidato criado ou disponível apenas pela existência do auxiliar.

materializeReturnCandidate lê somente inspection.db readonly em transação e
aceita descriptor interno com seleção, candidato UUID, SHA/fingerprint/instante.
Destino deve ser candidate.db NOVO/vazio, em diretório privado daquele UUID,
regular, link único, local, sem junções em todos os ancestrais. Worker recebe
modo INLINE explícito só no seu ambiente privado: não altera storage do servidor
ativo nem introduz fallback quando o serviço de banco estiver ausente.

Cria schema local atual do zero via inicializador existente; não copia tabelas
de contas, saídas, sessões, posse de execução/distribuição, as-run ou comandos.
Canal arquivado, SDI/slate removidos, grades exigem publicação. Cada revisão
selecionada recebe identidade derivada local; origem preservada cifrada.

Variante bloqueada não reutiliza paths/endpoints estrangeiros: path vazio e
asset ignored/BLOCKED; vínculos de entrada removidos; grafismos/eventos executáveis
não são importados como ações. Originais completos ficam somente no envelope
privado de proveniência, para materialização posterior de vínculos verificados.
Isso não é variante pronta: bindingsResolved/nativePrepared=false.

Checkpoint operacional é parado/vazio, sem owner/receipt/trim estrangeiros.
Intenção de último cursor, quando escolhida, permanece separada e cifrada usando
contrato HA existente que conserva origem e não extrapola tempo de parede.
Cursor estrangeiro não é autorização de execução na instalação local.

Após gravação, confere integridade/referências, ausência de saídas/execução/
as-run importados, consolida WAL em DELETE e verifica identidade do destino.
Parent deverá ainda confirmar fechamento do worker, SHA/tamanho/identidade e
origem antes de registrar resultado. Timeout/crash pode deixar parcial: conservar,
não adotar/repetir automaticamente. Auxiliar utiliza o 12º bundle existente.

Faltam orquestração acima e protocolo de ativação explícita após bindings verificadas,
materialização real da mídia/local inputs/outputs/QC/mixes/trims/grafismos/eventos,
planos KEEP_PRIMARY/híbridos, revisão atual do principal, autoridade/retorno/rejoin,
retenção/geração perdida e homologação. Fixtures de contrato preparadas NOT_RUN.

10 grupos (1 concluído/9 abertos), 53 verificações (5 concluídas/36 em andamento/
12 pendentes). Nenhum fechamento novo.

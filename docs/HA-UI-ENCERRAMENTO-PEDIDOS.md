# Encerramento de tentativas interrompidas na página

11/10 — implementação em fonte, NOT_RUN. Sem testes/build, fora R55.

As telas de revisão local e criação da cópia mostram um painel de conferência
quando o pedido consultado está ACCEPTED/CHECKING ou ACCEPTED/APPLYING.
Esses estados não são apresentados como prova de processo encerrado.

A ação exige justificativa e confirmação explícita do operador. Antes de
enviar, consulta o alvo e exige mesmo UUID/canal/fase/data, sem resultado.
Depois guarda a intenção com recoveryId em sessionStorage antes do POST.
Erro/recarregamento permite apenas consultar o mesmo encerramento, sem replay.
Mudança de contexto invalida respostas antigas. Nenhuma tentativa é apagada.

A confirmação exige identidade exata e os indicadores de parciais/histórico/
quota preservados, sem replay e sem autorização. Depois oferece atualização
do alvo por consulta. Não marca FAILED apenas por receber erro, nem presume
interrupção por tempo decorrido. Servidor mantém gates de trabalho ativo e
ausência comprovada do processo anterior.

Integração abrange os pedidos já consultados nas duas telas. Ainda falta
listagem de pedidos anteriores ao navegador/execução, recuperação das outras
etapas e solução explícita para intenção cujo POST não foi registrado.
Também permanecem qualificação/QC/contingência e retorno operacional completo.

Totais: 10 grupos (1 concluído, 9 abertos); 53 verificações (5 concluídas,
36 em andamento, 12 pendentes). 8.5/8.6 continuam em andamento.

# Diário privado da revisão pós-ganho

11/10 — implementado em fonte, NOT_RUN. Sem testes/compilação/build; fora R55.

Novo diário cifrado registra intenção antes da medição. Pedido contém somente
UUID de revisão pós-ganho, UUID da cópia e canal. Captura interna contém revisão
de mídia, SHA de media.db, MAC pre-gain, perfil local/fingerprint e UUID AUTO
adotado. Ganho/perfil/path/medições não são aceitos no pedido do navegador.

Estados ACCEPTED → MEASURING → REVIEWED ou FAILED. Resultado persistido contém
runtime, data, MAC e resumo; evidência privada fica cifrada no mesmo registro,
limitada a 16MiB, com reserva de 64MiB por intenção e limite de 1024 registros.
Reserva mantém histórico inclusive de falhas. Consulta exclui recibos privados
e owner; nunca reexecuta. UUID reutilizado para outro pedido é recusado. DELETE
e substituição de intenção são bloqueados; transições exigem estado observado
exato em transação, estados terminais não são alterados pelo diário.

Execução exige owner atual/ACCEPTED, plano correspondente à captura e callback
de reconferência antes/depois. Resultado usa binder estrito e resumo recomposto;
perda de ownership/cancelamento não fabrica fechamento confirmado. Consulta
privada reconfere MAC, runtime, plano e resumo, só na instância proprietária.
Encerramento interrompido requer fase/data exatas e prova de processo parado
antes/durante a transação; não libera quota nem cria nova tentativa.

Store cria o diário, inclui reservas no total de quota e oferece consulta
interna; tabela incluída no namespace privado permitido de HA. Ainda NÃO há
orquestração de início pelo Store, captura confiável do perfil da aplicação,
API/UI nem ligação à listagem/diário de recuperação. Não executar o método
accept isoladamente como se a cópia estivesse qualificada. Esses gates precisam
validar STAGED, SHA/identidade/bytes da cópia, decisão AUTO registrada, acervo/QC,
runtime e sessão, inclusive dentro da fila e depois da medição.

Fixtures NOT_RUN: pedido sem parâmetros de mídia, UUID/owner, reserva mantida,
consulta sem replay, evidência cifrada/privada, revisão terminal sem reexecução,
plano divergente, falha sem prova. Não validam o runtime ou instalação.

Permanece medição estéreo isolada sem cauda/transições/A-V/bus qualificados;
não aprova QC/editorial nem libera PGM/saídas/autoridade ou retorno real.

Totais mantidos: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes). 8.5/8.6 em andamento.

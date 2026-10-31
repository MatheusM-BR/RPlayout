# Adoção explícita de AUTO na nova cópia de retorno

11/10/2026 — implementação em fonte, NOT_RUN. Não incluída no R55.

Fluxo conectado: revisão local → seleção/justificativa → decisão registrada
ou consultada → marcação explícita de adoção → novo pedido de cópia → Store
reconfere decisão local/evidência → worker privado deriva outra base.

O pedido aceita somente autoDecisionId opcional, além dos IDs existentes.
Não recebe gain, LUFS, paths ou medição fornecida pelo navegador. Sem esse ID,
permanece o comportamento anterior e nenhum bloqueio AUTO é dispensado.
A opção da página começa desmarcada. A intenção da cópia continua preservada
antes do envio e consultável pelo mesmo UUID, sem replay.

O Store exige decisão pertencente à instalação/execução corrente, revisão,
canal, MAC e SHA da base correspondentes. Reconferência de arquivos/QC,
runtime e plano permanece antes/depois da construção. Identidade da decisão
também é conferida nesses limites. A proposta é recomposta dos recibos
privados no servidor e no worker, nunca adotada de valores do cliente.

Somente SELECTED_AUDIO_MEASUREMENT_MISSING dos itens explicitamente adotados
pode deixar de bloquear a derivação. Outros erros e itens não selecionados
continuam bloqueados. Itens duplicados impedem adoção inequívoca. Apenas
masters originalmente AUTO com medição MEASURED são elegíveis; contingência,
live, MANUAL/OFF e alterações globais de mídia não são convertidos.

A nova cópia recebe measured/analysisId dos recibos selecionados, preservando
ganho, corte, roteamento e pares auxiliares. A identidade da variante inclui
valores adotados e proveniência. O diário privado registra UUID/count; o
servidor exige confirmação desse UUID e da quantidade pelo worker antes de
confirmar STAGED. A grade e a base originais não são alteradas.

O contrato de uma tentativa por revisão não foi relaxado: uma cópia já
solicitada sem AUTO não pode ser substituída pela mesma revisão. Nova revisão
explícita é necessária para outra tentativa. Sem helper atualizado o pedido
não confirma criação; uma nova build será necessária ao terminar o lote.

Ainda não prova áudio após ganho/limitador, barramento, sincronismo A/V, QC
final, saídas ou autoridade. STAGED permanece parado/quarentenado, sem PGM.
Pendências: recuperação de intenções/interrupções, contrato de contingência,
qualificação completa, grafismos, retomada/rejoin e homologação física.

Fixtures preparadas, NÃO executadas: adoção em nova cópia, identidade,
preservação do original, bloqueios remanescentes, revisão incorreta e recusa
de valores de áudio no pedido. Validação conjunta e build ficam para depois
do lote, conforme orientação do usuário.

Totais: 10 grupos (1 concluído, 9 abertos); 53 verificações (5 concluídas,
36 em andamento, 12 pendentes). 8.5/8.6 continuam em andamento.

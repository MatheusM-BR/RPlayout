# Confirmações operacionais na página

Lote pós-r65, requisitos 4.1/4.5/6.2 em andamento.

`ReviewedOperationConfirm` substitui caixas nativas `window.confirm` em:
inserção Próximo/Agora, enfileiramento de próxima grade, reconhecimento de
incerteza com canal parado e habilitação de continuidade recorrente.
Texto e checkbox ficam visíveis na página, desmarcados por padrão.
Botão só habilita após autorização explícita para a conferência atual.
Trocar revisão/operação recria a confirmação; bloqueio e envio limpam o
consentimento. Guarda imediata contra clique repetido; tokens, permissões,
limites e requestId do backend permanecem obrigatórios. Não aceita uma
conferência diferente silenciosamente nem ativa automação ao abrir a tela.

## Validação em lote

6 testes dirigidos PASS (3 do controle compartilhado, 2 próxima grade,
1 continuidade). Tipos web PASS; build web `index-CEI6tlbJ.js` PASS,
SHA256 AD8C73F90DE3E6121DB819A9649874FBA757804AB8DD805501DE0A052D0C63B3.
Aviso existente de tamanho do bundle; sem ganho de desempenho presumido.

Fixture `scratch/priority-playout-2jU2wg`:
`verify-priority-playout.mts --browser-insertion`, mídia real sintética,
engine nativo e saída null. Banco/cofre/conta/raiz MAM próprios; probe/proxy/
MediaMTX desativados. Aprovação de mídia é semente de QA, não workflow MAM.

Conferência pela habilidade de navegador, sem tocar na aba operacional:

1. Conferir Próximo exibiu resumo e checkbox desmarcado, confirmação inativa.
   Marcar habilitou o botão, sem inserir por si só.
2. Conferir Agora substituiu a revisão e limpou a marcação anterior; nova
   confirmação continuou inativa. Voltar a Próximo também exigiu nova marcação.
3. Confirmar Próximo gravou revisão 2 e exibiu o item na lista como Próximo,
   mantendo o VT no PGM e CUE vazio. Não houve caixa nativa bloqueante.
4. Nova conferência Agora veio desmarcada. Após marcar/confirmar, engine
   confirmou novo item no PGM e a tela mostrou o recibo, sem repetir TAKE.
5. Verificador SQLite readonly `verify-insertion-visual-result.mts` PASS:
   exatamente dois comandos/dois commits, fases CONFIRMED, modos NEXT/NOW,
   revisões 1→2→3, oito itens editoriais preservados/dez itens publicados.
   NEXT `nativeProgramConfirmed:false`, sem as-run. NOW `true`, as-run NATIVE
   ligado à revisão 3/SHA, início0/fim1317/STOP da própria fixture.
6. Aba própria fechada; rotina fez STOP do canal isolado e comprovou
   encerramento próprio, sem matar PIDs históricos.

Primeira tentativa de seleção com label exato não encontrou o controle;
DOM confirmou labels concatenados com opções, seleção refeita no seletor
observado. Nenhuma inserção foi enviada nessa tentativa.

O Monitor exibiu alarme de preto na fixture e o fallback de proxy ficou
indisponível. Esses pixels não foram tratados como prova de saída PGM:
decisões/as-run comprovam execução nativa, não aprovação física ou qualidade.
`browserValidated:false` do recibo automático foi preservado; a observação
visual é registrada aqui separadamente.

Capturas: `consent-reset.png`, `next-confirmed.png`, `now-confirmed.png` na
pasta da fixture. Backend E5E95ECDB75DFBD2B597C0C11709C73B2340233F20F0C5DE869311A5FBA03CDD.

## Falta

Validar os mesmos controles de próxima grade/continuidade/reconciliação no
navegador com plano completo e engine, falha de resposta/crash, concorrência,
estado que muda após marcar e estação remota. Não herdam homologação visual
por usarem o mesmo componente. Integração instalada permanece separada.

10 grupos/53 verificações: 6 concluídas,35 em andamento,5 pendentes,7 v3.

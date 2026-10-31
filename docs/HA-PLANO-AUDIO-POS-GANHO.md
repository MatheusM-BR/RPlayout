# Planejamento e medição isolada pós-ganho

11/10 — implementado em fonte, NOT_RUN. Sem testes/build; fora R55.

Planejador recompõe montagens das edições congeladas, mídia local e recibos
pre-gain. Perfil local explícito contém canal, alvo LUFS, teto, cadência e bus;
deve ser capturado e reconferido pelo servidor, não recebido do navegador.
Exige canal/cadência/bus das edições iguais; não converte implicitamente.

Ganho master usa effectiveGainDb compartilhado com a visão operacional:
OFF é zero, MANUAL usa o declarado, AUTO exige medição correspondente.
Decisão AUTO opcional recomposta dos recibos privados substitui somente a
medição autorizada, sem converter modo ou alterar original. Nunca chama o
fallback de ganho zero para AUTO sem evidência. Pares auxiliares usam ganho
próprio e são medidos separadamente; não herdam normalização do master.

Identidade de cada job inclui montagem exata, fingerprint do perfil, MAC
da revisão, UUID AUTO e ganho/teto efetivos. Perfil, decisão ou corte alterado
produzem outra identidade. Ganho fora da faixa da sonda fica explicitamente
UNSUPPORTED; não clampa silenciosamente. Contingência/live ainda requerem
contratos próprios; não são aprovadas por omissão.

Runner interno serial/baixa prioridade executa cada job com proteção de
mídia/runtime/cancelamento e correlaciona ganho/teto/key. Alteração do runtime
durante o lote invalida-o. Falhas por job permanecem FAILED; interrupção ou
perda de ownership encerra o lote sem fabricar resultado. Nenhum recibo
pós-ganho pode ser usado como pre-gain para calcular AUTO.

O medidor usa agora qualidade 8 de resampling, como o ramo de item do engine.
Isso muda o runtime; recibos anteriores continuam sujeitos à reconferência
de SHA. Não significa pipeline/bus completo homologado: DSP isolado/reset,
cauda não descarregada, transições e A/V pendentes.

Ainda interno, sem integração durável/UI/Store de qualificação. Próximo:
capturar perfil local estável, correlacionar à cópia/aplicação AUTO registrada,
persistir e expor somente resumo, aplicar política técnica e concluir bus,
cauda/transições/A-V e homologação. Não libera QC/PGM ou engine.

Fixtures NOT_RUN: ganho OFF/MANUAL/auxiliar, AUTO sem evidência bloqueado e
com decisão explícita, perfil mudando identidade e canal/cadência/bus errados.

Totais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes); 8.5/8.6 em andamento.

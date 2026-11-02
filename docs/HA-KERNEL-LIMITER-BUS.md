# Kernel compartilhado de limitação do barramento

11/10 — implementação em fonte, NOT_RUN. Sem compilação/testes/build; fora R55.

BusLimiter extraído do elemento de streaming para o módulo DSP compartilhado.
Engine e medidor pós-ganho usam o mesmo núcleo. Mantém link completo no modo
original e independência por par no modo pair-linked; extração/intercalação e
redução máxima são as mesmas operações do elemento anterior. Limiter de cada
grupo conserva estado entre buffers. Área de trabalho do par é reutilizada,
não recriada por buffer; amostras de um par não entram no estado do outro.

Caps/teto inválidos recusados antes de iniciar. PCM parcial do bus é recusado
antes de alterar amostras/estado, em vez de descartar bytes restantes. Atraso
da instância e maior redução expostos para sonda/telemetria. Elemento mantém
negociação, configuração de teto, reset em stop e telemetria máxima existente.
Helper estéreo continua apenas medição isolada, agora pelo mesmo BusLimiter.

Fixtures NOT_RUN para 2/8/16 canais: comparação amostra a amostra/redução com
limiters independentes de referência ao longo de buffers de tamanhos distintos;
caps/teto inválidos e frame parcial recusados. Nada foi executado. Alteração
no streaming exige regressão consolidada antes de build/entrega homologada.

Ainda não há render de barramento completo conectado ao workflow de revisão.
Próximo: pipeline real master/auxiliares com audioconvert/resample/volume/mixer,
caps e pares locais explícitos, medição de bus/cauda por par e transições/A-V.
Não substituir o pipeline real por soma simulada como prova operacional. Sem
aprovação de QC/PGM/saídas/retorno ou equivalência medida neste checkpoint.

Totais 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes), 8.5/8.6 em andamento.

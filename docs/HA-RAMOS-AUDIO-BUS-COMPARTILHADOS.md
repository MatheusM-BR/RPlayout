# Ramos reais de áudio compartilhados com o engine

11/10 — implementação em fonte, NOT_RUN. Sem testes/compilação/build; fora R55.

Construção dos ramos de item extraída de channel.rs para audio_bus.rs e ligada
ao caminho operacional. Master mantém audioconvert → resample qualidade8 →
volume → caps estéreo, expansão para bus 8/16 quando necessária. Auxiliares
continuam originando do tee da trilha decodificada ANTES do master; matrix
normalizada, resample8, volume comum, caps posicionais e mixer continuam reais.
Não monta o bus somando recibos de áudio nem aplicando ganho do master aos pares.

Ligação dos ramos também compartilhada: main, tee raw, ramo auxiliar e mixer.
Canal mantém configuração pelo pad/caps reais e renegociação, medidor, sinks,
ready/estatísticas e sincronização do pipeline. Volume retorna a mesma instância
para atualização operacional. Nenhuma nova transmissão ou admissão é criada.

Construtor valida bus/pares e ganho linear finito; entrada insuficiente continua
recusada por AuxiliaryRouting contra canais reais, não por inferência do bus.
Limiter permanece no estágio de saída operacional com estado contínuo; não foi
movido para dentro de cada item. Sonda offline deverá declarar seu estado/reset.

Fixtures NOT_RUN inspecionam construção/propriedades/topologia para2/8/16,
master independente, mixer/auxiliares, resampling e canais reais exigidos.
Não são teste de fluxo PCM, execução, equivalência nem homologação física.

Ainda falta sonda de bus completo ligada ao construtor, seleção de trilha,
corte exato, medição por par e aplicação persistida dos recibos. Depois:
transições/continuidade/cauda/A-V, política/QC/grafismos/engine/saídas/autoridade/
retorno/rejoin/hardware. Mudança no canal exige regressão consolidada do lote.

Totais mantidos:10 grupos(1 concluído/9 abertos),53 verificações
(5 concluídas/36 em andamento/12 pendentes),8.5/8.6 em andamento.

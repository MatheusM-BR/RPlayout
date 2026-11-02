# Sonda isolada de áudio após ganho e limiter

11/10 — implementada em fonte, NOT_RUN. Sem compilação/testes/build; fora R55.

rplayout-audio-analysis aceita postGain opcional com gainDb e ceilingDbtp.
Modo anterior permanece sem ganho/limitação e com o mesmo contrato de resposta.
Novo modo exige corte explícito, ganho finito [-60,12] e teto finito [-30,0].
Não recebe inferência automática de ganho, alvo ou configuração de canal.

Após selecionar trilha, roteamento e amostras exatas do corte, aplica escala
linear e o mesmo Limiter DSP usado pelo elemento de programa. Lookahead 5 ms
e release 50 ms agora são constantes compartilhadas com o elemento, evitando
duplicação de parâmetros. Limiter começa RESET; redução máxima é registrada.
Não substitui o pipeline de programa por uma autorização de transmissão.

Resposta traz processing ISOLATED_POSTGAIN_LIMITED_STEREO com ganho/teto,
lookahead/release, redução, estado inicial, tailFlushed=false, busQualified=false,
transitionQualified=false e publicationAuthorized=false. Não mede continuação
da cauda após o fim do corte nem memória do limiter na troca entre itens.
Os 240 quadros de atraso interno não são confundidos com prova de A/V.

Servidor fornece runner isolado e leitor estrito distintos do pre-gain.
Ambos usam SHA/stamp da mídia/runtime antes/depois, processo de baixa prioridade,
parent-pipe, limite de resposta/tempo e cancelamento por perda de ownership.
Leitor pós-ganho exige parâmetros exatos e PCM cobrindo o corte; pre-gain não
aceita esse recibo como medição para calcular AUTO. Runtimes antigos sem modo
novo não fornecem evidência válida; nova build será necessária ao fim do lote.

Não ligado ainda ao workflow persistido/UI de qualificação da cópia. A próxima
integração deve escolher ganho efetivo do AUTO/adotado e perfil de canal
explicitamente, persistir evidência e reconferir identidade. Ganhos fora da faixa
desta sonda exigem contrato ampliado conforme engine, nunca clamp silencioso.
Continuam pendentes política de loudness/pico/redução, bus 2/8/16, auxiliares,
transições/cauda, sincronismo A/V, aprovação editorial e homologação física.

Fixtures Rust/TypeScript preparadas, NOT_RUN: parâmetros finitos/faixa,
PCM não finito/contagem, correlação de ganho/teto e recusa de flags de
aprovação/barramento/transição ou confusão com medição pre-gain.

Totais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes); 8.5/8.6 em andamento.

# Orquestração da decisão AUTO de retorno

11/10/2026 — NOT_RUN, sem testes/typecheck/build, arquivos/medidores/navegador
executados. Ainda não fecha 8.5/8.6.

Store instancia diário AUTO imutável e contabiliza reserva 256KiB por decisão,
máximo 1024 registros. Replication admite o namespace do diário e expõe opções,
gravação e consulta. Rotas admin por canal, no-store, permissão TRANSPORT para
gravar, identidade estável e auditoria por canal; somente IDs/justificativa/MAC,
nunca caminho ou leitura arbitrária do cliente.

GET auto-options recompõe opções a partir da origem privada e dos recibos:
somente masters já AUTO com montagem local medida, sem contingência live. IDs
e loudness/LRA/true peak são mostrados sem caminhos. Conferência de opções não
é autorização. POST auto-decision passa pela fila, reconfere fonte selada, plano,
mídia/QC e runtimes antes da gravação. GET auto-decision consulta pelo mesmo ID,
sem reaplicar ou repetir medições. Uma nova intenção não substitui a anterior.

Preparação interna da decisão pode admitir exclusivamente o bloqueio
SELECTED_AUDIO_MEASUREMENT_MISSING; qualquer outro erro permanece impeditivo.
Esse modo não é exposto ao navegador nem usado pelo construtor comum de cópia.
Logo registrar decisão NÃO torna revisão/cópia apta e NÃO remove erro de AUTO.

Ainda falta interface do operador, aplicação explícita da decisão em nova
derivada, contrato de contingência sem default global, QC selecionado e ensaio
de ganho/limiter/barramento/sincronia. Consulta sem registro após falha exige
recuperação explícita: não há retry automático. Históricos/R55 preservados.

Totais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes). Sem nova build ou homologação.

# Servidor de vídeo da reserva — preparação NOT_RUN

MediaMtx oferece startConfirmed sob configuração própria, posse de distribuição,
cerca de host e callback de admissão atual. A autoridade é reconferida antes da
configuração/spawn e depois da readiness da API/incarnação/portas do processo
próprio. Não adota processo encontrado em porta ocupada nem infere sua identidade
por PID informado externamente.

stopConfirmed acompanha todos os filhos criados pela instância e aguarda callbacks
de saída. Kill/timeout não significam parada confirmada. Não libera posse nem
encerra processo alheio. Chamador deve reter a reserva quando o resultado for falso.

O adaptador agora liga o lifecycle: depois da transferência validada, confirma
parada do warmup, constrói handle de mídia rastreável, reserva distribuição na
cópia e declara somente paths dos destinos loopback explicitamente revisados.
Confirma readiness antes de abrir a geração cercada. Destinos remotos não
criam servidor local nem viram loopback automaticamente. Portas divergentes,
credenciais incompatíveis e publishers no mesmo path são recusados.

Encerramento do adaptador exige parada confirmada de engine E mídia antes de
liberar recursos; perder constructor do engine não deixa de tentar fechar mídia.
Cancelamento proíbe novas aberturas, mas não bloqueia cleanup próprio. O guard
genérico do staged app continua fechado; este caminho é interno e explícito.

O painel agora recebe apenas paths PVW/MON e porta WHEP do handle próprio, quando
promoção/geração/readiness correspondem. Usa o hostname pelo qual o navegador
acessou a interface, não o loopback do servidor. Ver abre a sessão WHEP existente,
sem outro engine, CUE ou TAKE; Ligar/Desligar continuam comandos explícitos admitidos.
Fechar visualização não é desligar codificação. Nenhum destino remoto vira WHEP
local e nenhum URL com credencial é devolvido ao browser.

Observação durante operação agora verifica, sem sobreposição, a API loopback e
incarnação/portas/posse do processo próprio. Perda invalida readiness, registra
HA_MEDIA_READINESS_LOST quando storage permite e encerra somente mídia própria,
sem reiniciar/adotar outro processo. Se o PGM depende desse MediaMtx, também
encerra o engine próprio; falha apenas PVW/MON não deve interromper PGM SDI.
Painel distingue readiness de mídia, engine e confirmação histórica.

Cleanup de engine e mídia é tentado independentemente; falha em um não impede
tentar o outro. Liberação exige confirmação de ambos. Callbacks/timers são
drenados; erro de cleanup mantém reserva, não presume parada.

Falta validar conexão real do navegador, perdas e recuperação/reconfiguração;
controles/fronteiras/contingência/replicação também pendentes. Adaptador ainda não
é default. Sem testes/build: não anunciar HA pronta.

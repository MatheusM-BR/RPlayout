# Implementações broadcast — controle de escopo

Escopo: relatório anotado e pedidos anteriores do operador. Não considerar
compilação, descoberta ou saúde do servidor como homologação de sinal físico.
Atualizado em 04/10/2026. Implementações anteriores permanecem em auditoria.

Pausa solicitada após QC em 04/10/2026: UI-04 + SEC-20 são o checkpoint
preservado; não há conclusão integral nem pacote final 100% homologado.
Pendências consolidadas e prompt pronto para retomar:
[Continuação após QC](PROMPT-CONTINUACAO-APOS-QC-2026-10-04.md).
As referências a objetivo ativo nas seções anteriores são históricas.

SEC-18 — presets conferidos em 03/10 às 20h52: criação, remoção e aplicação
SRT/RTMP exigem o ETag do canal que o operador recebeu. GET entrega lista e
counter de um snapshot privado. Migração 22 acrescenta três triggers ao
contrato 21, cobre ABA/mudança de dono e invalida uma vez as telas anteriores.
Startup/restauração recusam proteção adulterada. Sessão/papel/canal/arquivo
do canal são reconferidos no commit imediato; escrita, counter e auditoria
sem destinos privados são atômicos. Falha reverte tudo antes de rebuild.
Preset antigo com protocolo/destino incompatíveis não é aplicado. Excluir
preset não elimina saídas já criadas. Commit seguido de falha de engine é
resposta de configuração gravada com aviso, nunca rollback ou entrega fictícios.

A tela preserva a lista em erro, distingue consulta de lista vazia e não
rotula habilitação como ATIVO NO AR. Rascunho guarda sua revisão; atualizar
lista não substitui a prova de abertura. Reabertura explícita pede confirmação
antes de descartar os campos; sucesso próprio pode avançar a própria base.
Troca de canal remonta o editor e respostas de consultas antigas são ignoradas.
Monitores já leves não geram UPDATE/versão nova a cada sincronização; upgrade
real continua reduzindo resolução/FPS/bitrate sem alterar o programa.

144 arquivos/1099 testes passaram às 20h49m53 (101,66s); tipos, build, cargo
check e diff check passaram. Ensaio r6LjSm: dois servidores compilados HTTP
64946/64947, PIDs 19944 e 6516→7444, revisão 1→11, vencedor único tanto em
canal quanto em preset, ABA recusado, três falhas de auditoria com rollback,
remoção preservou saída aplicada, reinício e backup/migrações 22 passaram.
SQLite compartilhado/SIMULATED, não replicação, HA, entrega física ou visual.
Primeiro verificador parou por import de dependência fora do workspace do
servidor; ajuste para edição SQLite de nome, sem import externo. Fixtures
iniciais tinham argumento default de headers e inserção de segredo legado;
corrigidos para ausência real de header e inserção pelo cofre, testes repetidos.

QA 4041 atualizada após conferir processo exato, PGM parado/CUE vazio, políticas
DISABLED/v0 e backup pré-migração. Novo PID 29152/sessão 32071. Canal 1 conserva
14 itens/revisão 25494162001883; RW 13/revisão 1744; ambos SIMULATED/parados.
Counter de configuração agora 168123508636337 após migração 22; GET presets
retorna o mesmo valor/ETag por canal. HTTP 200 serve index-YSZ6XXGI.js /
index-CZEXkAEj.css, com reabertura e qualidade QC, não prova visual. SHA servidor
28C809D4E3373B302F27F304B5656B471C89DC564C8B6CEB00C57991A8F2213B.
Backup pós-update 23-51-39-323Z-4e71b72a-c4da-444f-b63c-f756f27726ff validou
integrity/foreign keys/migrações 22/cofre; removed[]. Pacote r21 preservado.
Objetivo amplo aberto: próprios CRUD/hot-ACK de saída e reconciliação durável,
projetos/QC e demais guardas, banco separado, HA/replicação/fencing, pacote
Windows final e homologação física/visual/soak. A revalidação isolada anterior
do QC não encerrou novos requisitos; esta etapa fez mudanças de implementação.

SEC-17 — configuração conferida em 03/10 às 20h18: PATCH do canal e
simulação/aplicação de FPS exigem ETag próprio ao canal da abertura. Ausência
428, formato inválido/outro canal 400, versão superada 409; não busca versão
nova para autorizar rascunho antigo. Sessão/papel/dono reconferidos dentro do
commit imediato. Mudança de canal, contador/revisões editoriais e auditoria
antes/depois ficam atômicos; falha de auditoria reverte tudo antes de fechar
runtime. Alterações em saída invalidam o formulário do canal. Isso ainda não
impõe revisão nas próprias rotas CRUD de saída/preset/projeto/QC e afins.
FPS sela também os campos incluídos na confirmação e contadores editoriais;
ABA de item/configuração não restaura validade de simulação antiga. STOP/CUE
limpo, histórico/tempos convertidos e nova publicação continuam obrigatórios.
Formulários guardam baseline de abertura, enviam apenas campos alterados,
mantêm edição em recusa e só descartam ao reabrir explicitamente (com aviso).
Mudança de canal durante resposta não sobrescreve o formulário novo. Após
conversão própria, consulta recarrega estado; falha exige reabrir, não finge
nova autorização. Reinício é solicitado, não sucesso físico presumido; erro
de reconstrução/recuperação retorna configuração já gravada com aviso, sem
anunciar rollback fictício. Navegação/uso visual ainda não homologados.
141 arquivos/1073 testes passaram às 20h14m20 (115,27s), tipos/build/cargo
check/diff check passaram. Primeiro fixture de fetch reutilizava Response
consumida; corrigido para resposta nova por chamada. Anotação de this no teste
de recuperação corrigida após diagnóstico do compilador; typecheck repetido.
MEFrv4: dois servidores compilados HTTP 64227/64228, PIDs 5908 e 24292→30316,
contador 1→6; uma escrita por revisão, ABA recusado, rollback conjunto,
formato selado, consulta após reinício idêntica e backup restaurado passaram.
SQLite compartilhado/SIMULATED: não é replicação/HA. XUVzCf: HTTP 64298,
engine release 13664→25852, PGM ativo recusado, corte 25/250→50/500, publicação
histórica byte-preservada e as-run 25/50 FPS, sem TAKE automático. Saída null,
sem publisher PVW, não física. eOSzbr (HTTP 64128/receptor local 64127) passou
reconfiguração geométrica com retorno PGM, saídas, restore, arquivamento,
reativação e comandos sem replay com as guardas novas; antes do ajuste final
de mensagens/erro de recuperação. Nenhum desses ensaios homologa placa real.
QA 4041 agora PID 25440/sessão 10317 após conferir executável/comando/listener
e PGM parado/CUE vazio; Canal 1 14/revisão 25494162001883 e RW 13/revisão 1744
preservados. Políticas DISABLED/v0 conferidas antes. GET configuração HTTP 200
com ETag, PATCH sem revisão 428 manteve DTO/counter idênticos. HTML/JS HTTP 200
com reabertura e QC em qualidade, não prova visual. Bundle index-EXIpb3Se.js /
index-CX3GfQEa.css; SHA servidor
ACB10BC525F72F2FF38630FB11203146C79A366760B985B6FA5BBF2356059781.
Backup pós-update integrity/foreign keys OK, migrações 21/cofre verificado,
nenhum backup removido; cinco PIDs finais dos verificadores ausentes e zero
engines nativos remanescentes. Pacote r21 preservado; novo pacote final não
produzido. Objetivo integral aberto: guardas restantes, banco separado,
HA/replicação/fencing, homologação física/visual/soak e entrega portátil final.

QC — revalidação em 03/10 às 19h52: Ver em qualidade/retorno ao preview leve
continuam na barra acima do player. Indicadores de scopes/áudio agora acompanham
a fonte exibida: proxy, player do original, quadros JPEG ou preview ao vivo.
Quadros não anunciam escuta; trocar qualidade limpa estatísticas anteriores.
Alvo de loudness usa a configuração do canal, sem -23 fixo na tela. Não é
certificação de cor/scopes. Ensaio compilado Bk77K1 (HTTP 63639/PID 25648):
JPEG 3840×2160 contra 320×180 leve, original SHA idêntico, QC PENDING e zero
decisão nova. Processo próprio encerrado. Playback/visual no navegador não
validados nesta revisão; qualidade de live continua fora desta opção.
139 arquivos/1047 testes passaram às 19h48m29 (119,35s), typecheck, build,
cargo check e diff check passaram. JS index-DG5w5sef.js/CSS index-CX3GfQEa.css;
SHA servidor 6E38AD0F782FC26FF7769002F8728E486C5D943D8671A5F1ECF93E2F14374B29.
QA 4041 atualizado para PID 28652/sessão 87015 após conferir identidade,
listener, PGM parado/CUE vazio e preservar duas grades: Canal 1 14/revisão
25494162001883; RW 13/revisão 1744. Políticas DISABLED/v0 permaneceram;
transportes SIMULATED. HTML/JS HTTP 200 incluem controles, não prova visual.
Backups antes/depois da migração restaurados com integrity/foreign keys OK,
cofre verificado, nenhum backup removido. Pacote r21 não foi sobrescrito.

Configuração — checkpoint anterior (superado por SEC-17 acima): migração 21 cria contadores por
canal com triggers SQL de canal/saídas, tombstones e limite numérico. DTOs de
consulta capturam campos/revisão no mesmo snapshot; startup/restauração
recusam contrato ausente ou adulterado. Seis testes conferem ABA, rollback,
outro escritor/reabertura, remoção/reinserção, saídas e backup. Esta é a base,
não proteção completa da edição: If-Match nas rotas de configuração, sessão
revalidada no commit e baseline imutável dos formulários ainda pendentes.
Nenhuma dessas guardas será anunciada como aplicada apenas pelo contador.
Objetivo integral continua aberto: demais mutações, banco operacional separado,
HA/replicação/fencing, pacote final e homologações física/visual/soak.

AUDIO-03 — integração no produto em 03/10 (complementa a base nativa abaixo):
configuração 2/8/16 persistida por canal, padrão legado 2, migração 20
transacional/idempotente e CHECK SQL validado em startup/restauração de backup.
Formato do canal oferece total; diálogo de áudio substitui seletor SDI fictício
por atribuições reais: entrada numerada da trilha escolhida → par auxiliar de
saída, ganho -60..+12 independente do master. Não atribuído fica em silêncio.
Não presume nomes SAP/clean/audiodescrição; medição AUTO continua exclusiva
do mix master e não certifica loudness dos auxiliares. Formulário conserva
edição após recusa, valida canais conhecidos e não usa zero legado como prova
de ausência. Desconhecido exige verificação nativa; ausência comprovada recusa.
Servidor aplica trilha/master/auxiliares juntos por escopo/revisão. Escopo
amplo/padrão compartilhado verifica todos os canais e trilhas dos alvos antes
de escrever; um destino estéreo incompatível reverte todos, inclusive padrão
e escolha de trilha. Total novo exige valor anterior conferido (428/409), PGM
parado e CUE limpo. Redução não apaga pares incompatíveis para conseguir salvar.
Mudança permitida conserva fotografias históricas, marca-as SUPERSEDED e
exige nova publicação, sem TAKE. Configuração de FPS e áudio é separada.
Publicação congela total/pares, conferência incorpora o contrato, rollback,
execução, contingência/cache/continuidade recusam total incompatível. Publicação
antiga sem campo continua estéreo, nunca 8/16 presumido. Mudança após CUE
invalida TAKE; checkpoint inclui total e não retoma em outro barramento.
Projeto legado restaura estéreo e reconfere seus pares antes do commit.
Ensaio compilado/release jfKqnw (8, HTTP 62480, servidores 4280→24508,
engines 30716→23752): pares 3–4 e 7–8 atribuídos, master medido -23,281 LUFS.
PYZp0I (16, HTTP 62534, servidores 29580→21412, engines 29088→9232): pares
3–4 e 15–16 atribuídos, master -23,286 LUFS. lTSnot (2, HTTP 62696,
servidores 15884→29428, engines 18288→29988): regressão estéreo -23,253 LUFS.
Os três verificam pares/master congelados, ganho -6 após roteamento, medição
-8,761 LUFS durável após reinício, seleção real indisponível preservando PGM,
sem publicação de preview. Processos próprios encerrados. Amostras de todos
os canais/limiter foram medidas nos testes Rust anteriores, não pelo medidor
estéreo HTTP destes ensaios. Sem placa física, rede externa ou latência homologada.
138 arquivos/1035 testes passaram às 19h13m48 (102,11s); tipos/build/cargo
check/diff check passaram. A primeira rodada encontrou backup antigo sem
schema_migrations: compatibilidade restaurada sem relaxar contrato da migração
20. Primeiro ensaio 8 foi recusado por zero legado; corrigida a distinção
desconhecido/sem áudio e repetido com sucesso. Falhas não contam como prova.
QA 4041 atualizado para PID 20416 / sessão 24842, transportes SIMULATED
(processos ENGINE sem PID; engines=2 em health conta runtimes, não hardware).
Bundle index-egGfFQFa.js / index-CX3GfQEa.css. Duas grades preservadas:
Canal 1 14/revisão 25494162001883; RW 13/revisão 1744; PGM/CUE vazios/parados.
Políticas de publicação/continuidade conferidas DISABLED/v0 antes do reinício.
Backups antes/depois restaurados com integrity/foreign keys OK/cofre verificado;
19→20 migrações, sem reinterpretação de publicações ou edição das grades.
Servidor atual SHA256 ED9CCAA1006B39C96DF7DF4EBA9FE1A1C7C195C1762AD2ECF84E9A4845ED6EB6.
Ainda pendentes: homologação SDI/DeckLink e visual/uso no navegador; novo
pacote final e demais requisitos da matriz. Não declarar o objetivo concluído.

Fechamento AUDIO-03: declarações brutas de áudio agora acompanham o asset
independentemente de geometria de vídeo. hasAudio NULL/canais NULL continuam
desconhecidos; false explícito prova ausência. Servidor, publicação e formulário
usam a mesma leitura; trilhas conhecidas não somem quando probe de vídeo falta.
138 arquivos/1036 testes passaram às 19h24m22 (112,89s); tipos/build passaram.
Servidor final SHA256 FAF4CE52038481D6B0D33D8C334876DFD73E76A7AD658903A7879DCF88E06F37.
Repetições com este binário: QHCecx (8, HTTP 62918, servidores 8048→29968,
engines 4788→4596) master -23,213 LUFS; IX54cj (16, HTTP 62948,
servidores 10916→17236, engines 26528→28240) -23,242 LUFS; ambos passaram.
ARxKkJ (8, HTTP 63098, servidores 25616→30696, engines 29608→23224)
passou com fixture 4ch real e has_audio/audio_channels/audio_tracks todos
NULL no banco: decoder entregou master e aceitou auxiliares; a fixture 2ch
real continuou recusada. AUTO -23,213 LUFS e resultado durável após reinício.
Servidores/engines próprios encerrados. Não é SDI físico ou rede ao vivo.
QA final: PID 26872, sessão 47471, JS index-AHoIBJCO.js/CSS index-CX3GfQEa.css
HTTP 200, declarações brutas presentes na API e nenhum PID de engine nativo.
Grades novamente conferidas 14/25494162001883 e 13/1744, PGM/CUE vazios,
paradas, padrão estéreo preservado. Não houve inspeção no navegador.

Revalidação do QC em 03/10: botão Ver em qualidade permanece acima do player,
com retorno ao preview leve e tela cheia. Ensaio 02mQw3, servidor compilado
isolado PID 17220 / HTTP 58016: quadro do original 3840×2160, preview 320×180,
SHA do original idêntico, QC PENDING e nenhuma decisão de aprovação criada.
O servidor próprio foi encerrado. QA 4041 entrega index-CwIvxGe0.js e mantém
o modo leve por padrão. Qualidade original é opt-in para arquivos, não live;
erro de codec informa inspeção por quadros, sem prometer áudio ou playback.
Suíte atual: 133 arquivos / 1019 testes, 96,00s, início 18h18m57; tipos,
build servidor/web, cargo check e diff check passaram. Verificação HTTP/SSR
e geometria JPEG não substituem homologação visual/playback no navegador.

AUDIO-03 — base nativa multicanal em 03/10, ainda PARCIAL no produto:
engine aceita --audio-channels 2/8/16 (padrão 2). Par 1 continua master;
pares auxiliares explícitos selecionam um par da trilha decodificada,
com ganho independente. Pares sem atribuição permanecem silenciosos;
seleção ausente/inválida recusa o candidato sem trocar o PGM. Não há
inferência de SAP, clean feed ou audiodescrição a partir de outro par.
Limitador vincula L/R dentro de cada par, sem limitar o master por um
auxiliar mais alto. Medidores, preview e publicadores IP permanecem estéreo
com os canais 1–2, sem somar os auxiliares. SDI prepara S32LE/48k em 2/8/16,
mas nenhuma placa física foi homologada. Captura DeckLink solicita 2/8/16
conforme os canais de entrada efetivamente necessários, não o total de saída.
Conversão de canais numerados usa identidade explícita e máscara sem posições;
fontes: https://gstreamer.freedesktop.org/documentation/audioconvert/index.html
e https://gstreamer.freedesktop.org/documentation/decklink/decklinkaudiosink.html.
Para 8/16, eliminado produtor/mixer permanente redundante; interaudiosrc
selecionado fornece silêncio quando vazio. Arquivo aguarda buffers reais
no preroll com prazo limitado, em vez de presumir prontidão pelo estado GST.
Falha assíncrona durante TAKE agora gera item_error não fatal, cancela apenas
o candidato e preserva o programa anterior; servidor limpa pendência sem
registrar saída do VT ou assumir confirmação de troca.
Testes nativos completos, incluindo OMT local oficial: 65 passaram,
104,66s. Amostras reais 8/16 comprovam CUE sem áudio no PGM, TAKE com ganhos
independentes, seleção indisponível preservando PGM, A/B sem vazamento de
pares antigos e STOP silencioso. Fault injection testa a falha pendente,
não um emissor NDI físico. OMT local entrega vídeo/áudio reais de uma fonte
estéreo com mapeamento auxiliar explícito; não prova rede/placa externas.
Coleta após estabilização de 1500ms não homologa latência de TAKE.
Engine release SHA256 F93B65160F091E4F51B0AD3E206F20157A36D5C5CB4C75F32A68DF6E26FFF051;
servidor 8AC641EB9AD9D47EAD2FE7C4BA7344EFF8E6774B1E0452E21E71EC7E62C14BFA.
Regressão estéreo VgPIcN com servidor compilado/engine release passou:
seleção 3–4, ganho -6 após roteamento, mix medido -8,761 LUFS, AUTO no PGM
-23,237 LUFS, resultado durável após reinício e canais reais ausentes
preservando o programa. Ensaio isolado encerrou seus dois servidores e
engines. Não valida CUE/PVW visual, publicação IP ou placa física.
Naquela etapa de base ainda pendiam contrato persistido por canal/item,
publicação, API e interface; foram integrados no complemento AUDIO-03 acima.
A validação física e o novo pacote portátil continuam pendentes. O padrão
permanece estéreo; o seletor fictício foi substituído pelo editor de pares reais.

QC — complemento do botão Ver em qualidade em 03/10: mantida a barra
própria acima do player, original por escolha e retorno ao preview leve.
Controles e scopes agora derivam o mesmo modo do player realmente montado,
sem estado paralelo de vídeo/quadros. Sem URL reproduzível ou após erro de
decodificação, inspeção por quadros fica pausada: play desabilitado, sem
ícone de reprodução sobre imagem estática nem indicação falsa de playback.
A régua permanece disponível. Trocar qualidade não aprova material nem dá TAKE.
24 testes específicos e suíte completa (133 arquivos / 1018 testes, início
16h25m36, 91,52s) passaram; typecheck, build servidor/web e diff check
passaram. Ensaio nativo FXirpJ em servidor compilado isolado (PID 15312,
HTTP 56549): JPEG 3840×2160 contra preview 320×180, SHA do original idêntico,
QC permaneceu PENDING e sem decisão. Processo encerrado pelo ensaio.
QA HTTP 4041 já entrega index-K1PlsxIO.js / index-CHBQOgyM.css, ambos 200;
botão, retorno e aviso de quadros presentes no bundle. Sem reinício ou edição
das grades: Canal 1 14/revisão 25494162001883, RW 13/revisão 1744,
ambas paradas e PGM/PVW vazios. Não houve homologação de playback/layout no
navegador, live em qualidade, SDI físico ou novo pacote portátil.

TIME-07 / complemento TIME-04 em 03/10: montagem e publicação
recorrentes pela pauta implementadas, separadas da autorização TIME-06 para
entrar no ar. OWNED_EMPTY_DAYS, desligada por padrão. Conferência HMAC vincula
canal/formato/QC/pauta, versão da política, conta/permissão, antecedência,
limite, datas futuras e grades já presentes. Habilitar exige prova e versão
atual; leitura não monta/publica nem cria runtime. Antecedência 1–7 dias,
limite 1–5000 itens/dia, padrão 2 dias/2000 itens. Pauta deve cobrir os sete
dias de 0–1440 min, sem gap/sobreposição. Dia civil com mudança de fuso exige
programação manual. Grade manual/incompleta não é substituída; grade própria
já publicada é preservada e publicação alterada exige intervenção explícita.
Acervo aprovado pode evoluir sem liberar material pendente; perfil de canal,
VIDEO/SHA/corte/áudio e repetição são conferidos. Critério usa as-run e reservas
de publicações anteriores, com timestamps previstos, inclusive entre dias.
Seleção determinística/exata em auxiliar CJS separado, baixa prioridade,
limites de acervo/itens/input/output/tempo; auxiliar não recebe DB/cofre/engine
nem credenciais do ambiente. EOF do dono encerra espera pelo pedido. Parent
valida plano/faixas/repetição, confere bytes de cada edição aprovada e identidade
dos arquivos imediatamente antes do commit. Mídia/QC/histórico/pauta/formato,
reservas de publicação, datas e direitos são revalidados; não escolhe outro
vídeo após a conferência nem aplica corte/filler para esconder sobra.
Ledger protegido existente: RUNNING/READY/FAILED, claim IMMEDIATE e dono
host/PID/boot. Outro dono vivo/remoto/unknown não é roubado. Interrompido local
com PID comprovadamente morto vira FAILED; exige nova conferência, sem replay
ou publicação presumida. Grade + itens + fotografia publicada + READY +
auditoria são um único commit síncrono; falha de auditoria desfaz todos.
Cada dia é atômico: dia anterior concluído não é apagado se o seguinte falhar.
STOP canônico/externo e arquivamento suspendem. STOP autorizado sem view agora
também suspende automação; STOP sem direito não a desliga. Não envia TAKE,
não altera PGM/CUE, não aprova QC e não promete continuidade/sinal por duração.
Tela de programação contém painel recolhido, conferência→habilitar/desligar,
limites, motivo de recusa e trabalhos/datas. Troca de canal descarta respostas
antigas; direitos vêm do servidor. Antes da resposta, indica CONSULTANDO ESTADO,
não uma política desligada presumida. SSR é markup, não layout/uso no navegador.
Auxiliar schedule-planner.cjs é build-in e obrigatório nos scripts de pacote;
usa Node embutido, não tsx/tsc/pnpm no destino. Nenhum pacote final foi criado.
W3rWGh: servidor compilado, HTTP 53321, PIDs 10788→16396; arquivo Unicode real
de 1h/25fps verificado pela sonda release (duração 3600000000000ns e quadro).
Dois dias completos, 24 itens/dia/2160000 quadros, sem conflitos. Reinício após
primeiro READY preservou sua revisão e concluiu segundo dia; original/hash,
grade manual, aprovação e ausência de TAKE/as-run conferidos. Revisões
4342985b-b2e8-42f1-bb21-052b3ebe57bc e 6daadc66-6095-461e-9046-d6d61baaf1bd.
STOP suspendeu; reabilitação conferida + disable preservaram as publicações;
helper EOF retornou 2. G6zk2e/FGdIew repetiram estágios anteriores. Ensaios próprios
e portas encerrados. Primeiro ensaio VYqt1w excedeu o prazo de decodificação
integral de 1h; verificador corrigido para duração indexada + quadro real, sem
anunciar sucesso daquele timeout. Fixture fracionária foi corrigida para
1798/2589411 quadros, segundo os conversores reais, não alteração de timing
para acomodar expectativa errada. Teste adicional revelou STOP sem view e
orientou a correção; nenhum 404/falha foi contado como validação.
133 arquivos/1012 testes passaram às 16h03 (96,72s) e na repetição final às
16h11 (104,05s); tipos/build/cargo check e
diff check passaram. Aviso de tamanho JS permanece. QA 20284 foi encerrada
somente após confirmar executável/comando/listener, SIMULATED parado, CUE/PGM
vazios e contagens/revisões. QA atual PID 25848/session 48478/HTTP 4041, mesmas
grades Canal 1 14/revisão 25494162001883 e RW 13/1744. Ambas políticas editoriais
DISABLED/version 0/jobs 0, auxiliar disponível. index-CDgMfahy.js/CSS
index-CHBQOgyM.css e painel/QC HTTP 200. Sem nova validação de navegador,
reprodução PGM nativa desta montagem, saída física ou soak 24/48h. Não é HA.
Ficam abertos pares de saída SDI/PGM multicanal, guardas globais restantes,
banco operacional separado, HA/host B/replicação/fencing, pacote final e
homologação física/visual/longo prazo. Objetivo integral continua ativo.

QC — controle de qualidade explícito em 03/10 às 15h17: botão de arquivos
movido da barra de timecode para uma barra própria acima do player, com
quebra de linha para não disputar espaço com os contadores. Ver em qualidade
carrega a edição original conferida por hash; Voltar ao preview leve conserva
o modo econômico. O modo selecionado, custo de rede/codecs e fallback por
quadros são identificados separadamente; selecionar original não afirma que
o navegador já o decodificou. Tela cheia tem nome acessível. Troca limpa a
mensagem anterior, sem aprovação automática nem comando ao PGM. Safe permanece
desligado por padrão. Entrada ao vivo continua leve, sem anunciar HQ inexistente.
Novos cinco testes SSR cobrem os estados da barra, incluindo live/sem arquivo;
SSR não equivale a interação/layout visual no navegador. Testes específicos:
18 aprovados; suíte completa: 129 arquivos/988 testes, início 15h13, 108,13s.
Typecheck, build servidor/web, cargo check e diff check passaram. Aviso de
tamanho do bundle permanece. Ensaio jm8f8l com servidor compilado, PID 8700,
HTTP 50330 e arquivo Unicode 4K real: JPEG HQ 3840×2160, leve 320×180 e SHA
do original idêntico; inspeção manteve QC PENDING, sem nova decisão. Processo
e porta do ensaio encerrados. Não valida playback browser, live HQ ou SDI.
QA existente PID 20284/HTTP 4041 já serve index-Blur3YVv.js e
index-ze-3EOrk.css sem reinício: HTTP 200, barra/botão/retorno presentes no
bundle. Grades preservadas: Canal 1 14/revisão 25494162001883 e RW 13/1744;
ambas SIMULATED paradas, PGM/CUE vazios. Não houve novo pacote portátil nem
homologação visual/física; demais pendências globais continuam abertas.

Continuação TIME-06 em 03/10 às 14h54: política recorrente PUBLISHED_ONLY
implementada no servidor e exposta no Master, dentro de Próxima grade.
Desligada por padrão; leitura/conferência não habilitam, não carregam grade,
não aprovam material e não aplicam TAKE. Habilitar exige publicação inicial,
engine nativo pronto, conta/permissão atual e prova da configuração/primeira
passagem, vinculada a formato, versão da política e origem. Atraso máximo de
0–180 min é conferido também no EOS. Publicações futuras são selecionadas pela
cronologia congelada, não por data/título do rascunho; início empatado,
intervalo/sobreposição ou prazo vencido não são resolvidos pulando outra grade.
Cada origem enfileira um pedido determinístico, reusa o ledger de TIME-05 e
somente PGM nativo confirmado instala destino/checkpoint/as-run. Políticas e
auditoria ficam nos registros protegidos existentes, sem tabela/migração nova.
STOP canônico/externo, cancelamento autorizado e arquivamento suspendem; falha,
incerteza e perda de autoridade/formato exigem nova conferência. Não há replay
automático de passagem falha/incerta. Versão da política muda ao suspender e
invalida intenções/provas antigas. Cancelamento inválido não suspende política.
Dono local inclui host/PID/boot/engine; outra instância não rouba processo vivo.
Retomada exige ambos PIDs locais comprovadamente mortos; estrangeiro/unknown
permanece bloqueado, sem inventar fencing remoto. Claim e auditoria ocorrem no
mesmo commit. API omite dono/worker/contrato privado e distingue CURRENT_SERVER,
WAITING_RECOVERY e OTHER_OR_UNKNOWN_SERVER, sem equiparar habilitação a sinal.
Passagem enfileirada valida política/autoridade atuais no EOS e cessa após
desligamento. Campo público workerState é só categoria, nunca processo/dono.
0wJtIA: servidor compilado em HTTP 64730, PIDs 26572→12312; engines release
25300→24756. Três arquivos Unicode reais, saída null/PVW desligado. Duas
passagens consecutivas entre publicações confirmaram PGM/as-run; reinício no
primeiro VT preservou cursor, intent e identidade, recuperou dono após ambos
processos acabarem e não duplicou a fila. Habilitar não fez TAKE; STOP suspendeu.
Revisões 6c8fc9c9-2900-4b9f-81aa-7fcb58267ad7,
bbbb5f97-f3a8-46fa-97e5-936d21212898 e f3d4cb13-5dc2-4856-b0b6-9a9a7557ab0d.
PpqkED repetiu o fluxo na build anterior desta etapa. Ensaios próprios encerrados.
Validação final: 128 arquivos/983 testes, início 14h49, 85,28s; typecheck,
build servidor/web, cargo check e diff check passaram. O primeiro ensaio revelou
428 convertido em 409 pelo wrapper: corrigido preservando CollaborativeEditError.
Teste de privacidade foi ajustado para propriedade worker, não substring da
categoria pública workerState. Nenhuma falha foi tratada como prova de sucesso.
Guard MEDIA-06 também usa identidade operacional ativa, não só flag editorial
publicationRequired (limpo ao publicar); teste cobre publicação ativada sem SHA.
QA própria anterior 23740 encerrada só após reconferir processo/comando,
SIMULATED parado, CUE/PGM vazios e contagens/revisões iguais. QA atual 20284 /
session 85260, HTTP 4041, mantém Canal 1 14/revisão 25494162001883 e RW 13/1744.
Ambas políticas DISABLED/version 0/worker OFF. Bundle index-D_qlRVAI.js e CSS
index-D9GOEo6B.css HTTP 200 contêm os controles e QC em qualidade; aviso de tamanho
permanece. Não é inspeção visual, reprodução browser, CUE/emissão física ou HA.
PUBLISHED_ONLY não monta nem publica automaticamente a pauta editorial; essa
parte de TIME-04 continua pendente, assim como pares SDI/PGM multicanal, guardas
globais restantes, banco separado, HA/replicação/fencing, pacote final e ensaio
físico/visual/longo. Nenhum novo pacote portátil produzido; objetivo ativo.

Continuação MEDIA-06 em 02/10: identidade real da mídia publicada agora é
conferida no transporte nativo, não só na ingestão/metadata. SHA integra o
contrato do CUE/preroll; arquivo local é verificado antes de carregar e antes
do TAKE, incluindo retomada, próxima playlist/contingência e preparo antecipado.
Publicação obrigatória sem SHA válido não aceita presença de arquivo como prova.
Leitor usa handle, compara inode/dispositivo/tamanho/mtimeNs/ctimeNs antes/depois
de calcular SHA e confere novamente o caminho. Cache de evidências é limitado
a 512 caminhos por verificador e invalidado quando identidade ou SHA mudam.
Arquivo substituído após CUE exige novo CUE mesmo quando os bytes forem
restaurados. Mudança/restauração durante preroll recusa decoder ambíguo; próxima
tentativa prepara novamente. Medição histórica READY não autoriza conteúdo novo.
Inspeção original e arquivo de versões usam o mesmo verificador robusto.
Falha de versão devolve HTTP 409/MEDIA_VERSION_CHANGED com ação corretiva.
Não manda STOP/TAKE para o PGM anterior e não cria as-run de corte recusado.
Unpublished legado sem SHA continua sem prova de versão; URI legada não é
homologação de mídia. Checagens não são lock/WORM contra escritor externo
futuro: arquivos controlados/arquivados continuam sendo a opção operacional.
Ensaio Glkmv7: servidor compilado PID 21188, engine release 24032, HTTP 54295,
saída null, sem PVW. Original Unicode sem media_versions/cópia de cache; cache
indisponível propositalmente. Após medição/aplicação AUTO/publicação, troca dos
bytes foi recusada 409; PGM anterior continuou avançando, nenhum as-run do
arquivo alterado. Restauração entrou com AUTO a -23,224 LUFS, um as-run.
Revisão 70c88e43-a7b7-47bd-94fd-82ff47a80abe, medição
6abd0b3c-410c-4e6f-a66a-01f8db4fb520. Ensaios Glkmv7 e LbeZh7 encerraram seus
próprios processos/portas; não provaram CUE/saída física, live ou navegador.
Validação final: 126 arquivos/970 testes, início 12h42, duração 105,23s;
typecheck, build servidor/web, cargo check e diff check passaram. Bundle
index-XO-FB8En.js / index-D9GOEo6B.css; aviso de tamanho permanece.
QA própria 5724 encerrada após reconferir PID/comando, canais SIMULATED parados,
PGM/PVW vazios e grades intactas. QA atual PID 23740/session 46496, HTTP 4041,
preserva Canal 1 com 14 itens/revisão 25494162001883 e RW com 13/revisão 1744.
Index/bundle HTTP 200 incluem QC em qualidade/medição, sem prova visual.
Não se criou pacote portátil novo. Permanecem pares de saída SDI/PGM multicanal,
publicação recorrente TIME-04, guardas globais restantes, banco separado,
HA/replicação/fencing, pacote final e homologação física/visual. Objetivo ativo.

Revalidação UI-03 em 02/10 às 12h29: build web index-D0VTIg0B.js servido em
HTTP 200 na QA, com Ver em qualidade e Voltar ao preview leve. Testes de markup
QC e rotas de preview: 2 arquivos/10 testes aprovados. Ensaio qa4CSM em banco
isolado, servidor compilado PID 6028/HTTP 54031, confirmou JPEG original
3840×2160, preview 320×180 e bytes originais com SHA idêntico. QC continuou
PENDING/sem decisão. Servidor do ensaio encerrado; QA e grades preservadas.
Não prova playback, composição visual ou aferição de cor no navegador.

Continuação AUDIO-02 em 02/10 às 12h23: medição real do mix escolhido e ganho
AUTO ligados ao diálogo de áudio. Novo auxiliar rplayout-audio-analysis usa o
mesmo roteador e medidor BS.1770 do engine, mede a trilha escolhida do arquivo
inteiro antes do ganho/limiter e recusa áudio ausente/incompleto. Botão Medir
mix escolhido é explícito; live continua MANUAL/OFF, sem inventar uma medição
de arquivo. Matriz/trilha/versão distintas invalidam o resultado exibido.
Fila durável usa registros protegidos AUDIO_MIX_ANALYSIS; autorização/revisão
da tela conferidas na transação de criação, um claim por trabalho, limites de
fila e worker separado de baixa prioridade. Consulta respeita item/canal e
não expõe worker/caminho. READY é vinculado a SHA, trilha e matriz; aplicação
revalida todos os alvos do escopo, usa exclusivamente os números persistidos
do medidor e não aceita ganho/loudness fabricados pelo cliente. Padrão exige
compatibilidade com trilha inicial. Nenhuma análise aprova QC ou aplica TAKE.
Mudança de mídia durante análise descarta resultado. Encerramento marca só o
trabalho próprio como FAILED; queda comprovada do dono local não vira sucesso
ou repetição automática. Claims de outro host/PID ainda vivo não são roubados.
O auxiliar encerra ao perder o pipe do servidor, sem decoder órfão. Medição
FILE não é medição específica do corte TRIM ou monitoração da fonte live.
Validação integral final: 125 arquivos/961 testes, 12h19, 102,70s. Typecheck,
build servidor/web, cargo check, release do auxiliar, 13 testes Rust dele e
diff check passaram. Bundle index-D0VTIg0B.js / index-D9GOEo6B.css; aviso de
tamanho permanece. Scripts de pacote agora incluem/verificam o auxiliar, mas
nenhuma nova release portátil foi criada/verificada; r21 permanece imutável.
mXjYaZ: servidor compilado HTTP 53849, PIDs próprios 21380→15512 e engines
3576→6864. Medição 59430d0c-2064-4375-9170-709e62227d41 persistiu após reinício
parado; não alterou revisão editorial ou PGM durante análise. Mix 3-4 medido
-8,761 LUFS; AUTO chegou a -23,202 LUFS no medidor real do PGM. Recusa de par
inexistente preservou programa. Revisão AUTO publicada
ef98d045-3186-47b0-af5f-5bd4feb9c8c6. Saída null, sem PVW: não prova CUE físico,
emissão/recepção externa, DeckLink, SDI/NDI/OMT ou inspeção visual no navegador.
p839O4: auxiliar release decodificou PCM de duas trilhas reais em caminho
Unicode; -14,760/-34,760 LUFS, diferença 20,000 LU. Inversão manteve loudness;
cancelamento de canais idênticos mediu -70 LUFS/-90 dBTP. Trilha/par ausentes
foram recusados. Perda real do pipe abortou auxiliar. Processos dos ensaios
foram encerrados por seus verificadores.
QA anterior 23064 encerrada só após conferir PID/executável/comando/listener,
dois canais SIMULATED parados e CUE/PGM vazios. QA atual 5724/session 77357 em
127.0.0.1:4041 conserva banco/cofre, Canal 1 com 14 itens/revisão
25494162001883 e RW com 13/revisão 1744. HTTP 200 contém QC em qualidade e
botão de medição; não é inspeção visual ou confirmação de sinal nessa QA.
Permanecem pares de saída SDI/PGM multicanal, política de publicação recorrente,
guardas globais restantes, banco separado, HA/replicação/fencing, pacote final
e homologação física/visual. Auditar também proteção de SHA no TAKE de arquivos
legados sem cópia imutável, especialmente alteração no disco após a análise.
O objetivo inteiro continua ativo.

Continuação AUDIO-01 em 02/10 às 11h56: roteamento de canais de entrada para
o PGM estéreo implementado. Padrão legado preservado; escolha 1-2, 3-4, mono,
L/R, matriz 2×N com inversão e mix legado de pares passam antes do ganho,
medição e limiter. Não é seleção de pares de saída SDI ou PGM multicanal.
Arquivo/live enviam trilha e matriz no contrato nativo; alteração após CUE
exige novo CUE. Canais/trilha ausentes não autorizam substituir PGM. API e
escopo verificam metadados de áudio mesmo sem probe de vídeo completo, gravam
nível/trilha/matriz/revisão juntos e permitem undo sem trocar CUE/PGM. Mix novo
não herda medição do arquivo inteiro; AUTO é recusado enquanto não existir
medição específica do mix. MANUAL/OFF continuam disponíveis com medidor real.
Validação: 123 arquivos/950 testes em 96,85s, typecheck, build servidor/web,
cargo check, release engine e diff check passaram. Rust engine: 60 testes
passaram, 1 loopback OMT ignorado nesta rodada. Teste real audioconvert mediu
amostras de seis modos, incluindo inversão; teste Channel com arquivo PCM 4ch
mediu PGM 3-4 e preservou programa com arquivo sem áudio/trilha inexistente.
ebZ7AE: servidor compilado HTTP 53302/PID próprio 19076, engine release 21064,
revisões 9cdd1585-8903-46bc-9ff0-13414b7156bb e
c875acff-d6be-4d6a-af84-b72768b22fc1. PGM real 3-4: -10,458/-7,959 dBFS;
PGM 1-2 após ganho -6 dB: -26,000/-19,979. Arquivo real 2ch com metadados
legados desconhecidos recusou 3-4 sem substituir o programa. Processos próprios
encerrados. Esse ensaio não abriu PVW/publisher; não prova CUE físico, fonte
live externa, DeckLink, SDI/NDI/OMT ou inspeção visual no navegador. Primeira
tentativa de CUE sem barramento de preview foi recusada e o fixture corrigido
para ensaio somente de PGM, sem fabricar resultado de CUE.
Build web index-xJghS-5p.js / index-D9GOEo6B.css; aviso de tamanho permanece.
QA anterior 11088 foi encerrada somente após conferir processo/listener e os
dois canais SIMULATED parados, sem CUE/PGM; mesmo banco/cofre preservados.
QA atual PID 23064/session 49736 em 127.0.0.1:4041: Canal 1 mantém 14 itens e
revisão 25494162001883; RW mantém 13/revisão 1744. Ambos permanecem parados,
sem CUE. HTML/bundle HTTP 200 contêm QC em qualidade e matriz de entrada;
isso não equivale a inspeção visual ou sinal nativo nessa instância simulada.
Pacote r21 permanece anterior e imutável; nenhuma nova release portátil.
Permanecem pares de saída SDI/multicanal, loudness específico do mix, política
de montagem/publicação recorrente, guardas globais restantes, banco separado,
HA/replicação/fencing, pacote final e homologação física/visual. Objetivo ativo.

Continuação TIME-05 em 02/10: próxima revisão publicada pode ser conferida e
enfileirada para o fim natural da grade. Isso não monta/publica outras grades
nem conclui a continuidade autônoma 24/7 ou redundância entre máquinas.
Validação final: 121 arquivos/939 testes, 11h23, 90,30s; typecheck, build de
servidor/web, cargo check e diff check passaram. Bundle index-D3HMQNkT.js /
index-D9GOEo6B.css; aviso conhecido de tamanho permanece. Nenhuma nova release.
24 testes adicionados para revisão/ledger/EOS/preparação, reconhecimento,
permissão/escopo/STOP, ordenação durável e watchdog sem replay incerto; os dois
testes de markup SSR não equivalem a conferência visual no navegador.
zZT0x4: servidor compilado HTTP 52675, PIDs próprios 7112→296→22332, engines
11068→6992→12260, vídeos locais reais e saída null. Origem publicada
38575828-e055-4717-829a-f31ca26c18dd, destino 22574eda-7f2d-4625-a3c8-72bd90205898.
Fila duplicada não repetiu intenção; reinício parado conservou QUEUED sem TAKE;
preroll ocorreu antes do EOS; PGM, checkpoint e as-run confirmaram o destino
congelado apesar da edição posterior. Bloqueio QC após autorização manteve o
PGM anterior. Claim SWITCHING injetado antes de crash bloqueou recuperação do
checkpoint antigo; reconhecimento exigiu canal parado e ambos os PIDs locais
anteriores encerrados, sem repetir TAKE. A injeção não é prova de corte físico
incerto ou fencing remoto. Sem publisher PVW, teste de cold-start ou hardware.
23940 foi encerrado somente após verificar PID/executável/comando/listener,
dois canais SIMULATED parados e CUE limpo. QA atual 11088/session 46109 em
127.0.0.1:4041 mantém banco/cofre, 14 itens/revisão 25494162001883 no Canal 1 e
13/revisão 1744 no RW. HTML/bundle HTTP 200 incluem QC em qualidade e próximo
destino; consulta distingue SIMULATED sem passagem autorizada. Leitura HTTP
não é validação visual/browser. R21 continua snapshot portátil anterior.
Revalidação UI-03 nesta build: v5KSVP, servidor compilado HTTP 52817/PID próprio
16088 e sonda release real. JPEG de inspeção 3840×2160, preview 320×180, arquivo
original com SHA idêntico; ativo permaneceu PENDING e sem decisão de QC. Botão
Ver em qualidade disponível no bundle HTTP servido, sem elevar preview padrão.
Playback/inspeção visual no navegador permanecem não validados.
Permanecem política/proprietário de montagem/publicação recorrente, demais
guardas globais, áudio real/matriz, banco separado, HA/replicação/fencing,
pacote final e homologação física/visual. Objetivo inteiro continua ativo.

Continuação anterior TIME-04 às 10h36: relógio relativo à data da grade e horizonte da
execução congelada corrigidos; não é conclusão da continuidade autônoma 24/7.
Validação final: 118 arquivos/915 testes, 10h34, 88,14s; typecheck, build
servidor/web, cargo check e diff check passaram. Bundle web index-BGezuGVE.js /
index-D9GOEo6B.css; aviso conhecido de tamanho permanece. Sem nova release portátil.
23 testes adicionados: relógio/cadência/data inválida, prioridade >24h e ontem,
simulação através da meia-noite, horizonte finito/loop/live aberto/TAKE manual,
ledger durável/rollback e rotas congeladas/acesso/dia local.
Er43jR: servidor compilado HTTP 51844, PIDs próprios 9056→23136, publicação
35acb3fc-731f-4ec6-8e86-37cf35026363. Grade de ontem conserva data/cobertura ao
editar hoje; PGM/CUE simulados preservados; um aviso após reinício, sem autofill
ou publicação implícita. Meia-noite validada por relógio controlado e transporte
nativo em fixture de protocolo, não por transmissão física cruzando a noite.
QA 10732 foi encerrado somente após validar PID/executável/comando/listener e
confirmar os dois canais SIMULATED, parados e sem CUE. QA atual 23940/session
74070 em 127.0.0.1:4041 conserva SQLite/cofre: 14 itens/revisão 25494162001883 no
Canal 1 e 13/revisão 1744 no RW. API distingue OPEN_LIVE publicado de LOOP
legado, sem inventar cobertura de 48h; HTML/JS 200 servem o botão de qualidade.
Isso não prova inspeção visual/playback no navegador ou sinal físico. Próximas
etapas continuam sendo política/proprietário duráveis de montagem/publicação,
fila de próxima revisão e passagem entre grades no EOS, além das pendências
globais abaixo. O objetivo inteiro permanece ativo.

Continuação SEC-16/UI-03 às 10h: proposta de autofill congelada e botão de
qualidade do QC implementados; não é entrega final do objetivo inteiro.
Validação integral: 114 arquivos/892 testes, 10h03, 117,20s; typecheck, build
servidor/web, cargo check, diff check e 11 testes Rust da sonda passaram.
Build web: index-BGd1-M_A.js / index-D9GOEo6B.css; aviso conhecido de tamanho do
bundle permanece. Servidor foi recompilado após ajuste do limite par de pixels.
shIUKm: HTTP 51113/51114, PIDs próprios 8808 e 22476→23352→15256→16768→22484;
proposta após reinício/aplicação entre processos, um vencedor, plano diário exato,
QC/pauta/replay recusados, publicação/rollback e original verificado passaram.
XwpXiR: HTTP 51260/PID 9300, original 4K gerado localmente, sonda release real;
JPEG 3840×2160 versus preview 320×180 e SHA do original idêntico, sem decisão QC.
Essas são provas de HTTP/decodificação/extração, não inspeção visual ou playback
do navegador. CbIYyT: HTTP 54909/receptor local 54908, publicação
e43a47f8-dc87-4f9c-983a-d743216b0466; engine nativo confirmou PGM, proteção de
automação/incerteza e recuperação/reconfiguração/arquivamento sem replay;
saída null e publisher PVW desligado, não homologação física. Verificadores
encerraram seus próprios processos. QA anterior 12912 desapareceu durante a
sessão; listener foi conferido livre antes de iniciar 6388. Só 6388 foi depois
encerrado por nós, com PID/executável/comando/listener verificados, para atualizar
o backend final daquele ensaio. QA então PID 10732/session 87830 em 127.0.0.1:4041 preservava
SQLite/cofre e os dois canais cadastrados: 14 itens/revisão 25494162001883 no
Canal 1, 13/revisão 1744 no RW. HTML/bundle HTTP 200 referenciam a build nova e o
texto do botão; transporte configurado SIMULATED, MediaMTX desativado. Não se
declarou imagem ao vivo ou validação visual a partir disso. r21 continua snapshot
imutável anterior. Permanecem TIME-04 (horizonte/virada/política automática),
guardas equivalentes dos modelos/comandos restantes, importação e contexto,
matriz/pares reais de áudio no engine, banco separado, HA/replicação/fencing,
pacote final atualizado e homologação física/visual. Objetivo permanece ativo.

| ID | Requisito | Situação | Evidência / próxima verificação |
| --- | --- | --- | --- |
| SEC-20 | QC por canal, quarentena global e perfil técnico confirmam a conferência original | Implementado; software, duas instâncias compiladas e backup validados; interação visual pendente | Migração 23 cria revisão monotônica/tombstone por arquivo, atualizada por todos os escritores de mídia e decisões QC, com validação no startup/restauração. Conferência retorna hash, metadados, perfil, histórico aplicável e revisões de arquivo/configuração no mesmo snapshot; decisão exige If-Match específico ao arquivo/canal e perfil exige revisão de configuração. Recusa 428/400/409 sem escolher revisão atual para autorizar campos antigos; revalida sessão/papel/canal/estação no commit imediato. Decisão/quarentena/perfil e auditoria detalhada gravados juntos; falha reverte dados/contadores. Commit seguido de falha de refresh é informado como gravado com aviso. UI guarda revisão de abertura do perfil, exige conferência antes de aprovar/rejeitar, preserva ressalva/perfil em recusa, reabertura explícita com confirmação e não anuncia quarentena após erro. 41 novos testes; integral 166 arquivos/1373 testes PASS. hnJK7a comprovou um vencedor, ABA, histórico global, três rollbacks, restart e backup com dois servidores SIMULATED/SQLite compartilhado. Não é decodificação de mídia, HA, aprovação automática ou sinal físico. Guardas de projetos/acervo fora de QC e demais pendências amplas permanecem abertas |
| UI-04 | QC ao vivo: Ver em qualidade, raster da fonte e retorno ao preview leve | Implementado; vídeo/áudio reais locais e software validados; navegador, fontes físicas e 4K live pendentes | Ramo raw antes de crop/escala PVW, mesmo decoder; filas limitadas/leaky, gate fechado e encoder independente sob demanda. Perfil usa caps efetivas, não resolução do canal: até 3840×2160/60 fps, 6–50 Mbps, H.264/Opus progressivo; não é sinal original sem perdas. API vinculada a fonte vigente e sessão/viewer, revalida direitos na fila; último viewer/expiração fecha HQ, CUE novo cancela HQ e pedidos antigos não abrem outra fonte. Engine só inicia encoder após buffer real e possui deadline monotônico próprio de 15s. UI exige SOURCE+PVW_READY da seleção, limpa scopes na troca/erro e não substitui qualidade falha por imagem leve. YDoso1 comprovou entrada/inspeção 1280×720 com canal 640×360, preview 428×240, bordas reais e áudio Opus decodificado, PGM preservado, sem nova conexão de input, duas janelas e expiração. 72 testes Rust PASS/1 OMT ignorado; limites 4K testados por caps, não por emissor 4K. QA 4041 manteve backend anterior por bloqueio da atualização de processo; r23 não alterado; pacote final pendente |
| SEC-19 | Saídas usam versão original, fence durável, compensação de hot-change e reconciliação explícita | Implementado; testes de software e engine/servidor compilados locais validados; visual/físico pendentes | GET privado entrega perfis+revisão, cada ação leva If-Match original. Commit imediato revalida sessão/papel/canal/proprietário; auditoria atômica. Slot e journal cifrados no ledger existente, sem expiração/roubo por timeout. Tentativa nativa registrada antes do envio; ACK não é sinal físico. Falha de commit retorna ao perfil anterior somente se a revisão permanece intacta e registra seu ACK; retorno inconclusivo mantém UNCERTAIN e bloqueia mudanças/restart automático de publishers. Watchdog usa apenas perfil confirmado após commit. Reconciliação exige runId/prova/direitos atuais, PGM parado e CUE limpo; mesmo boot sem callback ativo ou todos os PIDs locais anteriores mortos, remoto/unknown bloqueado; reabre configuração gravada com STOP, nunca replay de TAKE. UI preserva baseline do rascunho, reabertura explícita, editor por canal e bloqueio visível; protocolos incompatíveis e preview full/herdado recusados antes do engine, removidos RTT/perda/AES fictícios. NE8vEu confirmou criação/disable/delete/rebuild e hot ACK mantendo engine/PGM, sem repetir automação; ZSfPyW confirmou dois servidores SIMULATED concorrentes com SQLite compartilhado e backup, não replicação/HA. Demais configurações globais/QC/projetos/comandos, banco separado, fencing entre hosts, pacote final e homologação física/visual/soak continuam abertos |
| SEC-18 | Presets SRT/RTMP usam snapshot conferido e auditoria atômica | Implementado; software e dois servidores compilados validados; visual pendente | Migração 22 cobre ABA/dono/remoção no counter do canal e valida triggers no startup/backup. GET lista+revisão privada; criar/aplicar/remover exigem If-Match original e direitos atuais dentro do commit imediato. Uma confirmação por revisão, rollback conjunto em falha de auditoria, aplicação incompatível recusada e remoção não afeta saída já criada. Resposta distingue commit de falha posterior do engine. Rascunho mantém baseline em refresh/recusa; reabertura explícita e editor por canal; falha de consulta não vira lista vazia, habilitada não significa no ar. Sync de monitor sem alteração não invalida revisão. r6LjSm comprovou concorrência/ABA/rollback/reinício/backup com dois servidores SIMULATED e SQLite compartilhado, não HA. 144 arquivos/1099 testes, tipos/build/cargo/diff aprovados. Guarda/reconciliação de saída complementada por SEC-19; demais controles, banco separado, HA, pacote final e físico/visual/soak continuam abertos |
| SEC-17 | Configuração de canal/FPS usa a revisão da abertura e auditoria atômica | Implementado; software e servidores compilados validados; visual e demais rotas pendentes | Migração 21, ETag namespaced, sessão/papel/dono no commit imediato, erro 428/400/409 sem gravação/rebuild. Baseline retido e patch mínimo; reabertura explícita descarta campos com confirmação. FPS sela formato/counters, incluindo ABA. Auditoria guarda antes/depois e versões; falha reverte dados/counters. Commit seguido de erro de rebuild/recovery é informado como aplicado com aviso, não falso rollback/sucesso físico. MEFrv4 conferiu dois escritores/reinício/rollback/backup, XUVzCf confirmou conversão nativa STOP/republicação/tempos históricos; 141 arquivos/1073 testes e tipos/build/cargo check/diff passaram. CRUD de saídas/presets/projetos/QC e outros controles, banco separado, HA, pacote final e homologação física/visual continuam pendentes |
| TIME-06 | Continuidade recorrente entre grades já publicadas, com autorização durável e STOP | Implementado; software e engine nativo em servidor compilado validados, UI visual/físico pendentes | Opt-in PUBLISHED_ONLY, conferência/versionamento e owner de conta/processo; seleção cronológica sem desempate ou salto, atraso revalidado no EOS. Ledger único por origem, SHA/QC/preroll/PGM existentes; STOP/cancelamento/arquivamento suspendem, falha não repete. Recovery local somente após ambos PIDs mortos, auditado; remoto/unknown bloqueado e status distinto, não fencing HA. 0wJtIA confirmou duas passagens entre três publicações, restart do primeiro VT, fila/as-run sem duplicação e STOP. 128 arquivos/983 testes passaram. Não monta/publica rascunhos, não garante 48h, não é sinal físico/visual; pacote final pendente |
| MEDIA-06 | Bytes publicados conferidos antes do CUE/preroll/TAKE, sem herdar aprovação ou mix de arquivo substituído | Implementado; software, servidor compilado e PGM nativo validados | SHA no contrato, hash real/handle/identidade nanosegundos e cache limitado. Recusa 409 com orientação, reabre decoder após mudança/restauração e exige novo CUE; próxima playlist/retomada/preroll também protegidos. Publicação obrigatória sem SHA bloqueada. Glkmv7 com original Unicode, cache indisponível e sem arquivo de versões comprovou PGM avançando, zero as-run de corte recusado e AUTO -23,224 LUFS após restaurar. 126 arquivos/970 testes finais. Não é lock/WORM contra alteração futura, aprovação de legado sem SHA, CUE físico ou validação browser; pacote final ainda não produzido |
| AUDIO-03 | Barramento PGM 8/16 e pares auxiliares explícitos | Engine, persistência/API, formulário e publicação integrados; software/nativo validados; SDI físico/visual pendentes | Ganhos independentes, pares não atribuídos silenciosos, limiter por par, medição/IP estéreo 1–2, captura SDI conforme entrada necessária. Migração 20/CHECK SQL/backup; alteração exige total anterior, PGM parado/CUE limpo, histórico preservado e republicação. Escopo amplo é atômico; total/pares congelados e incompatíveis recusados em execução/rollback/recovery. Declarações brutas preservam ausência versus desconhecido com probe parcial. 65 testes nativos anteriores + 138 arquivos/1036 testes e ensaios compilados 2/8/16 e metadados desconhecidos passaram. Formulário não presume SAP/clean nem sinal físico. Novo pacote final pendente |
| AUDIO-02 | Medir trilha/mix real para ganho AUTO, com resultado durável e vinculado à versão | Implementado e validado em software, auxiliar release e PGM nativo; visual/físico pendentes | Botão explícito no diálogo; FILE antes de ganho/limiter, não TRIM nem fonte live. SHA/trilha/matriz conferidos antes/depois e em todos os alvos na aplicação; números do servidor substituem os enviados pelo cliente. Jobs protegidos PENDING/RUNNING/READY/FAILED, claim atômico, dono local comprovado, sem roubar processo vivo/remoto; limites e baixo consumo em worker separado. Encerramento do servidor/pipe termina decoder e não presume resultado. mXjYaZ comprovou READY após reinício de servidor e AUTO no PGM -23,202 LUFS; p839O4 comprovou duas trilhas com diferença 20 LU, inversão, cancelamento, canais ausentes e EOF do dono. 125 arquivos/961 testes e 13 Rust passaram. Não aplica TAKE, não aprova QC, não homologa saída SDI ou controle visual. Auxiliar incluído nos scripts; pacote final não produzido |
| AUDIO-01 | Canais e matriz de entrada antes do ganho/limiter/medidor estéreo | Implementado e validado em software e engine nativo; hardware/PVW visual pendentes | Padrão legado mantido, pares 1-2/3-4, mono, L/R, matriz 2×N e mix de pares. Ausência não seleciona outro canal nem substitui PGM. Nível/trilha/matriz gravados juntos por revisão/escopo, CUE alterado exige nova preparação. ebZ7AE mediu PGM 3-4 e 1-2 com ganho -6, recusa 2ch; Rust mediu amostras reais dos seis modos. Esta linha é roteamento de entrada para master, não pares de saída; integração multicanal explícita em AUDIO-03, sem clean/SAP presumido |
| SEC-16 | Montagem aplica exatamente a proposta conferida, inclusive pauta diária e GAP de segundos | Implementado e validado em software e dois servidores compilados; visual pendente | Proposta imutável persiste no ledger protegido existente, com UUID, canal/grade/ator/revisão e expiração de 30 minutos; nenhuma migração nova. Guarda seleção/ordem/âncoras/cortes/áudio efetivos e explicação exibida. Confirmação não recalcula o seletor: exige If-Match capturado, proposta do mesmo destino/mode/sessão e dependências atuais de mídia/QC/canal/histórico/pauta; mudança recusa sem escolher outra mídia. Inserção, ordenação, consumo único e auditoria são um commit com undo/redo local após aceitação. Formulário mantém conferência/campos na recusa, invalida aplicação se critérios mudarem e exige conferência também do dia inteiro. GAP de segundos recebe a mesma proposta; folga antes fixa em 15s passa a no máximo 5% da janela curta. Leitura de preferências agora autentica/descriptografa via coluna protegida, sem json_extract no envelope. 20 novos testes de rotas; shIUKm comprovou aplicação em outro processo após reinício, um vencedor, plano exato, replay/QC/pauta recusados. SQLite compartilhado/SIMULATED, não replicação/HA; não publica ou envia TAKE. TIME-04 retirou o gatilho legado inválido; política automática durável continua pendente |
| UI-03 | QC tem botão Ver em qualidade, original verificado e inspeção até 4K | Implementado; software, HTTP e extração nativa de imagem validados; playback/visual no navegador pendentes | Preview leve permanece padrão. Botão explícito abre original para avaliação, permite voltar ao proxy e tela cheia; ativação vinculada a arquivo/hash/canal e apagada ao trocar seleção, nunca eleva live ou Master. SHA verificado prefere edição arquivada; original legado só é servido se bytes conferirem, substituição no mesmo caminho recusa 409. Range continua disponível, original usa cache privado/no-store. Codec não decodificado pelo browser usa quadros JPEG identificados como inspeção não contínua, sem prova de áudio; extrator agora aceita até 3840px e mantém 320px padrão. Cache de qualidade é separado; falha não anuncia miniatura como alta qualidade. Safe area continua desligada por padrão. XwpXiR: servidor compilado e sonda release geraram JPEG real 3840×2160, preview 320×180 e original SHA idêntico; QC permaneceu PENDING/sem decisão. 5 novos testes de API/cliente + 2 de markup SSR, 11 testes de sonda Rust aprovados. shIUKm validou range/hash e conteúdo original substituído. Não equivale a aferição de cor/scopes, reprodução browser validada, imagem live em alta qualidade ou hardware físico |
| TIME-05 | Próxima grade publicada conferida e passagem única no EOS | Implementado e validado em software e engine nativo com arquivos reais; visual/saída física pendentes | Master oferece seleção → conferência → enfileirar/cancelar/reconhecer, sem publicar, carregar grade, alterar CUE ou TAKE imediato. Revisões congeladas, primeiro vídeo exato, mesma cadência/canal, origem sem loop/hold, data/horário do destino, mídia/QC e autorização durável da conta vinculados à prova HMAC. Copy/SHA e permissão revalidados após preparação. Ledger protegido existente, uma pendência por canal, ID idempotente, claim e auditoria atômicos; nenhuma migração. Preroll no último trecho, reutilizado se o contrato persistir; somente identidade nativa no PGM instala snapshot/secondary events, checkpoint e as-run PLAYLIST_BOUNDARY. Falha preserva último PGM e não escolhe outro VT; ACK sem PGM torna incerto e não repete TAKE. STOP canônico/externo e arquivamento cancelam intenção não enviada. Cancelamento não altera SWITCHING; supervisor reconhece somente com canal parado/CUE limpo e dono atual serializado ou ambos PIDs locais antigos comprovadamente mortos; remoto/desconhecido bloqueia. Recuperação de servidor e watchdog recusam replay do checkpoint anterior sobre claim incerto. Pins de cache conservam destino pendente sem prender falhas históricas. Ordenação usa inserção durável, não UUID/relógio civil. 24 testes novos, 939 totais; zZT0x4 confirmou servidor compilado, vídeos nativos, preroll/EOS/PGM/as-run/checkpoint, fila após reinício, QC alterado e claim incerto injetado sem replay. Saída null/PVW desligado; não é fencing remoto, diária autônoma ou prova física |
| TIME-04 | Horizonte contínuo, virada de data e política de montagem/publicação automática | Relógio/horizonte/aviso e montagem/publicação editorial TIME-07 implementados; passagem TIME-05/06 implementada; visual/físico/soak/fencing pendentes | Relógio relativo à meia-noite local congelada não zera na virada; FIXED/HARD_TIME conservam timestamp absoluto. Cobertura usa execução publicada, não edição/cache; GAP/loop/live não garantem 48h. Aviso durável não duplica após reinício. TIME-05/06 fazem passagem única/recorrente entre publicadas com confirmação nativa, sem publicar rascunhos. TIME-07 monta/publica dias futuros vazios pela pauta com autorização durável, seleção exata em auxiliar separado, QC/SHA/repetição/conta e commit atômico; nunca sobrescreve grade manual nem aplica TAKE. W3rWGh confirmou dois dias, restart sem duplicação, STOP e disable; transporte SIMULATED neste ensaio, sem playback de 48h, sinal físico ou HA. Veja descrição atual acima; pacote final, integração visual/física e fencing entre hosts continuam pendentes |
| SEC-15 | Zonas protegidas, grafismos e eventos respeitam a revisão aberta | Implementado; software, dois servidores compilados e engine nativo validados; visual pendente | PUT de zonas e inclusão/remoção de deixas/eventos exigem If-Match e revalidam proprietário, sessão/permissões e cadência na transação imediata. 428/400/409 não grava nem registra undo; auditoria, dados e contadores são atômicos. Leituras readonly de grafismos/eventos entregam itens, templates, cadência e revisão num único snapshot, sem load de outra data. Formulário compartilha uma revisão entre grafismos/eventos, usa a resposta aceita como próxima base e não busca versão nova para forçar gravação; recusa mantém campos, atualização é explícita e seleção de origem é congelada. Zonas preservam também a cadência de abertura. Histórico local agora captura zonas e eventos/deixas de item, sela estado aplicado e permite undo/redo; restauração de automação exige permissão atual OUTPUT_CONTROL e não envia comando físico. 21 testes de API + 2 cliente adicionados: suíte 112 arquivos/863 passou antes de DB-02, 865 depois. BG85Qi comprovou zonas superadas, leitura coerente de GC/eventos e undo visível no outro processo; SQLite compartilhado/SIMULATED, não replicação. DcIBl9 confirmou programação/publicação, PGM nativo, recuperação/reconfiguração/arquivamento sem replay, com saída null e receptor local. QA 4041 atualizado, 3 escritas sem revisão recusadas com 428, 14 itens/revisão preservados. Modelos globais e demais comandos continuam em auditoria; pacote r21 anterior, sem inspeção visual nova |
| DB-02 | Reabertura do cofre não disputa upgrade de snapshot com escritor ativo | Corrigido e validado, sem equivalência a banco separado/HA | Ensaio de reinício revelou SQLITE_BUSY_SNAPSHOT na migração do cofre. Leitura/autenticação e proteção de valores legados agora acontecem sob uma transação IMMEDIATE, reservada antes da primeira leitura; evita upgrade de snapshot e sobrescrita de valor protegido mais recente. Reabrir banco já protegido autentica sem regravar metadados/contadores. Limpeza de legado ainda exige checkpoint/VACUUM e recusa outro processo ativo quando necessário, sem declarar limpeza fictícia. Dois testes adicionais verificam reserva de escrita antes das linhas e ausência de writes na reabertura; todos os 10 testes de migração/backup protegido passaram. BG85Qi e DcIBl9 passaram após a correção. Schema continua na migração 19; banco operacional separado e redundância entre hosts permanecem pendentes |
| SEC-14 | Publicação e rollback ativam somente o plano explicitamente conferido | Implementado; software e dois servidores compilados validados, visual pendente | Simulação lê grade/revisão, acervo/QC, fallback live, canal, grafismos/eventos, equipamentos e revisão ativa em um snapshot SQL; HMAC vincula operação, proprietário, versão e dependências. Confirmar exige If-Match capturado e prova válida, revalida sessão/permissões na transação imediata e não procura versão nova para forçar a gravação. Duas confirmações iguais têm um vencedor; versão atual não autoriza uma conferência antiga. Publicação/ativação/numeração/auditoria são um commit: falha de auditoria reverte tudo. Proteção de PGM também compara corte/áudio efetivos herdados; overrides explícitos preservados não são bloqueados por padrão novo. Rollback confere a revisão de origem e cria outra publicação, sem reescrever a edição; automação editorial inválida não impede restaurar uma publicação válida. Tela mostra alterações/conflitos antes do rollback e mantém recusa visível; atualização da conferência é explícita. Mudança de canal/data durante a confirmação não solicita carregar outra grade. 20 testes de API + 2 cliente adicionados; suíte 110 arquivos/840 passou. Ensaio VF1aAv, dois processos compilados, comprovou proof após reinício, concorrência e rollback em outro processo, preservação editorial e 4 auditorias atômicas. SQLite compartilhado/SIMULATED, não replicação ou HA. QA 4041 atualizado com banco/cofre/14 itens preservados; equipamento ausente na grade de teste impede publicação com 409 específico, não falso 404. Pacote r21 anterior, visual e demais mutações ainda em auditoria |
| MEDIA-05 | Todos os previews de vídeo usam proxy leve, sem fallback silencioso para original | Corte, consulta do Master e identidade de versão corrigidos; software/HTTP validados, visual pendente | TrimDialog e fallback do BroadcastMonitor antes serviam /media original; agora somente preview=1, hash capturado e preload metadata. MXF/ProRes não impede abrir o proxy H.264 por extensão original. Proxy ausente devolve 425; versão diferente 409, sem enviar original. QC consulta workflow da versão selecionada e recebe URL fixada no hash. Master identifica consulta como proxy, não confirmação PGM/PVW; falha WHEP abre consulta e permite reconectar. Régua continua disponível e corte permite tentar proxy novamente. 1 teste cliente + 5 de API (range, ausência, versão, workflow e acesso explícito separado). QA serviu proxy MP4 real com 206, 32 bytes/113221, e recusou hash antigo 409. Inspeção visual nova não realizada |
| TIME-03 | Corte compartilhado preserva tempo entre cadências de canal | Implementado com migração 19; software, backup e engine nativo validados | ALL_RUNDOWNS converte endpoints por razão exata, arredondando ao quadro mais próximo; trecho que ficaria vazio recusa 409 sem escrita parcial. ASSET_DEFAULT registra FPS da marcação e resolve por canal, mantendo overrides existentes. Inserção/importação/autofill usam resolvedor comum; undo/redo restaura também a unidade. Legado sem FPS permanece desconhecido, não inferido pela sonda; aviso pede revisão do padrão. Migração/backup recusam coluna/trigger ausente e par de taxa inválido. 25 testes adicionais e suíte 106 arquivos/812 antes dos previews. Engine DXkuO5 confirmou corte 25–250 a 25fps e 50–500 a 50fps, padrão 50fps byte-preservado, publicação/as-run históricos intactos e sem TAKE automático; saída null, sem PVW físico |
| SEC-13 | Confirmação revisada de todos os alvos de corte/áudio e undo de padrões | Implementado; software e dois servidores compilados validados | GET readonly mostra canal/dia/grade/quantidade; operador confirma os alvos amplos. Token HMAC sela linhas, padrões/hash, proprietários, configuração/cadência e versões de todas as grades no mesmo snapshot. Aplicar revalida sessão, permissões e revisão original dentro da transação imediata; ausência 428/superado 409 não grava nem cria undo. Edição exclusiva de outra grade invalida token mesmo sem alterar versão da origem. Conferência em outro processo com mesmo cofre é válida, mas não autorização adicional. Undo sela hash do estado dos usuários existentes do padrão, não só IDs, e recusa alteração posterior mantendo ação pendente. 31 testes sobre SEC-12: suíte 105 arquivos/787; ensaio eQQDv3 anterior e XBAfbI atual passaram. XBAfbI acrescentou padrão 25fps herdado em canal 50fps e corte amplo convertido/desfeito. SQLite compartilhado e transporte SIMULATED, não replicação/HA. Pendência ampla descrita em SEC-12 é superada por esta linha; publicação/rollback e demais comandos continuam em auditoria |
| SEC-12 | Corte/áudio conservam a revisão e os campos da edição | Revisão da grade fonte e confirmação conjunta implementadas; revisão de todos os alvos amplos pendente | If-Match obrigatório no corte e nível, conferido dentro da transação imediata após autorização de todos os proprietários. 428 ausente/400 inválido/409 superado não grava campos, trilha, contadores ou histórico. Dois pedidos com a mesma revisão têm um vencedor. Cliente conserva ItemView/revisão da abertura; áudio conserva também perfil do canal. Diálogos esperam resposta aceita antes de fechar; recusa conserva pontos, ganho e trilha com alerta explícito, sem busca automática de revisão nova. Escolha de trilha agora é local ao formulário e só grava junto com nível, no mesmo commit/desfazer; mesmo com nível amplo, trilha altera somente o item de origem. Falha no nível reverte trilha preparada. Controles de chaveamento/pares SDI que não eram conectados ao engine foram desativados e deixaram de anunciar multiplexação fictícia; integração multicanal permanece pendente. 47 testes canônicos, 13 de escopo, 8 da API cliente; rodada integral 103 arquivos/756 testes passou, tipos/build/diff check passaram. EiT2Ps validou dois servidores compilados, recusa cega e undo conjunto de trilha/nível. QA 4041 atualizado para PID 18932, JS index-C1qHs16-.js/CSS index-DsAAE4YL.css HTTP 200; POST sem revisão recusa corte/áudio com 428 e conserva 14 itens/revisão 25494162001859. Ainda não há fingerprint revisado pelo operador para mudanças exclusivamente em outras grades alcançadas por ALL_RUNDOWNS/ASSET_DEFAULT: revisão da grade fonte não substitui essa proteção. Publicação/rollback e demais mutações, inspeção visual e pacote final continuam pendentes |
| SEC-11 | Histórico selado, importação e montagem editorial atômicos | Implementado e validado; guardas restantes continuam pendentes | Captura antes/depois selada na transação original, registrada somente após commit. Desfazer/refazer compara o resultado exato da operação com linhas, padrões/hash do acervo, vínculos novos, cadência e eventos atuais; revisão nova não autoriza sobrescrever edição posterior. Falha SQL/409 conserva dados, contadores e ação pendente; dois pedidos com mesmo If-Match desfazem um só passo. Histórico permanece local ao processo, não durável/replicado. Undo estrutural não pode remover o item no ar. Undo/redo/importação/autofill/dia exigem revisão de abertura, autorização atual e transação imediata. Importação preserva PGM, revalida QC por canal, insere itens/ordem/histórico de importação juntos; evento EDITORIAL_PLAYLIST_IMPORTED/editorial-playlist.imported não anuncia publicação operacional. Assinaturas antigas playlist.published/playlist.inserted devem ser revisadas, não há equivalência fictícia. Montagem lê pauta, mídias/QC, cadência, preferências e as-run no mesmo snapshot de gravação; não reutiliza taxa antiga do runtime de outra data. Formulários de importação/montagem mantêm campos e exibem recusa. 40 testes canônicos, 18 de histórico e 7 da API cliente; rodada integral 103 arquivos/745 testes passou, tipos/build/cargo check/diff check passaram. Servidores compilados DvBjOJ confirmaram recusa de undo/redo superados mesmo com header atual e conservaram ação pendente. Engine VfuVoS confirmou PGM 25/50 FPS, bloqueio ativo e republicação; saída null, sem publicação física/PVW. QA 4041 atualizado para PID 24400, 14 itens/revisão 25494162001859 preservados, JS index-Cui802la.js/CSS index-DsAAE4YL.css HTTP 200. Não houve inspeção visual nova. Trim/áudio com revisão/escopo amplo, publicação/rollback e demais mutações ainda pendentes; autofill recalcula ao aplicar, não há identidade persistida de proposta aprovada. Posterior ao pacote r21 |
| SEC-10 | Revisão do que foi exibido aplicada às edições canônicas da grade | PATCH, inserir, mover, agrupar/desagrupar e remover implementados; demais comandos pendentes | Leituras de runtime, grade por ID, calendário e grade recém-criada associam linhas, mídias/QC, timing e revisão na mesma transação de leitura. If-Match obrigatório (428 ausente/400 inválido/409 superado), sessão e proprietário reconferidos na transação imediata, escrita estrutural e contadores atômicos. Formulário/arrasto conservam revisão de abertura; não buscam versão nova para forçar gravação. Inserção mantém campos e mostra erro; MAM só confirma sucesso após resposta aceita. Remoção só desaparece após aceitação e não limpa CUE em erro, nem ao apagar somente PRÓXIMO com outro CUE manual. Captura de undo só após commit; remoção/restauração inclui eventos secundários. Migração 18 corrige invalidação por QC global @all, valida proteção atual e invalida contadores antigos uma única vez. 21 testes de API canônica, 8 de header e 2 adicionais da API do navegador. Rodada integral: 103 arquivos/715 testes, tipos/build/cargo check/diff check passaram. Servidores compilados lGSQYq confirmaram conflito/reinício/rollback; engine nativo WarsRZ reconferiu carga e conversão de cadência. Recuperação nativa NlcQHr confirmou crash no frame 25, retomada no 25 e reinício pelo checkpoint 52 sem duplicar evento secundário; saída null, não prova publicação física. QA 4041 atualizado, 14 itens preservados, revisão 25494162001859, JS index-D6w8xTSf.js/CSS index-DsAAE4YL.css com HTTP 200. Não houve nova inspeção visual. Trim/áudio amplo, desfazer contra alteração superada, publicação/rollback, importação/autofill e demais mutações ainda precisam de guardas equivalentes |
| SEC-09 | Corte/áudio com escopo amplo e desfazer/refazer respeitam todos os proprietários | Implementado; domínio, API autenticada e dois servidores compilados validados | Alvos e sessão/permissão são conferidos dentro da transação imediata. Conta restrita pode aplicar escopo amplo somente se todos os usos forem autorizados; padrão de acervo considera todos os canais que o usam, inclusive arquivados. Padrão/override/revisões mudam juntos ou são revertidos juntos. Captura de desfazer lê o mesmo snapshot e só é registrada após commit. Desfazer/refazer revalida vínculos salvos, atuais e novos usos do asset; não altera canal estrangeiro/arquivado, conservando a ação pendente. Auditoria registra todos os canais afetados. 3 testes adicionais de atomicidade e 7 de rotas; ensaio compilado 1TBWcy passou com falha SQL deliberada, sem padrão/revisão/desfazer parcial, recusa de escopo e undo arquivado e restauração autorizada. Histórico continua em memória; proteção contra desfazer uma edição superada e guardas globais de edição permanecem complementares |
| SEC-08 | Revisão editorial durável e edição colaborativa atômica | Banco e API colaborativa implementados; aplicação em todas as edições da tela pendente | Migração 17 mantém contadores por grade/linha no mesmo commit dos escritores: item/ordem, mídia, QC por canal, grafismos, eventos e configuração. Tombstones impedem reutilizar ETag após excluir/restaurar item ou grade; upgrade legado ganha nova base, sem inventar contagem histórica. Snapshot /api/v1/rundowns/:id/revisions e timeline associam dados/revisão na mesma leitura. PUT/merge validam e escrevem na transação imediata, recusa cega 428/conflito 409; header antigo não é neutralizado por corpo atual e DISCARD_MINE não escreve. Backup/startup recusam tabela/trigger modificados, contador ausente ou inválido. 13 testes de banco e 4 de rotas adicionais; duas conexões e dois servidores compilados/reinício passaram. Locks de presença continuam locais ao processo; não é replicação/HA. PATCH/add/move/delete/trim/audio/publicação e demais edições canônicas da interface ainda precisam de precondição enviada pelo cliente e verificada atomicamente; não anunciar prevenção global de sobrescrita como concluída |
| REC-08 | Conversão explícita e revisada de FPS, preservando histórico | Implementada; software, backup e engine compilado validados | Migração 16 guarda snapshot protegido e exige publicação nova. Simulação identifica quantidades, cortes herdados e arredondamento; fingerprint impede aplicar plano superado. Transação converte horários, zonas, cortes, durações e eventos por taxa racional; acervo/outros canais e payloads históricos intactos. STOP/CUE limpo e retorno de VT resolvido são obrigatórios. Publicações incompatíveis ficam somente para consulta; rollback/runtime/cache/contingência recusam FPS errado ou legado desconhecido após conversão. Checkpoint fica parado; erro de rebuild é informado como conversão aplicada, não rollback fictício. Formato e Settings abrem revisão; Master mostra bloqueio; null de execução não vira editorial; histórico de desfazer e revisão colaborativa anterior invalidados. 28 testes novos/estendidos; ensaio nativo J2itvo confirmou PGM 25 FPS recusando conversão ativa, novo engine parado, republicação e PGM 50 FPS/as-run por cadência. Saída null, sem PVW ou emissão física. Posterior ao pacote r21; concorrência durável global e inspeção visual permanecem complementares |
| SEC-07 | Respostas e comandos assíncronos cercados por sessão/canal; propriedade nas rotas indiretas/legadas | Implementado nesta continuação; contratos, API e compilação validados | Requisições verificam contexto antes/depois do corpo; 401 antigo não revoga sessão nova. Fila descarta CUE/TAKE ainda não enviados após troca, sem repetir/alegar cancelamento dos já enviados. Snapshot precisa de proveniência atual; WebSocket verifica sessão. Autofill da timeline abre revisão sem mutação silenciosa; rota v1 só propõe materiais aprovados por canal, não insere item fictício nem declara gap resolvido. V1/alias mapeiam grade/item; PUT/merge validam pertencimento, limites, ETag e revisão; lock usa identidade real. Grafismos globais podem ser usados, não sequestrados por conta restrita; destinos/convidados/deixas/blocos mapeiam proprietário e barram arquivado. 18 testes novos de contexto/API + 20 rotas autenticadas. Não fecha auditoria global de segurança, versão durável multi-host nem validação visual. Posterior a r21 |
| LIVE-07 | Monitor reconhece NDI/OMT/SDI em CUE de item e PGM, sem inventar sinal por cadastro | Implementado; software validado; inspeção visual/física complementar | Engenharia antes só considerava sonda SRT e PVW de fonte direta. Agora correlaciona fonte canônica/identidade protegida, item ativo por barramento e medições nativas recentes; NDI/OMT/SDI mostram formato/FPS/áudio reportados. Cadastro não ganha CUE nem “sem sinal”; distingue não monitorada, simulado, aguardando quadro, medição indisponível e ausência recente. Mesma fonte no QC não apaga vínculo PGM; programa usa monitor baixo consumo e heartbeat mon, preview usa pvw, sem segundo decoder de entrada nem TAKE. 12 testes de monitor e contrato ampliado entre os 45 testes do transporte. Posterior a r21; WHEP/placa/emissor externo não homologados nesta continuação |
| SEC-06 | Troca/revogação de sessão não conserva operação da conta anterior | Inicialização protegida e testes de contrato passaram; auditoria global/visual complementar | Login/revogação limpam view/execução/Live/monitores/seleção/canais/alertas locais. Inicialização cancelada não reinstala sessão, canais nem snapshot atrasado; conta sem grade autorizada não herda Master anterior. WebSocket encerrado descarta novas mensagens. Isso limpa somente a tela, não manda STOP ao engine. 4 testes do inicializador; revisão de demais pedidos assíncronos e validação visual permanecem complementares. Implementação posterior à build r21, não incluída nela |
| REC-07 | Retirada de canal sem apagar histórico e reativação explícita sem TAKE | Implementado; software e engine compilado validados | DELETE passa a arquivar, não executar cascata. Migração 15 mantém canal/grade/publicação/as-run/auditoria; exige OUTPUT_CONTROL, STOP e CUE limpo na fila nativa, além de proteger o último canal ativo dentro da transação. Encerra runtime/sonda e remove distribuição/pins próprios. Checkpoint deixa de solicitar retomada ao reativar; reativação não instancia engine nem autoriza TAKE, mas reaplica distribuição configurada. APIs de histórico continuam consultáveis por permissão; Master/boot/cache usam somente ativos. Settings oferece Arquivar/Reativar parado; Aired e conta sem ativo autorizado podem consultar arquivos sem transformar a seleção em operação. 6 testes de domínio/rotas. Ensaio mTDhJR retirou PID real, preservou as-run/publicação e não iniciou engine/repetiu comando ao reativar. Interface nova não homologada visualmente por bloqueio da aba |
| SEC-05 | Auditoria limitada aos canais autorizados e exportação segura | Implementado; validação software e API compilada | Filtro de canal ocorre antes do limite; paginação por data/ID conserva eventos com mesmo timestamp. Eventos sem proprietário administrativo somente para ADMIN irrestrito; associação cruzada exige todos os canais. Canal arquivado conserva sua trilha. Registros HTTP carregam IDs mapeados sem copiar corpo/endereço/segredo; legado recebe máscara na resposta. UI informa erro/permite atualizar, não chama solicitação de execução física nem anuncia cadeia assinada. CSV compartilhado com as-run escapa separadores/aspas/quebras e neutraliza fórmulas, inclusive com prefixos. 4 testes auditoria, 2 CSV, permissões HTTP e ensaio mTDhJR. Mapeamento de outros endpoints e auditoria de segurança global permanecem complementares; UI sem inspeção visual nova |
| REC-06 | Restauração de projeto ordenada, configuração realmente reaplicada e histórico preservado | Implementada; software e ensaio compilado passaram | Exige OUTPUT_CONTROL (Supervisor/Administrador), PGM parado e CUE limpo; estado revalidado dentro da fila nativa. Banco restaurado seguido de checkpoint/retirada/rebuild, distribuição reaplicada antes do novo engine. STOP não vira retomada automática. Publicações de grades mantidas não são mais apagadas por DELETE/cascade: restaura editorial por upsert sem substituir a revisão congelada. Recusa remover grade com qualquer histórico publicado e recusa reinterpretação de cadência histórica. Auditoria registra identidade do projeto/canal sem segredos. UI explica interrupção, necessidade de republicar e permissão; novo texto/botão ainda não inspecionados visualmente por bloqueio da aba. 22 rotas operacionais e teste de domínio preservam publicações/outro canal/gráficos/eventos, barram OPERATOR e reinterpretação histórica. Temp/RPlayout-device-automation-VimDPt confirmou PGM ativo recusado, nova geometria/engine após STOP, publicação original intacta e ausência de replay. Exclusão de canal continua em auditoria separada |
| REC-05 | Reconfiguração segura de canal e topologia das saídas | Implementada nas rotas de configuração; validação de software e engine compilado | Formato, criação/remoção/desativação de saída e aplicação de preset compartilham a fila nativa com CUE/TAKE. Recuperação/contingência pendente bloqueia antes da escrita; runtime antigo é retirado somente após checkpoint, novo solicita retomada real. PATCH de slot RTMP/SRT/FILE já ativo aguarda ACK antes de gravar o banco, sem reentrar na fila; slot antes desativado ou SDI/NDI/OMT exige rebuild. Cadência diferente em canal com itens é recusada para não reinterpretar cortes/horários em quadros; conversão/republicação de grades permanece pendente. Novos checkpoints guardam cadência; legado sem esse campo não recebe cadência inventada. Auditoria central registra canal/IDs/campos/forma de aplicação, sem destino privado; ACK não comprova saída física. 45 testes transporte, 22 rotas operacionais, 4 rotas de credenciais, 4 checkpoints. Ensaio Temp/RPlayout-device-automation-A52RWh confirmou PGM após geometria/criação/desativação/remoção, troca FILE sem novo PID, crash e ausência de replay. Duas primeiras inicializações isoladas expiraram sem diagnóstico; repetição passou, estabilidade longa não homologada. Restore de projeto coberto por REC-06; exclusão de canal ainda em auditoria separada. Pacote r18 antecede REC-05 |
| LIVE-01 | Selecionar input antes do nome; nome padrão da fonte; edição consistente | Implementado; validação de software e página | 4 testes de nome/configuração; seleção NDI, troca SRT e apelido preservado no QA. Em 01/10, troca NDI→OMT indisponível limpa nome e bloqueia salvar; retornar NDI conserva apelido cadastrado. Screenshot artifacts/qa-20260930/input-selecao-nome-abaixo.png |
| LIVE-02 | Identificar DeckLink, separar entradas/saídas, diagnóstico real | Implementado; homologação física pendente | `device-number` é `G_TYPE_UINT`; portas de vídeo/direção em 5 testes Rust; processo de descoberta/UTF-8/timeout em 5 testes |
| LIVE-03 | Estados explícitos por fonte, sinal/áudio/formato/estabilidade | Implementado no transporte nativo; medição física complementar | Estados independentes PGM/PVW, largura/altura/FPS/interlace da entrada antes da escala, canais/taxa de áudio, idade de buffer e perda de sinal recente. Variação de chegada no decoder não é jitter de pacotes nem latência ponta a ponta. 35 testes de transporte e 2 de estatística nativa |
| LIVE-04 | CUE/PVW, TAKE seguro, Próximo, QC independente | Software e OMT loopback nativo validados; emissores externos pendentes | TAKE usa somente CUE confirmado, sem fallback silencioso para Próximo; 40 testes do transporte. Publicação/rollback/ajuste live compartilham fila nativa; revisão ou contrato do CUE alterados exigem novo CUE sem cortar PGM. Retomada pode refazer preroll uma única vez se somente o caminho mudar para cópia SHA verificada da mesma mídia/revisão. Arquivo exige quadro real no preroll e após seek; áudio sem vídeo e Mark In além do EOS preservam PGM. OMT percorreu CUE/PVW e TAKE/PGM com vídeo/áudio; remover PVW conservou PGM. QC abriu proxy real sem Master |
| LIVE-05 | Live prioritário, corte auditado, compensação rápida em segundos/minutos | Implementado base; validação física e timing complementar | FIXED/HARD_TIME disparam prioridade, preroll antes do prazo; falha conserva PGM; interrupção persiste somente após confirmação. ±5/30/60s gera revisão; conflito e ações existentes em auditoria complementar |
| LIVE-06 | Mesmo contrato TAKE no navegador e controle de transporte externo | Implementado e validado em software/engine nativo | Resolvedor comum: sem item explícito usa o CUE, nunca Próximo; MAM/QC não vira programa; fonte direta precisa de um único evento publicado. CUE antigo/item de outra revisão recusados. Integrações conservam suporte a ID explícito publicado. PARK sem item não anuncia sucesso. Serviço informa accepted/NATIVE/SIMULATED/nativeProgramConfirmed/awaitingSignal/physicalOutputValidated=false. 6 testes de domínio + rota autenticada; Temp/RPlayout-device-automation-BM9LwB passou nativo. r18 antecede esta correção |
| OMT-01 | Receptor nativo e descoberta oficiais | Implementado; loopback completo nativo passou | Descoberta SDK, appsrc e canal real: vídeo 320×180/25fps e áudio 2ch/48kHz; PVW e PGM usam buffers recebidos, não apenas ACK. Corrigida conexão de pads estáticos antes de caps negociados. Emissor externo e estabilidade longa pendentes |
| OMT-02 | Transmissor nativo no engine | Implementado; loopback nativo passou | libomt/libvmx oficiais; UYVY e FPA1; conta vídeo realmente entregue. Homologação externa e longa duração pendentes |
| PLAN-01 | Schedule editorial separado da playlist publicada | Implementado no runtime; software validado | Transporte/Master consomem execução publicada; mídia, SVG/campos, deixas e eventos secundários congelados; edição de outra data usa contexto editorial próprio. Eventos têm ledger durável por passagem/revisão; FIRING incerto não reenvia comando externo. Edição/manual no Master e registro consultável; migração 11 |
| PLAN-02 | Revisões, diferenças, rollback e ativação explícita | Implementado; software e página validados | 8 testes de domínio + 5 de rotas; simular, publicar, editar, inserir, remover, desfazer e consultar grafismos de outra data conservam PGM/CUE; comparação inclui grafismos. Publicação de revisão 1 e zero diferenças verificados na página QA |
| PLAN-03 | Publicação e comando nativo não disputam estado de execução | Publicar/rollback/ajustar live/ativar grade serializados; auditoria global complementar | 5 testes novos de transporte: TAKE retido precede publicação, CUE espera publicação, ACK live pendente bloqueia revisão ativa mas permite data futura, revisão/corte alterados recusam TAKE. Ativação explícita confere PGM/CUE dentro da fila e antes/depois de instalar; grade de outro canal e seleção superada não são anunciadas como sucesso. 2 testes de corrida + rota com STOP/limpeza de CUE; 14 testes publicação e 16 rotas. Novo botão LIMPAR CUE/PVW não muda PGM; visualização desse botão pendente porque a aba de teste foi bloqueada pelo navegador. Temp/RPlayout-device-automation-KiFRz1 conferiu bloqueio de ativação durante PGM nativo e troca após STOP sem replay. Fixture não tem publisher PVW; não usar esse ensaio para provar imagem preview. Reinício/topologia/restore globais ainda precisam de auditoria |
| TIME-01 | Timing determinístico persistido, simulação e ajustes auditados | Implementado no serviço de publicação; auditoria complementar de execução | Revisão congela plano resolvido, regras, proteções e compensações; simulação separada. Mesmo input produz mesmo resultado; mudança somente nas zonas aparece na comparação. A biblioteca continua no servidor, não é um processo de timing independente |
| TIME-02 | Zona protegida, prioridade e duração dinâmica de live | Zona formal implementada e validada em software/página; sinal físico pendente | Nome, intervalo local até 48h e prioridade 1–5; protege itens na posição nominal/atual. Prioridade igual/menor preserva; maior e FIXED/HARD_TIME podem compensar, registrando violação explícita. Edição com conferência de versão, auditoria atômica, migração 13, publicação separada de PGM/CUE. 7 testes de zonas, 12 de rotas operacionais e 2 de limites live. Página conferiu 28h–29h, revisão 1 preservada e diferença visível; screenshots zonas-protegidas-editorial.png e zonas-pendentes-publicacao.png |
| OPER-01 | Inserir próximo/agora, retorno ao VT | Implementado localmente; arquivo nativo validado; live físico e navegador pendentes | Inserção somente na edição congelada, nova revisão/timing/conflitos, sem publicar rascunhos nem copiar comandos externos. NEXT conserva PGM/CUE e política Auto Next/loop do atual; NOW aguarda identidade PGM nativa e registra cursor do VT interrompido. 17 testes HTTP + 3 novos de transporte. Temp/RPlayout-interrupted-return-m88EYU valida CUE manual conservado, mesmo PID, duplicatas, auditoria falhando após corte real e restart/reconciliação sem replay. OPER-02/SEC-20 cobrem retorno durável. Cursor é o último reportado, não precisão física. Live ACK/erro/quadro testados com protocolo controlado; não homologa NDI/SDI/OMT externos |
| MEDIA-01 | Fila durável de ingestão, estados e versões imutáveis | Implementado base; auditoria complementar | Migração 3, batches retomáveis, versões por SHA-256, cópia preservada, fila ARCHIVE/PROXY com falha explícita e reexecução; 3 testes. Arquivo Unicode real ingerido e proxy preparado no servidor QA |
| MEDIA-02 | Proxy/transcode e preview de baixo consumo | Implementado; validação complementar | Monitores 240p/15fps/450kbps; proxy nativo 426×240/10fps/220kbps + áudio 48kbps; QC não baixa original por padrão. Teste nativo decodifica vídeo/áudio e navegador reproduz proxy real |
| MEDIA-03 | QC por perfil, ressalva/reprovação e bloqueio de PGM | Implementado base; testes e interface validados | Perfil por canal: codec/FPS/interlace/áudio/duração/loudness. Decisão por canal/hash, ressalva, análise e bloqueio; versão nova não herda aprovação. Inserção/importação/autofill e engine respeitam decisão. 3 testes de contrato + 4 de workflow; codec H.264 sondado no arquivo Unicode real |
| MEDIA-04 | Pasta remota na página, caminhos Unicode, ignorados somente vídeo | Pasta/destino validados na página; filtro de vídeo validado em software | Pasta “Ação — Prévia” e destino .mkv usam navegador do servidor na página; WinForms retorna 410. Arquivo existente/traversal/nome reservado recusados, 32 testes. Ignorados segue busca e mostra apenas VIDEO: áudio/imagem/documento legado com probe falho não vira vídeo. Probe bem-sucedido não depende de lista de extensões; lista ampla serve apenas para vídeo avariado. Novos PDF/TXT/XLSX inválidos são pulados, MXF avariado é registrado; 2 testes de filtro + 10 ingestão. Screenshots pasta-remota-unicode-listada.png e gravacao-destino-remoto-unicode.png. Importação universal permanece v2.5 |
| UI-01 | QC com imagem maior e safe area no vídeo 16:9, desligado por padrão | Implementado; página validada | QC direto após recarga, vídeo 839,2×472,05 (16:9), safe 90/80% sobre a imagem; desligado por padrão e após o teste. Screenshot em artifacts/qa-20260930/qc-proxy-safe-off.png |
| UI-02 | Scopes e áudio responsivos, renderização econômica | Implementado base; calibração broadcast não alegada | Amostra 160×90, scopes até 10Hz/4Hz parado, áudio L/R/phase real no proxy; 2 testes de análise. Fonte sem arquivo/quadro não mede thumbnail de erro. Labels distinguem preview aproximado de loudness do original |
| REC-01 | Checkpoint durável e recuperação PGM após engine/servidor cair | Engine, runtime e crash completo do servidor compilado validados em fakesink | scripts/verify-engine-recovery.mts: watchdog/novo runtime conservam posição/revisão/identidade e apenas um evento. scripts/verify-server-recovery.mts: servidor próprio 1068 encerrado abruptamente; engine 19080 encerrou sem órfão; servidor 7284/engine 7340 retomaram quadro 51, revisão e passagem. Snapshot WebSocket, STOP persistido e duas linhas as-run RESTART/STOP conferidos. Evidência Temp/RPlayout-server-recovery-A8Lolx. Não homologa saída física |
| REC-02 | Contingência real acionada pela sonda, cache e mídia ausente | Slate e loop implementados; loop nativo e retorno/crash validados; host B pendente | Seleção explícita de revisão publicada, vídeos aprovados/cópia local verificada, loop contínuo sem live/âncora/hold/comando externo. Preparação não carrega a grade no runtime; commit após identidade PGM nativa, antes de checkpoint/as-run. QC/revisão alterados durante preroll impedem o corte. Origem/cursor preservados no checkpoint, retorno manual validado e quota protegida no reinício. Automático desligado por padrão; host B não é anunciado pronto. Ensaio compilado Temp/RPlayout-server-recovery-rxZkvC fez ciclo de dois arquivos, crash do loop e retorno ao VT no cursor 55. Interface recusou grade incompatível sem PGM/CUE; screenshots contingencia-configuracao-sem-corte.png e contingencia-reserva-incompativel-bloqueada.png. Homologação física/ensaio longo pendentes |
| REC-03 | Gravação não sobrescrita em início/reconfiguração/reinício | Implementado no engine; teste nativo passou | Reserva atômica create-new e filesink append; destino existente recusa somente a gravação, conserva bytes e mantém compositor. 8 concorrentes obtêm uma única reserva em teste Rust. Falha permanente de arquivo agora informa failed/ação necessária, sem promessa de reconexão automática; rede mantém retry. Ensaio nativo Temp/RPlayout-recording-safety-jg8itI sondou MKV real e conferiu SHA preservado na recusa e reinício. Operador escolhe novo nome |
| REC-04 | Reinício explícito ordenado e retomada do checkpoint real | Implementado; engine compilado e testes validados | /channels/:id/restart compartilha fila nativa, aguarda comandos e recusa live sem confirmação. Salva posição antes de retirar o runtime; comandos antigos após retirada são recusados. Runtime novo solicita recoverCheckpoint; simulação não se anuncia recuperada. Resposta declara interrupção controlada, pedido de recuperação e erro. Ensaio inicial comprovou que o fluxo anterior recriava canal sem retomar PGM; correção passou em Temp/RPlayout-device-automation-ICITxy, com novo engine/PGM e sem replay, seguido de crash completo. 1 teste transporte + rota; total 41 transporte/17 rotas operacionais. Ainda não cobre mudanças de formato/topologia/restore global; r18 antecede esta correção |
| AUTO-01 | Controle manual e programado de equipamento identificado e confirmação persistente | Videohub implementado; protocolo, eventos, engine e página validados com receptor local | PING não roteia; crosspoint exige equipamento/portas explícitos, ACK e consulta posterior. Publicação congela cadastro; somente PGM nativo da passagem autoriza evento. Cadastro/PGM alterados antes do envio bloqueiam comando. Ledger compartilhado por manual, evento e serviço legado: incerteza bloqueia novo roteamento e não reenvia no crash. Serviço exige deviceId e requestId UUID explícitos; consumidores antigos precisam adaptar, sem equipamento implícito. 15 testes driver/gateway, 8 ledger, 6 rotas manuais/serviço, 7 automação e 4 rotas programadas. Temp/RPlayout-device-automation-0HkDTK aprovou vídeo nativo, duração STOP, duplicata, serviço sem bypass e recuperação sem replay. Página evento-videohub-editorial-portas-explicitas.png. Não homologa hardware; ATEM/GPIO permanecem bloqueados |
| ASRUN-01 | Histórico e exportações com duração e proveniência verificáveis | Implementado; migração, testes, engine nativo, página e PDF validados | Migração 14 persiste cadência/ocorrência, transporte e evidência. Cursor final menos inicial mede duração nativa; preset atual não reinterpreta legado. Cadência ausente é nula; relógio fechado pode gerar estimativa explícita; aberto/invalidado não ganha duração. NEXT/TAKE/STOP/RESTART não viram PLAYED_FULL por atingir 95%; EOF/EOS são distintos. CSV servidor também neutraliza fórmulas; XML legado preserva contrato mas declara schemaValidated=false/rascunho, sem prometer SMPTE. Totais avisam durações ausentes. Removidos certificados/assinatura aleatória/aprovação fictícios. 4 testes evidência servidor, 5 cliente, 3 relatório; PDF de 60 registros/três páginas reinspecionado. Screenshot asrun-cortes-cadencia-historica.png. Não comprova saída física/NTP/apuração legal |
| CACHE-01 | Pré-cópia das revisões publicadas de 48h/7d, proteção por canal e atualização de caminhos | Implementado; testes e painel QA validados | Data/timing/hash congelados, QC por versão/canal, arquivo arquivado preferencial, deduplicação SHA, proteção por canal sem remover PGM/CUE de outro canal. Limpeza e contabilização limitadas aos arquivos gerenciados: não removem originais/documentos estrangeiros numa pasta compartilhada. Não troca data/revisão/transporte. 6 testes de planejamento + 2 de API + 8 de cache + 3 de sequência. Screenshot artifacts/qa-20260930/cache-futuro-48h-7d.png |
| HA-01 | Segundo host/standby, replicação, failover e as-run | Parcial: estado, mídia, concessão nativa e ensaio de restauração validados localmente; failover completo pendente | Dois servidores compilados com bancos/cofres distintos replicam publicação/checkpoint/as-run e continuam sequência após crash. Reserva não abre engine, mesmo com canal local e binário nativo configurado. HA-02 acrescenta mídia retomável por SHA; HA-03 acrescenta testemunha independente e expiração nativa; HA-04 restaura edições/cursor/QC em banco isolado. Promoção, fencing externo da saída, RPO/RTO e homologação entre máquinas permanecem pendentes. Não chamar espelho, ensaio, A/B preroll ou preferência de fonte SRT de redundância física |
| HA-02 | Replicação de mídia publicada para o reserva | Implementado; software e dois servidores compilados locais validados | Vídeo/áudio/imagem das edições ativas ou referenciadas pela execução/contingência, deduplicados por SHA. Blocos de 256 KiB criptografados/autenticados com finalidade MEDIA distinta de STATE, offsets SQLite FULL após fsync, quota incluindo parciais, limite de rede sobre bytes reais do envelope. Origem conferida por handle/hash, caminhos remotos nunca são usados para gravar; receptor único/pasta vinculada ao banco, sem sobrescrita. Publicação exclusiva por hardlink no mesmo volume; filesystem sem hardlink não confirma cópia. SHA errado/parcial não vira disponível nem autoriza PGM. 22 testes de domínio/HTTP e um de markup novos; suíte integral 157 arquivos/1229 passou. NczT7O confirmou interrupção do reserva aos 262144 bytes, restart/retomada/SHA, VT nativo no primário, bancos/cofres/seq distintos. Sem prova de host físico, takeover, fencing, codecs de áudio/imagem no reserva ou política automática de remoção de cópias antigas |
| HA-04 | Restaurar edição recebida antes de promover reserva | Ensaio isolado e reconciliação de crash implementados/validados; ativação/promoção pendentes | Pedido UUID sela canal/seq; ledger durável consulta duplicata sem repetir trabalho. Revalida mídia READY por SHA sem criar parciais; recusa seq superada/cursor inválido/revisão duplicada/mídia referenciada ausente/loop ausente/SHA inválido em edição exigida. Histórico legado não exigido permanece para consulta. Reconstrói publicações imutáveis, política QC, zonas, cursor parado e decisões QC em DB novo exclusivo com integrity/FK. Contexto/as-run/journals ficam cifrados como proveniência, não comandos executáveis. Canal arquivado, saídas/contas/inputs ausentes; marcador impede runtime mesmo após desarquivamento. APPROVED legado sem decisão por hash vira PENDING; sonda local necessária. 24 testes de domínio/4 checkpoints/10 fronteira HTTP e suíte 159 arquivos/1281 testes passaram. ilf9nA confirmou servidores compilados/testemunha/PGM nativo primário, mídia retomada/restauração, criador independente vivo recusado, crash/reconciliação/restart, workspace preservado e novo ensaio com novo UUID. CHECKING só é reconciliado com morte local comprovada; dono desconhecido/legado/vivo/host estrangeiro/EPERM não é liberado. Sem promoção/failback/host físico; API administrativa, sem botão de takeover ou ensaio na UI. Posterior ao r23 |
| HA-05 | Decodificação local e perfil técnico da mídia recebida no reserva | Implementado; H.264 progressivo/estéreo/R128 e recusa por áudio ausente validados com binários reais locais | Ensaio usa RPLAYOUT_PROBE, uma sonda por SHA, prioridade baixa, ambiente sem credenciais RPlayout, limite 15 minutos/1 MiB e cancelamento com fechamento do filho próprio. Contadores nativos de buffers diferenciam caps de decodificação real. Conferência SHA/identidade/tamanho/mtime/ctime antes/depois recusa alteração mesmo com bytes restaurados. Executável identificado por SHA e mudança recusada; isso não identifica cada plugin/DLL. Resultado cifrado por SHA em ha_recovery_media, sem alterar payload publicado ou aprovar mídia. localProbeRequired=false não equivale a perfil PASSED, QC aprovado ou promoção. Campos locais/duração/loudness são obtidos da sonda, não do primário. 160 arquivos/1303 testes, tipos, build servidor e 11 testes Rust da sonda PASS. llCguk comprovou 1800 buffers de vídeo/3376 de áudio e R128; oSRON4 comprovou decodificação do VT sem áudio e recusa pela política obrigatória. Sem tomada de PGM no reserva, trims/mixes alternativos, todos os codecs, áudio/imagem isolados ou homologação física. Posterior ao r23; pacote final pendente |
| OBS-01 | Saúde central por fonte/saída/engine/host e incidentes reconhecíveis | Persistência e correlação base implementadas; auditoria complementar | Mudanças de estado por fonte/bus geram histórico e eventos externos. Host/engine/saída têm incidentes e reconhecimento. Tally não fica verde por cadastro, simulação ou ausência de erro; execução do processo não comprova sinal físico |
| OBS-02 | Histórico CPU/GPU/RAM/disco/rede, recuperação e alertas externos | Histórico e fila externa implementados; destino real não configurado no QA | Coletor único 10s/14 dias; dados ausentes N/D. Outbox criptografada, reenvio progressivo até 8 tentativas, timeout 5s, ID estável e confirmação HTTP; sem promessa exactly-once. 5 testes de fila + 3 de API; UI das últimas 100 entregas e reenvio manual. Falha de retenção gera incidente local; histórico resolvido retido 30 dias |
| SEC-01 | Expiração/revogação, CORS, permissões por canal/estação e auditoria | Implementado base; auditoria complementar | Sessões hasheadas/expiração/revogação, restrição canal/IP, origem, proteção de primeiro/último administrador, limitação de tentativas; 8 testes. Controle externo exige comparação constante do token |
| SEC-02 | Proteção de segredos em repouso e respostas redigidas | Cofre, diagnóstico e referências de entrada implementados; auditoria complementar | AES-256-GCM por coluna, DPAPI CurrentUser fora do SQLite. Entrada com credencial usa referência autenticada no HTTP/WebSocket; endereço de exibição mascarado não vai ao decoder. Cadastro, CUE, TAKE, grade e edição resolvem URI original no servidor; referência anterior continua válida após reinício com o mesmo cofre. Identidade HMAC estável conserva a correlação QC/PVW mesmo com novo envelope aleatório. Nome NDI/OMT Unicode e URI sem segredo são preservados literalmente. 5 testes de fronteira + 4 de rotas + 3 de cliente; servidor compilado Temp/RPlayout-source-wire-AzXsr2 conferiu snapshot/tick WebSocket, HTTP, apelido, reinício e identidade estável. Teste usa transporte simulado, não comprova quadro físico. UI conferiu apelido e URI privada inalterada: artifacts/qa-20260930/input-conexao-protegida-apelido.png. 3 testes adicionais de saídas/destinos e 1 de presets impedem substituir segredo por máscara ou reaproveitar máscara em outro protocolo. Proteções de processos/configuração em SEC-03/04; auditoria dos demais endpoints ainda pendente |
| SEC-03 | Endereço privado entre servidor, engine e relays; ambiente sem segredo administrativo | Implementado; testes e processo nativo validados | Bootstrap por stdin, não argv/variável de ambiente; mesmo leitor bufferizado mantém comandos seguintes. Watchdog/reconexão reenviam a configuração privada. Helpers nativos só herdam as opções RPLAYOUT de runtime OMT/encoder, não cofre/admin/token/destino. Legacy CLI explícita permanece disponível para testes manuais. 5 testes do servidor e 6 execuções dos 3 casos Rust compartilhados; Temp/RPlayout-private-startup-hGQbZm conferiu linha de comando real de dois PIDs próprios no Windows, destino SRT literal nos dois processos e ACK após bootstrap. Registry novo é previamente sondado uma vez; isso não testa recepção física |
| SEC-04 | Configuração gerada do MediaMTX restrita e revogação consistente | Implementado; ACL Windows e recarga nativa isolada validadas | Arquivo temporário vazio é restrito ao usuário do servidor/SYSTEM antes de receber chaves, Unix 0600; substituição atômica preserva original/hardlink em erro. Configurações são serializadas e respeitam janela de 1s do watcher nativo quando em execução. 5 testes conferem ACL real, Unicode, preservação de hardlink, recusa de diretório, ordem de revogação e espera do watcher. Temp/RPlayout-private-mediamtx-BfH3Tt adicionou/removeu chave na configuração nativa sem reiniciar PID; todos os listeners de sinal ficaram desativados. Não é prova de continuidade física PGM |
| DB-01 | Migrações formais e backup validado por restauração | Implementado; legado protegido testado | Migrações 1–18, WAL FULL; restauração isolada com integrity/FK/contagens e autenticação. Backup protegido anterior às tabelas 10/11 e diagnóstico 12 é reconhecido antes do upgrade; tabela faltando com migração registrada e campo atual desprotegido são rejeitados. Histórico pré-14 conserva duração/cadência ausentes e proveniência UNKNOWN em teste de arquivo SQLite reaberto. Migração 15 adiciona archived_at sem apagar histórico; 16 conserva conversões e 17 valida estrutura/proteções/contadores editoriais, sem recriar revisão fictícia em banco atual incompleto. 18 atualiza triggers de QC global e invalida revisões anteriores uma vez, com teste de upgrade de arquivo 17 para 18 e backup antes/depois. Projetos restauram deixas/eventos editoriais e são recusados durante PGM/comandos pendentes |
| PKG-01 | Pacote autossuficiente Node/módulos nativos e engine atual | Pacote r23 validado localmente; final do escopo pendente | release/RPlayout-1.1-broadcast-20261004-r23 inclui estado/mídia HA, testemunha/concessão nativa e correção de partida fria. Não exige tsx/tsc/pnpm operacional. Integridade/Node/SQLite/plugins/scanner/engine/PATH portátil/MSVC app-local passaram; manifesto EAFD52DCBC09141563B12C830B0F753FD72F0168A295A68707D68710F3BE6304. W14tJI validou testemunha empacotada/termos/expiração; R4pWad validou Node/engine/plugins do pacote, partida 13,9s sem stalls/restarts, crash/VT/as-run/STOP/WebSocket e ciclo/crash/retorno da contingência de dois arquivos. Saída null, sem homologação física ou failover de host. r22 preservado com defeito de prazo de startup observado; não usar como candidato final. r21 preservado com provas aC4j6J/2QmyHz, não reatribuir seus ensaios ao r23. Documentos embalados refletem o instante da build, não validações posteriores; pacote manifestado não foi alterado. Objetivo geral e pacote final após demais implementações continuam pendentes |
| TEST-01 | Matriz homologada de sinal físico NDI/SDI/OMT | Pendente externo | Necessita hardware/emissor; separar de testes automatizados |

## Critério de encerramento

Leitura da matriz: REC-07 substitui a pendência de exclusão mencionada nas
notas históricas de REC-05/06. SEC-05 cobre a consulta da auditoria, não fecha
a revisão global de todos os endpoints. Pacotes são snapshots imutáveis;
implementações posteriores não entram numa revisão já manifestada.

Cada requisito deve apontar testes, artefato ou limitação comprovada. Nenhum
requisito pendente será ocultado sob “build validada”. Mudanças que interrompem
PGM devem ser explicitamente indicadas como interrupção controlada. O pacote
final só deve ser gerado após recompilar o engine e testar seus fluxos reais.

## Validações adicionais desta continuação

- Continuação SEC-15/DB-02 em 02/10 às 08h: zonas/deixas/eventos e seus formulários corrigidos, sem concluir o escopo inteiro. Rodada final passou em 112 arquivos/865 testes, iniciada 08h34, 86,76s; typecheck/build servidor/web/cargo check/diff check passaram. O ensaio compilado inicialmente encontrou um header JSON vazio incorreto no DELETE do verificador, corrigido; a repetição encontrou uma falha real de startup SQLITE_BUSY_SNAPSHOT no cofre, corrigida no produto sem apenas reiniciar ou aquecer o fixture. BG85Qi passou com HTTP 53869/53870, processos próprios 18028 e 11696→9432→22728, cobrindo revisão/scope/publicação/rollback, zonas, GC/eventos e undo entre dois processos. DcIBl9 passou com HTTP 53978/receptor 53977, publicação 3c043ad5-ae31-4e8a-af69-27a07656e7ad: engine nativo, comandos sem replay, reconfiguração/restore/arquivamento e histórico conservados; saída null/publisher PVW desligado, não hardware físico. Instância QA antiga 24272 foi encerrada somente após conferir PID/executável/comando/listener. Novo PID 12912, session 90207, em 127.0.0.1:4041, conserva banco/cofre, 14 itens/revisão 25494162001859. GET de automação entrega revisão/owner correspondentes; zonas, deixas e eventos sem If-Match devolvem 428 sem alterar ItemViews/revisão. Build index-dyAs7YqB.js/index-D9GOEo6B.css respondeu HTTP 200 e está no HTML; isso não é inspeção visual. Processos dos verificadores foram encerrados por eles, QA permanece disponível. r21 continua imutável e anterior às mudanças. Permanecem proposta congelada de autofill, revisão de modelos/comandos restantes, matriz/pares reais de áudio no engine, virada operacional, banco separado, HA entre hosts/replicação/fencing, pacote final e homologação física/visual.

- Revalidação final do engine/automação após SEC-14: wfSyqh passou com HTTP 53020/receptor local 53019, publicação ea1f8215-718f-45d0-b8c7-4e206c1cbebe. Confirmou PGM nativo, ativação sem troca implícita de PGM, comando manual não repetido, bloqueio por crosspoint incerto, restart/recuperação sem replay, reconfiguração/restore e arquivamento preservando publicação/as-run. Saída null, publisher PVW desativado e receptor de protocolo local: não é homologação de hardware nem redundância entre hosts. Os processos temporários deste ensaio e de VF1aAv/Np9GU4 foram encerrados por seus próprios verificadores; somente o QA 4041 permanece disponível.

- Continuação SEC-14 em 02/10 às 08h: publicação/rollback revisados e implementados, sem declarar concluído o relatório inteiro. Rodada integral final: 110 arquivos/840 testes, 08h05, 88,82s; typecheck/build servidor/web/cargo check/diff check aprovados. Servidores compilados VF1aAv, portas 52868/52869, processos próprios 13620 e 19644→17208→23104, passaram os contratos de edição e publicação entre processos/reinício; nenhuma saída física ou replicação foi validada. Engine nativo Np9GU4, HTTP 52999, PIDs próprios 23140→21532, passou corte/cadência 25→50fps, proteção do PGM, histórico preservado e exigência de republicação, com saída null e sem publisher PVW. Ensaio anterior sMm5jA passou automação/PGM/reconfiguração/restore/arquivamento com receptor Videohub local, não placa real. QA 4041 substituiu apenas seus próprios processos 12856→6372→32, session atual 31723, preservando migração 19, banco/cofre, 14 itens e revisão 25494162001859. Build atual index-DXNHH8Mq.js/index-D9GOEo6B.css respondeu HTTP 200 e está referenciada pelo HTML. A grade QA contém automação de equipamento ausente/desativado: simulação/publicação recusam com 409 e preservam ItemViews/revisão; não se removeu o evento para fabricar sucesso. Fixtures isolados válidos provaram 428 para ausência de revisão/prova e 409 para superação. Consulta HTTP não foi confundida com inspeção visual. Pacote r21 não foi alterado. Permanecem guardas equivalentes de zonas/grafismos/eventos e demais comandos, proposta congelada de autofill, matriz/pares reais de áudio no engine, virada operacional, banco separado, HA entre hosts/replicação/fencing, pacote final e homologação física/visual.

- Continuação SEC-13/TIME-03/MEDIA-05 em 02/10 às 07h: a retomada encontrou cópia de quadros sem conversão entre canais e dois consumidores que ainda carregavam vídeo original. Corrigidos e registrados acima, sem reinterpretar padrões legados de FPS desconhecido. Rodada integral final passou em 108 arquivos/818 testes; typecheck, build servidor/web, cargo check e diff check passaram. Ensaio compilado XBAfbI usou portas 51664/51665, PIDs próprios 21256 e 17180→1480, revisão 2→19: revisão ampla superada, rollback SQL, undo de usuário existente alterado, taxa do padrão/undo e corte 25→50 por outro processo conferidos. Ensaio nativo DXkuO5, HTTP 51405, engines próprios 16084→3804, confirmou publicação/PGM 25fps, bloqueio de conversão ativa, engine convertido parado, republicação/PGM 50fps e cortes com mesmo tempo; saída null/sem PVW, não homologação física. Instância QA 4041 conferida por PID/executável/comando/listener antes de atualizar; agora PID 12856, session 97886, migração 19, mesmo banco/cofre e 14 itens/revisão 25494162001859. HTTP readonly de revisão 200 e recusa sem token 428 preservaram ItemViews/revisão; o schedule é recalculado pelo relógio e não foi confundido com alteração editorial. Assets index-BV02PZ0E.js/index-D9GOEo6B.css HTTP 200. Proxy MP4 real de 113221 bytes respondeu range 206; identidade antiga 409, sem original. Transporte QA simulado/MediaMTX desativado, sem nova inspeção visual. Pacote r21 permanece imutável e anterior a estas mudanças. Permanecem publicação/rollback/proteções/eventos e demais mutações equivalentes, proposta persistida de autofill, matriz/pares reais de áudio no engine, virada operacional de data, banco separado, redundância entre hosts/replicação/fencing, pacote final e homologação física/visual. Fonte e build avançaram; nenhuma dessas pendências foi chamada de pronta pela suíte verde.

- Continuação SEC-12 em 02/10 às 06h09: 103 arquivos/756 testes passaram (11 adicionais sobre SEC-11), tipos e build servidor/web passaram. Os três testes novos de preservação de trilha tinham assumido zero em vínculos cujo legado era null; passaram a comparar antes/depois, sem converter o dado original. Última build inclui alertas de formulário e desativação explícita de seletores SDI que não enviavam configuração alguma ao engine; inspeção visual segue pendente. Ensaio EiT2Ps, HTTP 50118/50119 e PIDs próprios 24428/9608→13460, confirmou revisão durável 2→17, recusa de trim/audio sem header, rollback de padrão/contadores e undo conjunto do nível/trilha, além dos casos SEC-11. Transporte SIMULATED, não áudio físico, replicação ou HA. QA próprio 24400 foi conferido por executável/comando/listener e substituído por 18932, session 47604, banco/cofre e 14 itens/revisão inalterados; assets index-C1qHs16-.js/index-DsAAE4YL.css HTTP 200, MediaMTX desativado. Recusas reais HTTP 428 de corte e áudio no QA não alteraram ItemViews ou revisão. Próxima proteção necessária é revisão/fingerprint da lista de todos os alvos amplos, apresentada antes da confirmação: o If-Match da origem não detecta edição exclusiva de outra grade. Também permanecem publicação/rollback e demais mutações, proposta persistida de autofill, vínculo real de canais/pares de áudio no engine, virada operacional de data, banco separado, HA/replicação/fencing, pacote final e homologação física/visual. r21 preservado, não contém SEC-12.

- Continuação SEC-11 em 02/10 às 05h: suíte integral passou em 103 arquivos/745 testes (30 adicionais sobre SEC-10); typecheck, build e cargo check passaram. Erro de retorno da montagem foi corrigido; um teste novo lia payload criptografado como JSON e foi ajustado para a leitura protegida do domínio. Outra rodada apresentou salto de cerca de 3h no relógio de execução e timeout de TAKE; o teste passou em repetição direcionada (65 testes), sem ampliar limites, e a repetição integral passou em 71s. Ensaio DvBjOJ usou dois servidores compilados no mesmo SQLite isolado, portas 62882/62883, PIDs próprios 1692 e 16500→12640, revisão 2→14: edição posterior impede undo com revisão atual, mantém a ação, desfazer do escritor posterior libera o passo anterior e redo antigo é recusado. Ensaio nativo VfuVoS, porta 49763, engines próprios 21032→7948, preservou revisão histórica/as-run 25 e 50 FPS e exigiu republicação, sem TAKE automático; null e sem PVW não homologam saída física. QA próprio 19232 foi conferido por executável/comando/listener antes de parar e substituído por 24400; mesma pasta, banco/cofre e 14 itens, revisão 25494162001859. HTTP confirma health/JS index-Cui802la.js/CSS index-DsAAE4YL.css, transporte SIMULATED/MediaMTX desativado, não inspeção visual. Nome abaixo da seleção NDI/OMT e alias continuam cobertos por LIVE-01 e pelos 4 testes de protocolo; não houve alteração ou homologação física dessas fontes nesta etapa. r21 não foi sobrescrito. Além de trim/áudio/publicação/rollback e outras mutações, permanecem proposta aprovada de autofill, virada de dia, banco separado, HA/fencing/replicação, pacote final e homologação física/visual.

- QA 4041 atualizado em 01/10 às 23h20 para PID próprio 17548, backend compilado atual, assets index-BF0aCPje.js/index-D1cmGRrr.css. Banco/cofre anteriores preservados; health ok e MediaMTX desativado. API nova de revisão responde no QA sem editar a grade. Transporte simulado e leitura HTTP de assets não são inspeção visual nem sinal físico. O processo usa a pasta isolada de QA; scripts de dois servidores usam suas pastas temporárias, não a instalação operacional. Revisão r21 imutável mantida.

- Continuação SEC-08/09 em 01/10 às 23h20: 101 arquivos/682 testes passaram; typecheck, build servidor/web, cargo check e diff check passaram. Teste de alteração da tabela apontou apenas uma expectativa textual incorreta, ajustada para aceitar a mensagem específica; o gate continuou recusando o backup. Ensaio compilado repetido em 1TBWcy, HTTP 60586/60587, PIDs próprios 4792 e 21456→23340: mesma revisão aceita uma escrita, rejeita a outra, conserva versão após restart, PATCH invalida editor colaborativo e descarte não grava. Falha após mudar padrão de corte reverte padrão/item/contadores e não registra desfazer; grade compartilhada arquivada recusa corte/undo indiretos, reativação permite restauração autorizada. Servidores operaram no mesmo SQLite isolado, transporte SIMULATED, sem engine/MediaMTX/rede física. Isso não prova replicação ou standby. Pacote r21 não foi sobrescrito e não inclui SEC-06/07/08/09/LIVE-07/REC-08; pacote final, revisão de todas as mutações da UI, proteção de desfazer contra alteração posterior, virada de dia, banco separado, HA/fencing/replicação e homologação física/visual continuam pendentes. Ruflo não disponível entre as ferramentas expostas; nenhum swarm foi inventado. Nome da input continua coberto por LIVE-01, sem recadastro/reinterpretação de aliases nesta etapa.

- Fechamento REC-08 em 01/10 às 22h31: repetição integral passou novamente em 100 arquivos/655 testes após invalidar a revisão colaborativa anterior na conversão. Typecheck e rebuild finais passaram; engine compilado repetiu o fluxo com mídia SHA real em KPnX8S, HTTP 59613, PIDs próprios 10968→14076, preservando publicação antiga e as-run 25/50 FPS, sem TAKE automático. QA 4041 agora PID 18620, assets index-Ch9sthui.js/index-D1cmGRrr.css; banco/cofre originais de QA preservados, engine físico/MediaMTX desativados. Não houve modificação da estação do operador ou do pacote r21. Diff check padrão passou; uma checagem experimental com autocrlf desativado marcou CRLF Windows como espaços finais, não foi usada para reformatar arquivos nem ocultar erros.

- Continuação de 01/10 às 22h23: 100 arquivos/655 testes passaram, typecheck, build servidor/web, cargo check e diff check passaram. A primeira rodada encontrou um teste esperando apenas 15 migrações; atualizado para 16 e incluídos backup protegido pré-16 e corrupção da tabela nova. REC-08 converte FPS somente com revisão/STOP/CUE limpo e exige republicação; as revisões históricas e as-run não são reinterpretados. Ensaio compilado J2itvo, HTTP 59498, trocou o engine próprio 22520 por 1724: PGM ativo recusado; publicação byte-preservada; novo canal parado e TAKE bloqueado; após publicação, VT confirmado a 50 FPS. As-run nativo conserva 25 e 50 FPS respectivamente. Saída null e sem preview publisher: não homologa hardware/PVW. QA 4041 atualizado de PID 22548 para 9176 com banco/cofre preservados; serve index-Cbhq3zK3.js e index-D1cmGRrr.css, transporte simulado. HTTP de assets não é inspeção visual. Pacote r21 continua imutável e não inclui REC-08/SEC-07/LIVE-07. Permanecem banco separado, HA entre hosts/replicação/fencing, concorrência durável e revisão global restante, virada operacional de data e homologação física/visual. Notas anteriores de conversão pendente são históricas, superadas por REC-08.

- Continuação de 01/10 às 21h52: 97 arquivos/627 testes passaram; typecheck, build servidor/web e cargo check passaram. Bundle atual index-MsMdIFmt.js, QA 4041 atualizado para PID 22548 após validar PID/comando/porta do anterior e preservar banco/cofre. API responde saudável, MediaMTX desativado e transporte simulado; leitura HTTP de assets não é validação visual. Ensaio compilado HTTP/WebSocket/cofre NWWy6X passou com alias e identidade estáveis após reinício, sem vazamento; transporte SIMULATED, não sinal físico. SEC-07/LIVE-07 são posteriores ao pacote r21, que não foi alterado. A rodada de 19h50 anterior ao monitor passou 96 arquivos/615 testes. Permanecem pendentes conversão explícita de cadência, banco separado, redundância entre hosts/replicação/fencing, revisão global restante e homologação física/visual. Nenhuma dessas pendências foi reclassificada como concluída pela suíte verde.

- Fonte atual após SEC-06, 01/10 às 19h21: rodada integral passou em 92 arquivos/577 testes, typecheck/build servidor/web e diff check passaram. Quatro testes do inicializador cobrem conta sem canal autorizado, sessão não autenticada, sessão atrasada e snapshot atrasado após substituição. QA 4041 serve a build web atual com backend 17464; este teste é de contrato/compilação, não inspeção visual. r21 permanece válido para REC-07/SEC-05 e ensaios nativos registrados, mas não contém SEC-06; não foi sobrescrito. Escopo completo continua ativo: redundância entre hosts/fencing/replicação, separação do banco, conversão explícita de cadência, auditoria assíncrona/global e homologação física/visual ainda não encerrados.

- Encerramento da rodada de 19h14: 91 arquivos/573 testes passaram; typecheck, build servidor/web, cargo check e diff check passaram. Restauração com arquivamento passou sem alterar backups operacionais. Em revisão posterior apareceu um estado antigo no login de conta sem canal: SEC-06 agora limpa a sessão local e cancela respostas atrasadas do bootstrap, com 4 testes adicionais aprovados. A build r21 permanece imutável e antecede essa correção da tela; build/suíte atuais serão registradas separadamente. Não declarar segurança assíncrona global encerrada apenas por esses quatro testes.

- Pacote r21 concluído e verificado em 01/10 às 19h13: manifesto 367CD7FF131F4251CE3990F8D91D0E7A0BA5BD9B4738380E4B8006732ED64A52. Ensaio aC4j6J, HTTP 57176/receptor 57175, revisão d4195cfa-8f71-4d8d-8776-a9f446d92e5a, passou usando Node/engine/runtime incluídos: reconfiguração/restore e queda retomam PGM sem replay; arquivamento encerra engine/preserva publicação/as-run e reativação não inicia engine/TAKE. HTTP/WS 2QmyHz passou com credencial protegida, alias e identidade estáveis após reinício e envelope renovado; transporte SIMULATED, não sinal físico. Backup novo restaurado e reaberto passou nos 8 testes de arquivamento, conservando migração 15/canal retirado/checkpoint parado/histórico/publicação/auditoria autenticada. API 4041 continua PID 17464 e serve assets da build atual; inspeção de conteúdo HTTP não é validação visual. Matriz atualizada no workspace após a build, sem modificar documentos do pacote manifestado.

- Consolidação de 01/10 às 19h09: 91 arquivos/572 testes passaram, incluindo 7 testes de arquivamento (Supervisor com apenas um canal visível) e conservação do gate no WebSocket. Typecheck e diff check passaram. Uma nova revisão r21 será gerada sem modificar r20 para incorporar também os últimos ajustes da tela; validação do pacote r21 ainda não deve ser presumida neste snapshot documental.

- Ajuste final de contrato da tela, posterior a r20: WebSocket agora conserva reconfiguration ao atualizar Live (antes descartava o campo recebido); teste do mapeador passou. Arquivar o único canal autorizado da conta limpa a visão antiga e libera acesso ao Histórico/Auditoria sem manter Master do canal retirado. O bloqueio do último canal é exclusivamente global e transacional no servidor, não inferido pela quantidade visível no navegador. r20 foi verificado e passou o ensaio nativo próprio QYXfWc (HTTP 56953/receptor 56952, revisão 3bf4119e-ffb2-4e7b-b172-4eda86082cc0), mas antecede esses últimos ajustes de tela e não é a build final desta etapa.

- Rodada final desta etapa, 01/10 às 19h01: 90 arquivos/570 testes passaram; typecheck passou e build servidor/web passou. QA 4041 foi atualizado após conferir PID 22300/porta/executável/comando: novo PID 17464, banco existente preservado, API publica o gate reconfiguration e transporte permanece simulado. Nada na máquina de operação ou hardware foi alterado. Auditoria, arquivamento e histórico exclusivo de conta sem canal ativo ainda não têm inspeção visual, pois a aba está bloqueada por política. Engenharia passa a exibir o motivo e desabilitar reinício enquanto recuperação está pendente; essa adição entra na build consolidada seguinte.

- Continuação REC-07/SEC-05, 01/10 às 19h: migração 15/arquivamento e auditoria por canal implementados. Rodada anterior desta etapa passou 89 arquivos/565 testes; testes adicionais de CSV, conta restrita e gate explícito de recuperação estão na rodada final. Typecheck passou; build servidor/web passou antes da extensão de Aired para conta sem canal ativo (nova build final será conferida). Ensaio nativo mTDhJR passou com HTTP 56639/receptor 56638, revisão 95dcc0ef-a940-4a91-80b9-618ae6724d69: arquivou/encerrou engine, preservou histórico e publicação, reativou sem engine/TAKE, auditou ambos, não repetiu comando. Tentativa anterior terminou em conflito 409 legítimo: estado PGM chegou antes da conclusão da promessa de recuperação. Acrescentado gate explícito reconfiguration.ready à telemetria e diagnóstico N+1, fora do hash canônico; ensaio aguarda esse gate, não reenvia mutações. r19 é anterior a REC-07/SEC-05/migração 15 e não foi modificado. Redundância de outro host, banco separado, conversão de cadência e auditoria global restante continuam pendentes; homologação física/visual permanece distinta.

- Consolidação de 01/10 às 18h15: 87 arquivos/557 testes aprovados, typecheck, build servidor/web, cargo check e diff check passaram. Pacote r19 compilado/verificado sem sobrescrever r18; manifesto EE3705A9D2A2D5F9F029B03D93614D983DFC1F9597FCCBEDDBFAC16A0830437B. Ensaios do pacote passaram com Node/runtimes incluídos: UYe3ER reconfiguração/restore/automação; a7zMBD proteção HTTP/WebSocket e referência após reinício (SIMULATED); 9FmJQc bootstrap/linha de comando privada; S2wKdD crash/PGM quadro 53; WGCrKh crash/loop de dois arquivos/retorno quadro 62. Nesta última prova, loop sobreviveu à troca de servidor/engine sem replay e retomou origem publicada. Nenhum deles homologa saída física ou HA entre hosts. Ambiente QA 4041 respondeu com PID 22300/backend novo e transporte simulado, não engine físico. Atualizações desta matriz após a build não foram copiadas sobre o pacote manifestado. Permanecem pendentes a redundância entre máquinas, separação do banco operacional, auditoria global restante, exclusão de canal, conversão explícita de cadência e homologação física/visual bloqueada.

- Continuação REC-06, 01/10 às 18h05: ensaio compilado Temp/RPlayout-device-automation-VimDPt passou, HTTP 55375/receptor 55374, revisão 1b98a99d-c67a-4805-ac73-46d8d9e5f361. Restaurar durante PGM foi recusado; após STOP o engine foi recriado, geometria retornou de 800 à largura 640 salva, publicação original permaneceu e PGM continuou parado, sem replay. 68 testes direcionados passaram após corrigir o fixture que omitia loop obrigatório. A rodada integral anterior passou em 87 arquivos/556 testes; teste adicional de PATH está na rodada final em andamento. Montagem do PATH GStreamer corrigida para raiz sem barra final. O fixture aquece agora o mesmo registry privado na geração de mídia e preserva diagnóstico de engine sem sobrescrevê-lo com health repetido; não é medida de cold-start nem prova de causa definitiva dos timeouts anteriores. PID 5748 do QA 4041, iniciado às 16h52 com backend antigo, foi encerrado após conferir executável/porta/comando e substituído pelo backend compilado atual, usando o mesmo banco isolado. Máquina de operação e hardware não foram alterados. UI nova de restauração ainda sem inspeção visual por bloqueio da aba.

- Repetição final REC-05 passou na build atual com auditoria: Temp/RPlayout-device-automation-H4ASyo, HTTP 55014/receptor local 55013, revisão 783d9819-fb18-4ec2-8fca-3bdfbab0e071. Geometria, criar/desativar/remover gravação, troca FILE hot sem novo PID, recusa de cadência, reinício explícito, crash completo e automação sem replay aprovados. Publisher preview deliberadamente ausente; não prova PVW nem saída física. Typecheck final e diff check passaram; build web avisou bundle acima de 500kB, sem erro de compilação. Não foi alterado pacote já manifestado nem a estação do operador.

- Continuação de 01/10 às 17h50: rodada integral passou em 87 arquivos/554 testes; build servidor/web e typecheck passaram. REC-05 amplia a proteção de reinício para formato e saídas; operações hot não persistem configuração antes do ACK. Auditoria dessas mutações é consultável em /api/audit sem gravar destino/chave. Teste específico confere ausência de PRIVATE_ e nenhuma linha de edição em tentativas inválidas. Ensaio A52RWh passou antes da adição dos registros de auditoria; repetição da build atual foi iniciada separadamente. Duas tentativas anteriores TFgUEm/ZEcMkg expiraram aguardando servidor pronto, sem mensagem nativa; não descartadas nem chamadas aprovadas. Mudança de cadência com grade preenchida permanece bloqueada até existir conversão explícita de quadros/publicação; não equivale a suporte dinâmico de alteração de FPS.

- Continuação de 01/10 às 17h11: rodada integral aprovou 87 arquivos/546 testes, após ajustar o novo teste de retirada para verificar shutdown (encerramento gracioso), não kill imediato. Typecheck, build servidor e diff check passaram. Resolvedor TAKE unificado entre página/serviço, sem inferir Próximo. Ensaio nativo BM9LwB confirmou contrato externo. Reinício controlado inicialmente não recuperou PGM porque somente o bootstrap chamava recoverCheckpoint; fluxo explícito corrigido e ensaio ICITxy passou sem replay, seguido de crash do servidor e STOP. Manual no workspace corrigido para pasta remota/CUE/histórico, posterior a r18; não sobrescrever cópia manifestada.
- Pacote r18 verificado e quatro ensaios próprios concluídos; não exige instalação manual de módulos. Crash hgGSw8 retomou cursor 52; contingência de dois arquivos preservou origem após nova queda e retornou ao cursor 28. Não é homologação física nem prova de redundância de dois hosts.
- Continuação de 01/10 às 16h53: 86 arquivos/537 testes aprovados, typecheck/build atualizados e diff check passaram. Ativação explícita de grade entrou na fila nativa, revalida estado antes da instalação e recusa seleção superada/PGM ativo/CUE da grade anterior. Novo controle LIMPAR CUE/PVW liga à rota existente, com teste de API conservando PGM/seleção. Conferência visual nova não concluída: navegador recusou a aba por política de URL; não contornada. Automação/reinício/STOP/ativação nativa passaram em Temp/RPlayout-device-automation-KiFRz1. Tentativa de provar CUE nesse fixture sem publisher preview foi recusada pelo engine; o script agora declara essa ausência, mantendo prova de preview no loopback OMT e rotas próprias.
- Continuação de 01/10 às 14h44: 86 arquivos/534 testes passaram na rodada integral, typecheck/build atuais e diff check passaram. A primeira rodada da revisão final identificou expectativa antiga de PLAYED_FULL/NEXT e nome do XML; testes passaram a exigir INTERRUPTED e aviso de rascunho, sem alterar o fixture de rota para fingir EOF. Ignorados e serviço legado durável implementados. Publicação/rollback/live-duration compartilham fila com TAKE/CUE, mas auditoria de todos os carregamentos ainda não encerrada. PDF de 60 registros/três páginas reinspecionado, sem perda/corte de títulos. Página recompilada confirmou legado estimado e cortes distintos de EOF.
- Recuperação nativa da automação inicialmente recusou TAKE porque o caminho passou do original à cópia SHA verificada durante preroll. Correção refaz o preparo uma única vez para a mesma mídia/revisão e somente sem CUE manual existente; não tolera mudança de cortes/hash/QC/revisão. Cinco testes novos e ensaio nativo Temp/RPlayout-device-automation-0HkDTK passaram com recuperação, STOP e serviço legado incapaz de contornar incerteza.
- Continuação de 01/10 às 14h: automação programada Videohub, migração 14 e ASRUN-01 implementados. Rodada às 13h52 aprovou 85 arquivos/522 testes; teste adicional de atualização de banco antigo passou às 14h00. Typecheck/build passaram. Ensaio compilado às 14h confirmou duração nativa e cadência persistidas além de recuperação sem repetição de comando. Exportação por botão ainda não confirmada no navegador: o observador de download expirou; conteúdo CSV/XML/TXT tem testes, mas isso não é prova do download. PDF de teste renderizado com Poppler e três páginas inspecionadas. Sem emissão física no QA.
- Notas abaixo são histórico das etapas, não declaração de pendências já resolvidas: automação DEVICE_AUTOMATION foi integrada ao ledger durável; configurações/argumentos privados foram concluídos em SEC-03/04. ATEM/GPIO reais, auditoria global restante, host B e pacote final continuam pendentes.
- Build web/servidor gerada; ainda não é o pacote final.
- Suíte completa em 01/10, às 13h03: 81 arquivos / 501 testes aprovados, incluindo controle externo, pedidos duráveis, referências protegidas de entrada, identidade estável após reinício, edição segura de saídas/destinos/presets, bootstrap privado e ACL/janela do watcher. Typecheck e build web/servidor passaram. Engine: 75 testes Rust aprovados, um OMT ignorado na rodada normal; executado explicitamente nesta continuação com libomt.dll do pacote r15 e passou com vídeo/áudio no receptor/transmissor/canal (delivered=2, quadros fonte 320×180 em compositor 640×360). Isso é loopback nativo, não homologação de emissor físico externo.
- Engine release recompilado com a correção de ligação OMT; 66 testes Rust aprovados. Teste OMT normalmente ignorado foi executado explicitamente e passou com vídeo/áudio atravessando o canal.
- QC aprovado por canal agora libera inserção/importação/autofill apenas naquele canal; decisões globais e quarentena são gravadas atomicamente com conferência de hash.
- As-run nativo registra eventos de TAKE/saída confirmados; polling não duplica linhas. Foram removidos LUFS/true peak padrão, contrato fictício e origem nacional presumida. Campos sem evidência permanecem nulos; resumo de classificação não equivale a homologação regulatória.
- Permanecem pendentes, entre outras frentes: standby/fencing/replicação de outro host, auditoria final de todos os endpoints com credenciais, automação externa de dispositivos, separação do banco operacional e pacote final de todo o escopo. Proteção formal de timing, loop local de contingência e pré-cópia futura de cache foram implementados; isso não implementa comutação automática entre dias nem redundância de máquina. Homologação de DeckLink/NDI/emissor OMT externo depende da máquina de operação.
- Controle manual de GC agora consulta o servidor; removidos ticker/notícia/nome de exemplo, timers SCTE no navegador, promessa de PTS/PID/VANC físico e indicadores estáticos de estabilidade. O estado lógico de GC não equivale a prova de pixels na saída.
- Disparo manual de evento devolve o resultado persistido: FAILED/FIRING retornam conflito, não sucesso. Duplicata não repete o efeito. SVG local executado pode ser recomposto após reinício, exceto quando encerrado; SCTE/hardware incertos não são repetidos. Diferença de publicação inclui mudança somente no SVG secundário.
- As-run captura posição de saída e motivo TAKE/EOS/LIVE_PRIORITY antes de resetar o PGM. VT continua avançando durante preroll de live; a última posição reportada é registrada após sinal confirmado. Dois testes adicionais do transporte passaram.
- Empacotamento agora inclui scanner nativo GStreamer, e launcher aponta registry/scanner/plugins para o runtime incluído. Verificador confere carregamento de codecs/NDI/DeckLink/SVG e handshake do engine com PATH portátil; isso não comprova placa instalada nem sinal físico.
- MSVC x64 oficial é incluído ao lado de launchers, engine/auxiliares, Node e scanner. Assinatura Microsoft e arquitetura x64 conferidas; verificador inspeciona o módulo carregado no engine e exige caminho dentro do pacote. Deploy é copiado sem hardlinks antes do manifesto; scripts copiados têm UTF-8 BOM para PowerShell 5.1.
- A primeira repetição do crash r5 junto da suíte/Rust expirou numa chamada HTTP de 5s; repetição isolada passou (Temp/RPlayout-server-recovery-60wNK5). Coletor de processos foi então substituído: uma consulta Windows de até 1,5s, cache de 2s e chamada compartilhada entre clientes; falha mostra N/D, não zero. 3 testes de coletor + 1 de rota passaram, incluindo mascaramento de destino e medição em todas as linhas do mesmo PID. Crash do servidor atual passou em paralelo à suíte (Temp/RPlayout-server-recovery-c7llxh). Não equivale a ensaio de carga de operação física longa.
- Sonda compartilha uma única intervenção enquanto preto/freeze/silêncio e pedido manual aguardam confirmação. Política diferente é recusada, falha libera nova tentativa; sem medição/PGM parado exibe N/D, sem acumular NaN/tempo negativo. 10 testes passaram. Loop local foi implementado depois; failover de host B continua pendente.
- Consulta de saúde do peer N+1 usa apenas HTTP/HTTPS sem usuário/senha na URL, não segue redirecionamentos com o token, mascara query sensível e não devolve mensagem interna de fetch. 5 testes passaram. Continua sendo consulta de saúde, não replicação/fencing/failover.
- Calendário usa a data/canal reais, não confunde hoje com a grade de ontem carregada no Master. Respostas atrasadas de outra data são descartadas; seleção antiga não autoriza remoção e é limpa na mudança de grade (5 testes). Criação local compartilha pedido pendente e verifica contexto antes de inserir; a API ainda admite múltiplas grades por data. Hoje sem grade não é anunciado como “No Ar”.
- Lista de diferenças na revisão deixou de encolher a altura zero com muitos alertas; teste visual mostrou grafismo e zona pendentes sem publicar. Mensagem de atualização editorial não anuncia mais sincronização/publicação fictícia. Removida cota regulatória estática de 3h45 e aprovação automática por quantidade de itens.
- Cópia de grade agora é uma transação editorial completa: início/loop/zonas, todas as flags e regras de live, cortes/áudio, grupos com novos IDs, grafismos e eventos secundários remapeados. Não duplica publicação/as-run/ledger. Origem ausente ou de outro canal não cria grade vazia; falha durante grafismo desfaz também a grade e os itens. 3 testes de cópia + rota com PGM/CUE/revisão preservados (13 testes operacionais).
- Atualização de runtime instala grade/revisão/mapas de mídia e grafismo juntos após todos os awaits. Load antigo ou refresh iniciado antes do corte não reinstala grade anterior. Telemetria compartilha um único refresh lento; edição explícita pode superá-lo. Dois testes de concorrência passaram; domínio de publicação possui 12 testes e rotas operacionais 15.
- O primeiro ensaio de contingência recusou o corte por comparar identidade do objeto recalculado em cada refresh; a conferência foi corrigida para identidade operacional (grade/revisão) mais vigência do QC/publicação. Repetição nativa passou com ciclo completo, novo engine após crash, origem preservada e as-run CONTINGENCY_RETURN no cursor 55. Não chamar isso de failover físico.
- A rodada integral concorrente com Rust/crash teve um timeout DPAPI de 5s no preset; repetição focada passou em 476ms e rodada integral isolada passou. O timeout do teste não foi ampliado nem o erro ocultado.
- Videohub deixou de considerar qualquer byte TCP como sucesso. ACK de PING, dump inicial e ACK isolado do roteamento não confirmam o crosspoint; fonte/destino exigem inteiros explícitos dentro do limite anunciado. Gateway não sobrescreve equipamentos de mesmo tipo e serializa pedidos por equipamento, conferindo cadastro alterado antes do envio. ATEM/GPIO sem driver físico não anunciam sucesso.
- Controle manual no navegador exige sessão/permissão OUTPUT_CONTROL; token de serviço não autoriza essa rota nem é devolvido ao navegador. Cadastro pode ser desativado sem comando físico. Pedidos sobrevivem ao reinício, com resultado incerto separado de FAILED e de EXECUTED; conferência registra nota/ator sem apagar incerteza histórica. Auditoria da rota de serviço legada e automação DEVICE_AUTOMATION ainda precisam de integração durável.
- URI de entrada exposta em listagem/snapshots foi substituída por referência autenticada, vinculada ao protocolo/contexto do cofre e resolvida somente no servidor. Máscara adulterada é recusada antes do decoder; a referência não concede sessão, papel ou canal. CSV da grade mascara o endereço; comparação N+1 mantém seu contrato diagnóstico, não tenta executar URLs redigidas. Aliases e duas fontes de mesmo host com segredos distintos têm testes; proteção de NDI Unicode conferida para não transformar nome em caminho URL codificado. Configuração gerada/argumentos de processos e a auditoria total de saídas ainda pendentes.
- Pacotes r10/r11/r12 foram interrompidos antes de verificação; não são releases utilizáveis e foram preservados. Causa: deploy fazia hardlink de esbuild em uso pelo ensaio TypeScript. Empacotador agora exige importação por cópia; tsx é ferramenta de desenvolvimento, não dependência operacional. r13 passou sem exigir pnpm/tsx/tsc ou instalação de módulos na estação do operador.
- Pacote intermediário r14 passou no verificador portátil e na versão anterior do ensaio HTTP/WebSocket (Temp/RPlayout-source-wire-G4V0yG), mas antecede a identidade HMAC estável e a proteção adicional de edição de saídas. Manifesto SHA-256 451036C944BA97916A64676D5F2BA9097C9D741BCED0028A51A55C5063D3E97D. Não é o pacote final do escopo.
- Rodada integral concorrente com compilação/testes Rust saturou a máquina e expirou o preset DPAPI em 5s e o preroll nativo; ambos passaram isoladamente, sem aumentar os prazos. Testes Windows agora usam até 4 workers (mínimo 1); rodada integral de 500 testes passou e cargo test completo passou. Esse limite organiza o ensaio, não afirma estabilidade sob carga física prolongada.
- Configuração privada usa as APIs ACL do .NET Framework já disponível no Windows PowerShell, sem instalar módulo adicional. A tentativa inicial com Set-Acl falhou na descoberta do módulo nesta estação; a implementação final conferiu permissões usando diretamente File.SetAccessControl/GetAccessControl. O conteúdo sensível não cruza os argumentos nem é enviado ao helper ACL.

## Fontes técnicas

- GStreamer DeckLink: https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-plugins-bad/sys/decklink/gstdecklink.cpp
- Open Media Transport: https://github.com/openmediatransport/libomt
- Blackmagic Videohub Ethernet Protocol: https://documents.blackmagicdesign.com/DeveloperManuals/VideohubEthernetProtocol.pdf?_v=1698822010000
- ACL de arquivo Windows: https://learn.microsoft.com/en-us/dotnet/api/system.io.file.setaccesscontrol?view=netframework-4.8.1
- Watcher MediaMTX (debounce de 1s): https://github.com/bluenviron/mediamtx/blob/main/internal/confwatcher/confwatcher.go

## Fechamento da etapa SEC-19 e QC em 03/10 às 21h32

Validação integral final: **146 arquivos / 1139 testes** passaram (21h29m37s,
118,07s). Tipos, build, cargo check e diff check passaram. Acrescentados testes
da posse durável, processo lento/unknown/remoto, falhas de journal/conclusão,
compensação/ACK perdido, revogação depois do ACK, escritor externo, atualização
do perfil de watchdog e reconciliação recusada com PGM/CUE ou prova antiga.
Esses testes não constituem fencing/HA entre hosts.

Servidor compilado SHA256
`BD86809D09E8DA4B71C77BC763BDC2250BE6F282CE351984E29BBAB78A11D5D9`;
web `index-uYZYdXSf.js` / `index-CZEXkAEj.css`. QA 4041 atualizada, PID próprio
30044, HTML/JS HTTP 200 contêm Ver em qualidade/Voltar ao preview leve e
reconciliação; ausência dos números fictícios de RTT/perda conferida no bundle.
Isto confirma entrega de código, não composição visual ou playback no navegador.
Canal 1 mantém 14 itens/revisão 25494162001883 e RW 13/revisão 1744;
ambos SIMULATED, PGM parado/CUE vazio, políticas automáticas DISABLED/version0,
configuração IDLE/revisão 168123508636337. Backup anterior ao restart preservado:
`rplayout-2026-10-04T00-27-15-595Z-361a4df9-faa0-4eb5-87d3-be278c80e02e.db`;
integridade/FKs/cofre verificados, 22 migrações, nenhum backup removido.

QC compilado em blRQs5, HTTP 49310/PID 29920: JPEG do original 3840×2160,
preview 320×180 e SHA original idêntico; QC PENDING sem decisão automática.
NE8vEu validou PGM/saídas/recuperação/automação nativos locais com arquivo real,
sem homologar destino físico. ZSfPyW validou dois servidores compilados com
SQLite compartilhado, concorrência/ABA/auditoria/restart/backup, não replicação.
Processos temporários encerrados; nenhum engine nativo remanescente após os
ensaios. Pacote r21 anterior não foi substituído nem anunciado como atualizado.

Objetivo geral permanece ativo: guardas dos controles restantes, banco separado,
HA/replicação/fencing entre hosts, pacote final atualizado e homologação
DeckLink/SDI/NDI/OMT, navegador e soak prolongado continuam pendentes.

## Continuação OPER-02 / SEC-20 — retorno de VT interrompido durável

Estado: implementação local e ensaio compilado aprovados; não homologa corte de
entrada ao vivo física nem o quadro exato no destino. Não encerra o escopo geral.

Corrigidos o reset indiscriminado RESUMING→PENDING na inicialização e a liberação
do cursor depois de qualquer falha de TAKE. Pedido, posse, decisão e estado do
retorno usam transação imediata/journal protegido. PREPARING sem despacho pode
terminar FAILED/PENDING; SWITCHING sem confirmação permanece UNCERTAIN, cercando
novas entradas, watchdog e recuperação após reinício. CONFIRMED/RESUMED são
gravados juntos. Limpeza de PVW posterior não desfaz confirmação durável.
Identificador repetido retorna o mesmo resultado sem reenviar comando.

Conferência original inclui ocorrência do PGM, edição/revisão operacional,
configuração, especificação e decisões atuais de mídia/QC. Autorização, canal,
runtime e conferência são reconferidos dentro da fila nativa, antes e depois do
preroll. O QC vigente é consultado diretamente, sem depender de refresh da
memória. Opaque proof usa o formato base64url do cofre (43 caracteres), não a
suposição incorreta de hexadecimal encontrada pelos testes de integração.

UI por canal preserva pendências/erros, distingue simulação de confirmação nativa
e não fabrica homologação física. UUID usa entropia do navegador inclusive em
HTTP LAN sem randomUUID. Reconhecimento por Supervisor/Administrador exige PGM
parado/CUE limpo, mesma posse original e prova conservadora de processos mortos
ou callback local concluído. Fecha CLOSED_UNCERTAIN, limpa checkpoint no mesmo
commit e não reabre o cursor. Consulta segue disponível na tela sem engine/grade.
Processo remoto/vivo/EPERM, pedido ativo e legado sem dono não são liberados.

Rodada final: **150 arquivos / 1172 testes**, início 22h10m36s, 120,98s. Tipos,
build servidor/web, cargo check e diff check passaram. Ensaio
`verify-interruption-return.mts` com servidor compilado/engine nativo passou em
`Temp/RPlayout-interrupted-return-Sparhh`, HTTP 50333: retorno no cursor 27,
as-run com esse cursor, duplicata sem TAKE, dono vivo não roubado, crash completo
com UNCERTAIN sem abrir engine, encerramento sem replay/cursor e novo restart
parado. Usa arquivo local/null output; incerteza é injetada duravelmente.
Não prova emissor live físico, saída física, navegador ou redundância entre hosts.
Processos próprios do ensaio encerrados; nenhum engine nativo remanescente.

Servidor SHA256 `935E759F5031DA17B8C32A1FED41A1D213F8168EA35369C23CB24E413CD59FD0`;
web `index-CuuOGjqN.js` / `index-BPf3vnmh.css`. QA 4041 atualizada, PID 19784,
preservando banco/cofre/grades e políticas. Backup verificado antes do restart:
`rplayout-2026-10-04T03-34-22-177Z-be498dc5-acaf-45ca-bd55-b5b8adb35307.db`,
integridade/FKs/cofre aprovados, 22 migrações, nenhum backup removido. A conferência
HTTP comprova entrega do bundle, não playback ou inspeção visual. Pacote r21
anterior não foi modificado; pacote final atualizado continua pendente.

## Continuação OPER-01 — inserção urgente na playlist operacional

Implementação local concluída com conferência/execução separadas na página do
Master. Escolhe vídeo ou entrada habilitada do próprio canal; nome da entrada
é congelado como título depois da seleção. Live recebe duração estimada e não
é anunciado com sinal por ter sido descoberto. Vídeo exige versão SHA, QC atual
do canal e duração/corte reproduzível. Um ativo que mudou de bytes não substitui
silenciosamente outros VTs já publicados. Cortes/áudio novos pertencem somente
ao novo item; gráficos/eventos e comandos de equipamento não são duplicados.

**PRÓXIMO** prepara e insere logo após o item corrente, preservando PGM e CUE
manual. Mantém Auto Next/loop/hold do item atual; não promete avanço automático
quando o operador desativou Auto Next. Sem PGM, insere no início. Simulação
permite esse planejamento, sem alegar confirmação nativa.

**AGORA** exige engine nativo. Uma mesma fila abrange conferência, preroll,
despacho e confirmação. Registro SWITCHING é durável antes do TAKE; ACK de live
não confirma revisão/PGM. Commit exige identidade nativa do novo item; erro de
fonte cancela TAKE pendente conservadoramente, e falta de confirmação permanece
inconclusiva. Interrupção do VT registra a última posição reportada e fica
disponível para decisão explícita de retorno.

Revisão, auditoria, pedido e fase de posse são gravados atomicamente. Timing
é recalculado no commit com relógio/ocorrência atuais; conferência mostra conflitos
e aviso de estimativa, não um cronograma prometido imutável. Rascunhos editoriais
e suas pendências não são publicados pela intervenção. Passagem já enfileirada,
contingência/slate, recuperação ou outra operação impedem inserção concorrente.
Autorização, ocorrência, revisão, configuração, fonte e QC são reconferidos antes
e depois da preparação. Sessão revogada ou fonte desabilitada não corta o PGM.

Se o PGM realmente cortou e a persistência falha, a visão mostra o item real,
sem atribuir confirmação à edição antiga. Resultado inconclusivo cerca novos
TAKEs/recuperação e não é repetido no crash/restart. Supervisor/Administrador
reconcilia a configuração com PGM parado/CUE limpo e prova de dono/processos
encerrados. A decisão original continua UNCERTAIN no histórico, sem transformar
reconciliação em sucesso retroativo. Consulta privada de pedido não carrega engine
nem envia comando; a página usa essa consulta após erro de comunicação.

Validação final: **151 arquivos / 1192 testes**, início 06h30m18s, 115,06s; tipos,
build servidor/web, cargo check e diff check aprovados. Os 17 testes de rota
cobrem concorrência, revogação, QC/fonte/bytes/ocorrência superados, rollback
atômico, identidade nativa, consulta sem runtime e reconciliação sem replay.
Os 3 testes adicionais de transporte cobrem NEXT sem TAKE/CUE alterado,
ACK live insuficiente seguido de quadro PGM e erro de fonte com cancelamento.

Ensaio compilado final `verify-interruption-return.mts` passou em
`Temp/RPlayout-interrupted-return-m88EYU`, HTTP 65005/cursor 28: arquivo Unicode
real, CUE manual preservado, NEXT/NOW sem publicar rascunho, mesmo PID, duplicatas
sem TAKE, retorno/as-run e crash integral sem replay. Falha de auditoria após
corte real também permaneceu cercada após restart; reconciliação parada e novo
restart não repetiram a inserção. Barramento preview real com publisher sob
demanda/idle; nenhum receptor MediaMTX foi iniciado. Não prova imagem no
navegador, recepção de rede, entrada live física ou saída física. O teste de
falha pós-corte é persistência injetada, não perda real de ACK na rede.

Servidor SHA256 `69557440C0E16D7A56AE22BE1A8163DC36882947D1C0BA8E74956258828E7240`;
web `index-DB7iYs_H.js` / `index-BPf3vnmh.css`. QA 4041 atualizada, PID 30612:
HTTP/bundle conferidos com painel de inserção, consulta sem replay e botão QC
Ver em qualidade. Grades preservadas: Canal 1, 14 itens/revisão 25494162001883;
RW, 13/revisão 1744. Ambos simulados, PGM parado/CUE vazio e configuração IDLE.
Conferência HTTP não equivale a inspeção visual/playback.

Backup antes do restart: `rplayout-2026-10-04T09-30-37-101Z-4e082e28-26a1-41dd-83b3-78ccd5f86844.db`;
integridade/FKs/cofre verificados, 22 migrações. Retenção automática conservou dez
backups e removeu `rplayout-2026-10-03T22-15-10-772Z-a3bef7f9-bd63-47e5-94b8-b3b77730791b.db`;
essa cópia removida não foi preservada separadamente. Processos nativos próprios
do ensaio encerrados; QA permanece simulada. Pacote r21 não foi sobrescrito.

Objetivo geral permanece ativo. Banco operacional separado, HA real entre hosts
com replicação/fencing/failover/as-run, pacote final atualizado, hardware,
navegador e soak prolongado continuam pendentes. Não anunciar toda a solução
como pronta nem confundir a cerca local desta operação com redundância broadcast.

## QC — reconferência do botão de qualidade em 04/10 às 14h40

O pedido de inspeção em qualidade foi reconferido na implementação existente:
`Ver em qualidade` abre o original da edição selecionada; `Voltar ao preview
leve` retorna ao proxy. Qualidade é opt-in por arquivo/hash/canal, não altera
PGM e não registra aprovação. Safe area permanece desativado por padrão.
Entradas ao vivo continuam no preview leve: este botão não certifica nem
habilita monitor de alta qualidade para live.

29 testes direcionados (quatro arquivos), typecheck, build servidor/web e
diff check passaram. Ensaio compilado com mídia 4K real:
`Temp/RPlayout-QC-quality-0Nr1jL`, HTTP 51330/PID próprio 17612, original
conferido por SHA256, JPEG 3840×2160 e preview 320×180; QC permaneceu PENDING
sem decisão automática. Processo do ensaio encerrado. Isto não constitui
validação visual nem playback no navegador, áudio original ou sinal físico.

QA 4041 estava sem processo/listener; foi restaurada com o mesmo banco/cofre
isolados, MediaMTX e engine nativo desativados, PID próprio 19768. HTML e
bundle HTTP 200, com os dois textos do botão. Build servidor SHA256
`1150D1F6DDC0DEC30DD0429CCBFFD2BA79AC4EB13F5E49F2C4A5DE2AE27752D6`, web
`index-hqQseIMx.js` / `index-BBx7O8R5.css`. Pacote portátil r21 não foi
substituído. A implementação geral e sua homologação continuam pendentes.

## HA-01/HA-02 — estado e mídia independentes, 04/10 às 15h

O espelho de estado conserva as edições publicadas, configuração, checkpoint,
as-run e journals operacionais. Não instala rascunhos, usuários ou chaves do
cofre no banco operacional do reserva. Cada nó usa seu banco/cofre próprio;
o pareamento tem chave separada e a sequência não é reiniciada em erro.
Perda de ACK reenvia o mesmo snapshot. Escolha de fonte SRT não equivale a
troca física de PGM e o painel não exibe heartbeat/diagrama HA fictícios.

A mídia usa um worker separado. A edição aceita pelo reserva define os hashes
autorizados, incluindo VT, áudio e imagem. A escolha da origem no primário
prefere arquivo arquivado, depois cache conferido, depois original — sempre
com verificação SHA do handle aberto. Blocos criptografados têm finalidade
própria; provas de STATE/MEDIA não se substituem, não valem como sessão/admin
e não autorizam TAKE. A transferência é retomada pelo offset remoto durável;
um arquivo completo somente é anunciado após SHA. Nenhum caminho do outro nó
determina o destino local. Arquivos estrangeiros, parciais reprovados e cópias
antigas são preservados; não há limpeza automática indiscriminada para caber
na quota. Publicação exclusiva exige suporte a hardlink no volume escolhido.

Validação integral: **157 arquivos / 1229 testes**, 129,22s. Tipos, build
servidor/web, cargo check e diff check passaram. Ensaio compilado
`Temp/RPlayout-ha-replication-NczT7O`, HTTP 51742/51743: reserva interrompido
depois de 262144 bytes, offset conservado após restart, mídia completa
`89cacfb92f643672635adff321162584a4e615e83ec968be05e4610446abcb60.media`
com SHA idêntico. O primário manteve o VT em engine NATIVE durante a parada do
reserva. Edição publicada (não rascunho), checkpoint e as-run nativos chegaram
ao espelho; restart de ambos conservou sequência e cofres distintos. Reserva
não abriu engine nem com binário configurado/canal local. Processos próprios
e listeners do ensaio encerrados. Não é prova de failover físico, RPO/RTO,
saída SDI/NDI/OMT ou promoção segura.

Build servidor SHA256
`A5BDFA65DDA3F8B06BA093E1C77DA31A83A20DF852DC00AA7352B524DDFC964F`, web
`index-Del2wNYI.js` / `index-BBx7O8R5.css`. QA 4041 permanece no processo
19768/banco/cofre isolados; essa instância ainda usa o backend anterior,
sem HA configurada. O web compilado no workspace foi atualizado. Pacote
portátil r21 permanece imutável e não contém estas alterações.

Próximas condições obrigatórias antes de assumir PGM: homologação da autoridade
entre máquinas e fencing externo de saída, promoção/restauração operacional com caminhos locais e
QC atuais, handoff de as-run, teste de partição/recuperação entre máquinas,
RPO/RTO medidos e destino físico validado. Separação do banco operacional do
processo servidor, pacote final, navegador e soak prolongado também continuam
pendentes. `failoverReady` e `automaticTake` continuam false deliberadamente;
isto é uma etapa da implementação, não redefinição do objetivo geral.

## QC — botão e build reconferidos em 04/10 às 15h36

O botão existente **Ver em qualidade**, acima do player de arquivos, foi
reconferido sem ativar download original por padrão. O retorno continua
**Voltar ao preview leve**. Hash/canal/arquivo vinculam a escolha; trocar a
seleção revoga a inspeção anterior. Aprovação e TAKE não são efeitos do botão.
Safe area permanece desligado. Live continua no preview leve.

Ensaio compilado `Temp/RPlayout-QC-quality-ShZmU7`, HTTP 52777/PID próprio
9392, passou: SHA256 do original idêntico, JPEG 3840×2160 e preview 320×180,
QC PENDING e zero decisões. Processo próprio encerrado. Não comprova playback
ou conferência de áudio no navegador. Tipos e build servidor/web passaram;
suíte integral: **158 arquivos / 1240 testes**, 121,43s. QA 4041/PID 19768
entrega `index-CtolGAPz.js`, com ambos os textos; isso é evidência HTTP/bundle,
não inspeção visual. Backend dessa instância não foi reiniciado. Pacote r21
continua anterior e preservado; pacote final e objetivo geral não estão prontos.

## HA-03 — testemunha independente e expiração nativa, 04/10 às 15h36

Nova testemunha compilada `apps/server/dist/ha-witness.cjs`, banco próprio,
chave distinta do pareamento e termos persistidos. Uma concessão por canal e
identidade de processo; renovação autenticada não aceita nonce antigo e ACK
duplicado não prolonga posse. Relógio monotônico governa validade. Reinício
sempre impõe quarentena de 6 segundos antes de conceder posse novamente.

O engine em modo protegido aguarda a primeira concessão antes de construir
pipelines. O prazo nativo começa na emissão do nonce, nunca no recebimento do
ACK: TTL 5 segundos com margem de 1 segundo. Watchdog independente do loop
de comandos/stdout encerra o processo com código 75; probes bloqueiam buffers
nos sinks após expiração. Chaves não vão para argv/env do engine. Backend
recusa Ready sem confirmação nativa; nova identidade impede usar ACK atrasado
para reativar o processo substituto. Sem testemunha configurada, não há esse
contrato: o espelho antigo continua sem promoção automática.

`Temp/RPlayout-ha-fencing-HbtQC3`, HTTP 52423: dois engines nativos e
testemunha compilada; segundo processo não publicou enquanto o primeiro
tinha posse. Suspender renovações e leitura do stdout do primeiro resultou
em exit 75; só depois o segundo iniciou VT com termo 2. Reinício da testemunha
respeitou quarentena/termo 3; concessão atrasada foi recusada. Não foi suspensão
do sistema operacional completo, nem prova de eliminação de pacotes em voo.

`Temp/RPlayout-ha-replication-Nsc9kM`, HTTP 52532/52533/52534, passou com
dois backends compilados, engine real e testemunha compilada: concessão nativa
integrada, VT, publicação/checkpoint/as-run, sequência após crash, cofres/bancos
independentes e retomada da mídia interrompida aos 262144 bytes. SHA recebido
`11ced1ec2b4247ea6627454e3153a3290e77914fd424ae22379a2bbbde9442f5`.
Reserva permaneceu sem engine. Processos próprios dos ensaios encerrados.

Sete testes de testemunha e três novos de transporte passaram; quatro testes
Rust de fencing passaram e o engine release foi recompilado. Suíte integral
inclui 158 arquivos/1240 testes. UI distingue concessão de confirmação de
saída e não libera takeover. Ainda faltam promoção operacional, importação
com mídia/QC locais, handoff, rejoin/failback, fencing externo, partição entre
hosts, saída física, RPO/RTO, soak e pacote final. Isto não completa HA-01.

Build atual: servidor SHA256
`82DEF2A2F6E5BF3F01FBE3767104C5744933619CBE41E43FF088C5D83672491A`,
testemunha `1385B809B34E7C0514739F3C456C7FCAF0A1DDDA0F8CDDE7BDEBC118B8974059`,
engine `060A8F2834A0E27953125912416C6E0BC16D57F8823D63C324DE1E7041A4E993`.
O pacote portátil ainda precisa incorporar/verificar a testemunha e os builds
atuais; não tratar o r21 como contendo estas alterações.

## Distribuição portátil e partida fria — 04/10 às 15h59

Os scripts agora exigem/copiam `ha-witness.cjs`, inicializador próprio e
verificador JavaScript sem TypeScript. A checagem roda com Node do pacote,
SQLite de produção e PATH exclusivamente portátil/Windows: posse exclusiva,
expiração 75, reinício/quarentena e termo seguinte. Testemunha não usa o banco
operacional: bancos de outro serviço são recusados antes de criar tabelas ou
alterar journal (oitavo teste de domínio). Inicializador exige pasta de dados
fora da distribuição, não substitui chave e não inicia PGM. Corrigido também
o helper do servidor: os executáveis são procurados na raiz do pacote, não
num diretório pai que poderia conter outro release.

Pacote candidato r22 gerado em `release/RPlayout-1.1-broadcast-20261004-r22`,
6607 arquivos no manifesto SHA256
`8D7D0AB16875D2E098EB6841CFADD3A5BD54D7209FF0E65B72E7FDCB63C593C2`.
Dependências, assinaturas MSVC, módulo carregado do pacote, SQLite e testemunha
passaram (`Temp/RPlayout-package-witness-qK9wvI`, HTTP 53033). **Não aprovado
como pacote final:** ensaio de recuperação `Temp/RPlayout-server-recovery-0AoDoc`
terminou sem inicialização dentro de 20 segundos. Diagnóstico adicional no
mesmo banco isolado, backend próprio PID 11520/HTTP 53113, mostrou engine ainda
starting, registro GStreamer recém-criado e watchdog encerrando a primeira
partida após 20 segundos. O processo substituto ficou Ready. Esse backend de
diagnóstico foi encerrado; não se alterou QA 4041 nem banco do operador.

Correção: partida antes de Ready nativo tem limite de 90 segundos, distinto
do primeiro quadro (20 segundos após Ready) e do travamento em regime (3).
Ordens confirmadas aguardam Ready antes de iniciar timeout de decoder/ACK.
Queda/fechamento recusa a espera, sem reenviar ao próximo processo; readiness
agora também exige processo vivo e transporte não encerrado. A cerca HA
nativa permanece independente e curta; nenhum prazo de posse foi ampliado.
Cinco testes novos de transporte/watchdog e o teste de banco estrangeiro
passaram. Suíte integral: **158 arquivos / 1246 testes**, 133,29s; tipos e build
passaram. Ensaio compilado `Temp/RPlayout-server-recovery-37yHBw`, HTTP 53297,
passou com zero stalls/restarts na primeira partida: VT real, crash/retomada
de cursor e as-run, STOP, snapshot WebSocket e ciclo de dois arquivos da
contingência, crash do loop e retorno ao VT original. Saída null, não hardware.

r21 foi preservado com manifesto SHA256
`367CD7FF131F4251CE3990F8D91D0E7A0BA5BD9B4738380E4B8006732ED64A52`.
r22 permanece preservado para reproduzir o defeito de startup; não foi
remendado nem substituído. Próxima distribuição precisa conter a correção e
repetir o ensaio com Node/engine/plugins próprios. Objetivo geral continua
ativo: promoção/HA física, banco operacional separado, browser e soak pendentes.

## Candidato r23 e QA atualizado — 04/10 às 16h08

`release/RPlayout-1.1-broadcast-20261004-r23` foi gerado sem substituir r21/r22.
Manifesto SHA256
`EAFD52DCBC09141563B12C830B0F753FD72F0168A295A68707D68710F3BE6304`,
6607 arquivos. Servidor SHA256
`2CB19DD15F6112F64F90170D499848D306383E58D0145A001C86612EE7A3B14F`,
testemunha `245DADCAF8AFAB0B65621AA337570FD7C5D410D9CE4D5B02BF93F369CE083EEA`,
engine `060A8F2834A0E27953125912416C6E0BC16D57F8823D63C324DE1E7041A4E993`.
Build, materialização sem symlink/hardlink para o workspace, manifesto,
assinaturas e carregamento MSVC app-local, Node/SQLite e plugins portáteis
passaram. `Temp/RPlayout-package-witness-W14tJI`, HTTP 53524: Node/testemunha e
engines do pacote, dono exclusivo, exit 75 e restart/quarentena até termo 3.

`Temp/RPlayout-server-recovery-R4pWad`, HTTP 53537: servidor e engine do r23
com PATH portátil/Windows e registro próprio inicialmente novo. Ready em
13931ms, zero stalls/restarts na primeira partida. VT confirmado; queda do
backend/engine seguida de retomada a partir de 50 quadros com revisão/execução
preservadas, evento secundário não repetido, as-run RESTART/STOP e snapshot
WebSocket. Reserva local de dois arquivos fez ciclo completo, sobreviveu a
crash do servidor/engine e retornou ao VT original a partir de 33 quadros.
Null não é prova de SDI/NDI/OMT, preview físico ou failover entre hosts.
Processos e listeners próprios dos dois ensaios foram encerrados.

QA 4041 atualizado de PID 19768 para PID próprio 15164 (wrapper/session 46433),
mesmo banco/cofre/pastas. Revalidados os dois canais SIMULATED, PGM parado/CUE
limpo, antes do restart. Backup pela API SQLite, integrity/foreign keys ok,
em `preserved-backups/pre-r23-a424b80e-c1fc-4b87-a5cb-f6518069778b.db`, sem
retenção ou remoção de cópias anteriores. Depois do restart: 14 itens/revisão
25494162001883 e 13 itens/revisão 1744 intactos, transportes SIMULATED parados,
PGM/CUE nulos. HTML e `index-IdfFiPoM.js` HTTP 200 contêm os dois textos de
qualidade do QC. Isto não é inspeção visual/playback. Engine, MediaMTX,
hardware e HA permanecem deliberadamente desativados nessa instância.
O contador legado `/api/health.engines` inclui transportes simulados; não
interpretar esse número como quantidade de processos nativos ou placas.
Separar essa métrica é uma correção de observabilidade ainda pendente.

r23 é candidato validado para o estágio atual, **não entrega completa do
objetivo**. Promoção/restauração do espelho, handoff/rejoin/failback, fencing
externo, falhas entre máquinas, banco operacional separado, browser/áudio e
saídas físicas e soak prolongado continuam pendentes. Documentos embalados
precedem esta validação; os arquivos do pacote não foram remendados depois
do manifesto. Resultado e matriz atualizados apenas no workspace.

## HA-04 / OBS-03 — restauração isolada e saúde sem simulação, 04/10 às 16h37

`/api/health.engines` conta agora apenas EngineTransport nativo pronto.
`nativeEngines` informa os transportes nativos criados (não sinal físico), e
`simulatedChannels` separa a simulação. A pendência do contador apontada na
seção anterior foi corrigida no workspace/QA, não por remendo do pacote r23.

O espelho leva decisões de QC do canal **e @all**, ordenadas por rowid como
o resolvedor efetivo. Aprovação/revogação no mesmo timestamp não é reordenada
por UUID. Banco HA indicado sobre DB de outro serviço é recusado antes de
mudar journal/criar tabelas. A testemunha também não confunde prefixo alheio
`sqlitex_` com tabelas internas SQLite; casos de preservação testados.

GET/POST `/api/ha/rehearsal` exigem autorização administrativa normal e
acesso ao canal. Prova de pareamento não substitui sessão. POST aceita apenas
UUID, canal e sequência atual; não aceita TAKE/caminho de destino. Reserva
persistente gera banco novo em pasta exclusiva sob `rehearsals`, sem afetar
seu banco operacional nem o primário. SHA é revalidado em leitura, cursor e
referências são conferidos, publicações mantêm JSON/IDs originais. Decisões
QC explícitas são conservadas, mas aprovação legada sem decisão por versão
não libera a mídia. Nenhum arquivo remoto é usado como caminho local.

O banco do ensaio tem canal arquivado/cursor parado, sem saídas, contas,
inputs cadastradas ou jobs externos executáveis. Proveniência original fica
cifrada com o cofre local do reserva; não requer copiar o cofre primário.
`ha_recovery_origin` impede criação de runtime mesmo após desarquivamento.
`RESTORED` significa apenas banco isolado reconstruído, nunca PROMOTED:
`promotionReady=false`, `automaticTake=false`, `localProbeRequired=true`.
Repetição de UUID consulta o ledger; outro canal/seq com mesmo UUID recusa.
Um CHECKING deixado por crash não é reexecutado nem liberado implicitamente;
reconciliação controlada desse estado permanece por implementar.

53 testes direcionados passaram; suíte integral passou com 159 arquivos/
1264 testes. Depois foi acrescentada a guarda de runtime do banco de ensaio,
com revalidação dos 11 testes de restauração. Typecheck do workspace e build
servidor passaram. Ruflo/ToolSearch continuam ausentes dos tools expostos;
nenhum substituto ou pacote foi instalado.

Ensaio compilado inicial `Temp/RPlayout-ha-replication-Tya3aM` restaurou o
banco, mas falhou na reabertura posterior do main.db temporário com
SQLITE_IOERR_TRUNCATE. **Não conta como PASS completo.** Ambos os bancos
main/mirror passaram em integrity/FK por leitura após falha; arquivos
preservados. O verificador agora aguarda evento close do próprio processo
antes de reabrir seu banco. Isso não prova definitivamente a causa do I/O.

Nova rodada `Temp/RPlayout-ha-replication-rWYWHU`, portas 54320/54321/54322,
PASS: dois servidores compilados/bancos/cofres distintos e testemunha
independente; VT nativo no primário com concessão, parcial interrompido aos
262144 bytes e retomado. SHA 8f6b55e6c1248a2bd67b23ceacf2a95d30bdd8a1e6b663f78bff0d9ba3b37d87
confirmado. Ensaio pedido 60a8cc3e-8ea9-439d-be62-f66c7f0bb340 restaurou
seq 9/uma publicação/um arquivo/checkpoint, com QC PENDING (legado sem
decisão). DB integrity/FK ok, cursor parado, sem contas/saídas/as-run local;
payload decifrado com cofre do reserva conservou PUBLICADO, não RASCUNHO.
Reinício conservou relatório e repetição não criou outro banco. Primário
continuou sequência após restart. Processos/listeners próprios encerrados.
Saída null local: não prova host remoto, saída física, promoção ou failback.

QA 4041: backup preservado `pre-ha-rehearsal-fa0fd520-e34c-4a83-b030-9b8a5d4718be.db`
por API SQLite com integrity/FK ok, sem retenção/deleção. PID próprio 15164
substituído por 11388 (session 49287) somente após revalidar simulação/STOP/
CUE vazio. Mesmos banco/cofre/pastas; 14 itens/revisão 25494162001883 e
13 itens/revisão 1744 intactos. Health agora engines=0/nativeEngines=0/
simulatedChannels=2. Engine/hardware/MediaMTX/HA desativados nessa instância.
Servidor compilado SHA E8ADF58A0C3D4B2F4937983B106399A9DA7FCDC3312C80B1C89C62AD5F8ACF35.
Web/QC do r23 permanece, sem alegar inspeção visual nova ou áudio no browser.

O objetivo segue ativo. Não foram entregues promoção/handoff/rejoin/failback,
fencing externo, banco operacional separado, browser/saídas físicas ou soak.
r23 é pacote candidato anterior a HA-04/OBS-03; pacote final continua pendente.

Revalidação final 04/10 às 16h41: suíte integral **159 arquivos/1264 testes**
PASS após a guarda `ha_recovery_origin` (122,15s). Segundo ensaio compilado
consecutivo PASS em `Temp/RPlayout-ha-replication-6WFoHJ`, portas
54556/54557/54558, parcial 262144 bytes e SHA
9c54db8aa1bf3cf8270449389689cfae3fdb274c1a2d728f4d4030a9a7d3ad83.
Pedido a1e5847d-4cce-409a-a179-9dcba95f15e4 restaurou seq 9 em
`reserve/rehearsals/recovery-GInyIg/operational.db`, mesma proteção/QC
PENDING/cursor parado; reinício e repetição só consultaram o resultado.
Fencing nativo da testemunha habilitado no primário; sem takeover/host físico.
Processos/listeners temporários encerrados pelo verificador.
HTTP do QA e bundle `index-IdfFiPoM.js` responderam 200 e conservaram
“Ver em qualidade” / “Voltar ao preview leve”. Isso não é inspeção visual
nem comprovação de playback/áudio no browser. Diff check passou.

## HA-04 — reconciliação de crash e integridade de referências, 04/10 às 17h05

Continuação anterior classificada como progresso: restore isolado real,
health corrigido, testes e dois ensaios compilados. O objetivo amplo segue
ativo; esta etapa não substitui promoção, failover, banco separado ou físico.

Ledger HA agora registra criador `{host,pid,boot}`. Upgrade acrescenta coluna
sem remover relatórios/workspaces; CHECKING anterior fica com dono desconhecido,
não com PID inventado. Atualizações do builder exigem sua posse original.
POST `/api/ha/rehearsal/reconcile`, com UUID/canal/seq original, só transforma
CHECKING em REFUSED/reconciliado após ESRCH de processo local. Não usa relógio
ou timeout como prova de término, não mata criador, não modifica parcial e
não executa TAKE. Processo atual/vivo, PID reutilizado, outro host, EPERM ou
dono ausente/corrompido recusam liberação. Resultado cifra ator/horário;
duplicata consulta o mesmo resultado. Novo ensaio exige UUID novo.

Fronteira HTTP mantém login normal/ADMIN/canal/estação/origem: prova HA não
vira autorização administrativa; OPERATOR, SUPERVISOR e ADMIN fora do canal
recusados. Requisições válidas têm canal associado à auditoria HTTP. Comparar
intenção considera valores validados, não ordem das propriedades JSON.

Checkpoint recebido é validado com o mesmo parser de leitura/escrita local,
antes de parar o cursor de ensaio; não mascara PGM sem grade/item mudando
playing para false. Contingência exige loop/grade presentes. Itens devem ter
metadados para referências de mídia/fallback; duplicatas e SHA inválido em
edição ativa/executada/futura são recusados antes de gerar workspace. Revisão
histórica não exigida mantém metadados legados sem tentar tocá-los/copiá-los.
Política QC e zonas congeladas permanecem no banco isolado; vínculos físicos
estrangeiros continuam removidos e sonda local continua obrigatória.

38 testes dirigidos (24 recuperação, 4 checkpoints, 10 HTTP) PASS. Suíte
integral **159 arquivos/1281 testes**, 124,81s; typecheck do workspace/build
servidor/diff check PASS. Ruflo/ToolSearch continuam sem tools expostos;
não foi instalado/inventado substituto. Nenhum agente delegado.

Ensaio compilado `Temp/RPlayout-ha-replication-ilf9nA`, portas
54943/54944/54945, PASS. Mantém testemunha independente, VT nativo no
primário, mídia retomada após 262144 bytes, bancos/cofres/seq próprios e
reserva sem engine. Restore seq 9 preservou PUBLICADO/cursor parado; não
copiou rascunho nem aprovou automaticamente legado. Criador independente
real PID 17552, executando domínio HaRecovery, pausou após CHECKING; API do
servidor compilado recusou reconciliar enquanto vivo. Após SIGKILL desse
filho próprio, pedido 792144fa-7e5b-4c37-a298-1b72aa2c9045 foi reconciliado,
duplicatas não repetiram trabalho e novo UUID fez novo restore. SHA do
workspace completo anterior não mudou. Reinício manteve relatório/resultado.
O helper é fixture de teste, não runtime de operação nem engine de PGM.

Repetição após limitar helper à sua pasta temporária e inspecionar identidade
em leitura antes de pragmas: `Temp/RPlayout-ha-replication-x0UCry`, portas
55175/55176/55177, PASS. Pedido interrompido
be1f306c-806e-4ea8-bcfb-09f75899a89b/criador 18116 reconciliado; restore seq 9
1f4b6bb9-3859-4fd2-a337-c2ec59cd2de4 em recovery-2aqS5t. SHA de mídia
ce857de6a3a1c1cb12585f324ae0f9b0ea2f78c788303a52332607a145874964,
mesma prova de mídia/workspace/replay/restart/ausência de engine no reserva.
Processos/listeners próprios dos dois ensaios encerrados. Null local e
criador de domínio: não comprova troca de PGM entre hosts, routing externo,
falha física, áudio/imagem externos ou disponibilidade contínua.

QA 4041: preservado backup `pre-ha-reconcile-c0be7d79-46a8-404f-bfcb-8b0620453a8e.db`
por API SQLite/integrity/FK, sem retenção/deleção. Revalidados SIMULATED,
PGM parado/CUE vazio, antes de trocar PID próprio 11388 por 10844
(session 63828). Banco/cofre/pastas iguais, 14 itens/revisão 25494162001883
e 13 itens/revisão 1744 intactos. Health engines/nativeEngines=0,
simulatedChannels=2. Backend SHA
3332B6C1777808E1F222CF881D0E96D262C689E037039C84E97DEABBB9640000.
Engine/MediaMTX/hardware/HA desativados deliberadamente nessa instância;
não inferir placa ou recuperação nativa pela simulação. Web/QC não mudou.
r23 não foi alterado e antecede estas implementações; pacote final pendente.

Próximos requisitos ainda obrigatórios: validar mídia/codec/QC no reserva,
vincular hardware/saídas locais com revisão, restaurar execução efetiva sob
concessão nativa, handoff/retorno/replicação reversa, fencing externo e
homologação entre hosts. API de ensaio/reconciliação não possui botão na UI
nem autorização de promoção nesta etapa. Demais pendências amplas da matriz
permanecem; não concluir o objetivo com estes testes.

## HA-05 — sonda local real e QC da cópia, 04/10 às 17h35

A análise local citada como pendência em HA-04 passou a integrar o ensaio
quando RPLAYOUT_PROBE está configurado no reserva persistente. Repetir UUID
continua apenas consultando o relatório. Sem sonda, não se inventa análise.
O arquivo usado é exclusivamente a cópia READY do receptor por SHA; caminhos
do primário nunca são abertos pela sonda. Mídia e executável são conferidos
antes/depois por identidade/tamanho/mtime/ctime e SHA; mudanças de sequência,
shutdown ou alteração/restauração dos mesmos bytes recusam o trabalho.

A sonda Rust agora conta buffers raw não vazios na primeira trilha de vídeo
e áudio decodificadas, incluindo BUFFER_LIST. Não basta receber ok/caps. Os
campos são adicionais e não mudam o contrato de ingestão existente. A sonda
local roda serialmente/priority LOW, sem shell, sem thumbnail, sem credenciais
RPlayout do servidor e com limite de resposta de 1 MiB/15 minutos por arquivo.
Falha, saída inválida, timeout ou cancelamento não retornam stderr/caminhos
privados para a API; a conclusão aguarda close do filho próprio.

O perfil técnico é avaliado com codec, geometria, razão de FPS, varredura,
áudio, duração e loudness locais. Não reaproveita probe/R128 do primário para
passar a análise, nem preenche loudness/pico ausentes com números fictícios.
localValidation informa runtimeHash, required, decoded, technicalBlocked e
PASSED/FAILED. localProbeRequired=false quer dizer que todos os arquivos
comprovaram decodificação; pode coexistir com FAILED por conflito técnico.
qcBlocked é a união por edição/hash de bloqueio técnico e falta de decisão
QC explícita. Decodificar não aprova: APPROVED legado permanece PENDING.

Banco isolado conserva publicações exatas, contas/saídas/comandos ausentes,
canal arquivado e cursor parado. Metadados locais ficam em media_assets e
evidência completa cifrada por SHA em ha_recovery_media; payload publicado
não é reescrito. O marcador continua impedindo runtime após desarquivar.
Preservar o cofre é necessário para ler os resultados. A descoberta de
outras trilhas não prova decodificação ou loudness individual delas; mixes,
trims e níveis operacionais continuam separados desta análise de arquivo.

Testes dirigidos iniciais: 54 PASS. Após proteção contra alteração com SHA
restaurado, suíte integral **160 arquivos/1303 testes**, 161,07s, PASS;
typecheck workspace, build servidor, diff check e cargo test da sonda
(11 testes) PASS. Uma primeira execução do teste de link de arquivo recebeu
EPERM no Windows; passou depois de usar junction de diretório controlado
para testar recusa de destino vinculado, sem requerer elevação. Esse erro
não foi contado como teste aprovado. Ruflo/ToolSearch indisponíveis ([]),
sem substituição/instalação nem delegação.

Ensaio inicial antes da proteção de timestamps: lScHQL, portas
55672/55673/55674, PASS, estéreo e R128. Não atribuir a esse primeiro ensaio
a proteção acrescentada depois. Build atual:
server.cjs SHA **6C56B13BEA8D2CECFAD7955396C2E5451285F50FF7731324BADB4628496A7E1B**;
probe.exe SHA **FAF1099CF73C802603190BF687244F917767B619BB8DBFEC38E3AC999DB61DF0**.
Dois novos ensaios integrados dessa build passaram:

- llCguk, portas 55886/55887/55888: servidores compilados e testemunha
  independentes, PGM nativo/null no primário, retomada aos 262144 bytes,
  mídia SHA ede3ed5ab2bbb94018d46f77328a234c43d3c6e1a6f75b3c46f3ef693ccbfb8f.
  Ensaio seq 10/4a87efb2-1476-4dc4-a974-fc7a7ca0e946, recovery-c3PqdP:
  H.264 320x180 progressivo/25:1, 1800 buffers de vídeo e 3376 de áudio,
  estéreo/48000 Hz, R128 -26,7135 LUFS e -25,0996 dBTP. Perfil de teste
  explícito aceita -40 a -15 LUFS; não é aprovação broadcast automática.
  PASSED técnico, decoded=1, technicalBlocked=0, qcBlocked=1/PENDING.
- oSRON4, portas 55889/55890/55891: VT sem áudio, política de canal alterada
  apenas na fixture própria após publicação e chegada ao espelho confirmada.
  SHA 9b2c82bacae9a6fc423b7014469fa64fdb0535649a7dba9bdfacbf59c108fe81.
  Seq 11/698ce829-2101-4bed-8b96-ba66669ea515, recovery-VHLPTk:
  decoded=1/localProbeRequired=false, mas FAILED técnico/technicalBlocked=1
  por áudio obrigatório ausente. Nenhuma aprovação ou PGM no reserva.

Ambos preservaram publicação PUBLICADO (não rascunho), cursor parado,
cofres/bancos/seq próprios, replay somente consulta, reconciliação de criador
de domínio vivo/morto e restart. Criadores próprios 3456/10212 foram
encerrados/reconciliados; todos os processos/listeners de fixture terminaram.
Não é promoção efetiva, perda de host físico, saída externa ou teste visual.

QA 4041: backup preservado por SQLite API/integrity/FK,
pre-ha-local-probe-86279ab0-7e63-4bfe-9470-8eeb6c31acd6.db. Revalidados
SIMULATED/STOP/CUE vazio antes de substituir PID próprio 10844 por 19552
(session 95419). Mesmo banco/cofre/pastas e 14 itens/revisão 25494162001883,
13 itens/revisão 1744. Health engines/nativeEngines=0, simulatedChannels=2;
engine/MediaMTX/dispositivos/HA desativados. Web não mudou: QC já contém
Ver em qualidade/Voltar ao preview leve, apenas para arquivo; não atribuir
HQ de live nem validação de navegador a HTTP/compilação. r23 foi preservado
sem alteração; antecede essas funcionalidades e não é pacote final.

Próximas etapas obrigatórias: prova de trims/mixes/fontes live no reserva,
vínculos revisados de hardware/saídas locais, recuperação executável sob
concessão nativa, handoff/replicação reversa/rejoin/failback e fencing externo.
Separação do banco operacional, todos os formatos, soak, pacote final e
homologação física/visual continuam na matriz; objetivo amplo permanece ativo.

## UI-04 — inspeção de live antes do preview reduzido, 04/10 às 19h32

O pedido Ver em qualidade agora inclui fontes live. O pipeline de PVW abre
um tee depois do deinterlace, antes do crop/escala/cadência do monitor. O
ramo de inspeção conserva o raster real; fila leaky de dois buffers, valve
fechado por padrão e sink sem espera impedem que encoder/rede bloqueiem o
decoder. Não há outra abertura de DeckLink/NDI/OMT nem LOAD/TAKE por qualidade.
Áudio da inspeção usa o mesmo barramento de áudio selecionado do PVW.

O consumidor QC é independente/on-demand, H.264/Opus, progressivo. Ao ativar,
caps negociadas determinam geometria/PAR/cadência, até 4K/60 e 6–50 Mbps.
Não deriva resolução da grade: fonte 720p em canal 360p mantém 720p no QC.
É representação codificada de inspeção, não original sem perdas, monitor de
referência, certificação de cor ou loudness. Fonte acima dos limites é reduzida
com aviso explícito; fonte menor não é ampliada por causa do canal. Formato
desconhecido e ausência de quadro recente recusam ativação. Encoder aguarda
buffer real no ramo raw antes de publicar e expira com deadline monotônico
nativo após 15s sem renovação, mesmo sem timeout do backend.

POST /api/channels/:id/qc/inspection recebe somente viewerId UUID, sourceRef
e watching. URI cifrada é resolvida na fronteira privada. Autoridade normal
de sessão/canal/estação/origem continua necessária e é revalidada dentro
das filas de QC e engine. Leases são por sessão/viewer/fonte, limitadas a 16,
sem segredos no registro HTTP. Uma janela não revoga a outra. CUE de outra
fonte fecha o ramo antigo e não herda qualidade; requisição atrasada é recusada.
Heartbeat a cada 5s, off na saída e deadline nativo limitam recurso órfão.
ACK é ativação aceita, não confirmação de playback WHEP no navegador.

UI mantém preview leve por padrão, botão de retorno/tela cheia e escuta
explícita. SOURCE e PVW_READY da seleção são necessários: PGM pronto não
autoriza mostrar outra entrada como QC. Cada ativação tem identidade nova;
resposta anterior não monta player da nova ativação. Scopes/áudio são limpos
quando seleção/rendição/player/prontidão mudam. Falha não exibe proxy como
qualidade. Safe area permanece desligada por padrão.

Suíte integral: 163 arquivos/1332 testes PASS, 57,07s às 19h27m55; tipos,
build servidor/web e diff check PASS. Engine: 72 testes PASS, um loopback
OMT ignorado (não contabilizado como prova OMT nesta rodada), 67,78s.
Novo teste nativo mostrou deadline fechando valve/publicador sem callback
do servidor; três testes de caps cobrem raster/fração FPS/limites/recusa.

Ensaio compilado inicial icRNcE, HTTP 63871: PGM nativo/null, entrada local
RTSP via MediaMTX, H.264 + áudio do emissor; inspeção decodificada H.264/Opus
1280×720 contra preview 428×240. Antes de aceitar prova foram corrigidos:
captura do IDR preto inicial; latência do mux da fixture, que às vezes só
declarava áudio; padrão de 1 pixel eliminado pelo 4:2:0; e métrica de contraste
global, que aceitava aliasing. Fixture final usa xadrez de 2 pixels/I420,
decodifica 50 quadros e mede bordas horizontais, não só tamanho do JPEG.
Essas tentativas iniciais falharam e não foram contadas como PASS.

Após seguir caps da fonte: YDoso1, HTTP 64249, PASS. Canal 640×360, input/HQ
1280×720, preview 428×240. Detalhe horizontal 59,5020 contra 40,3503 no raster
menor (ampliar o menor não recupera bordas); áudio Opus real decodificado,
RMS 0,02366. PGM live permaneceu ativo; duas conexões de input (PGM/PVW)
antes/depois do HQ, sem terceira. Fechar um viewer preservou o outro, fonte
errada recusada, última janela encerrou encoder e ausência de heartbeat
expirou. Processo/folders/bancos do ensaio isolados; filhos/listeners próprios
encerrados. Não foi reprodução de navegador, hardware físico ou teste 4K live.

Backend SHA 8EA8F56C3DEF30BC04BCF28A026EE6A4A9F7B1D4F85B5C39DF7713AE2E1D1EAB;
engine SHA 5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009.
Web final index-B6zPtRcP.js/index-BBx7O8R5.css; aviso de chunk grande continua.
QA foi recuperado em 18h44, PID 14372, com backend anterior. Mesmo banco,
cofre e pastas; canais SIMULATED, STOP/CUE vazio; 14 itens/revisão
25494162001883 e 13/revisão 1744. Backup direto por API SQLite
pre-qc-live-quality-2e414306-839e-4ecc-afbe-73aae2b26926.db passou integrity/FK,
sem retenção/deleção. A tentativa de substituir esse processo pelo backend
novo foi bloqueada pela política do ambiente antes da execução; PID 14372
continua respondendo, não se contornou o bloqueio. Não atribuir endpoint QC
novo ao QA antigo. Ruflo/ToolSearch não expostos ([]); sem delegação.

Objetivo integral permanece ativo. Pendentes nesta área: WHEP/escuta visual
no navegador, calibração de cor/scopes, emissor 4K/live e hardware externo;
demais requisitos incluem promoção efetiva HA/failback/hosts, banco separado,
guardas remanescentes, soak e pacote portátil final. r23 permanece imutável
e anterior às alterações. UI-03 registra qualidade de arquivos; UI-04 é a
evolução live, não reinterpretação dos ensaios anteriores como live homologado.

## SEC-20 — decisão QC e perfil conferidos, 04/10 às 20h03

O turno anterior consultou status sem alterar estado (no progress); a
continuação revalidou worktree/QA e implementou a próxima guarda disponível.
Ruflo/ToolSearch não expostos ([]); sem instalação alternativa ou delegação.

Antes, POST de QC conferia apenas hash e metadados atuais: duas avaliações
do mesmo arquivo podiam sobrescrever o estado uma da outra. A auditoria
detalhada era inserida depois do commit. PUT de perfil também não exigia
a revisão que o supervisor abriu, e gravava sua auditoria separadamente.
PATCH de ignored/status global permitia neutralizar uma avaliação nova sem
prova da conferência original. Essas rotas agora possuem precondições.

Migração 23 cria qc_review_versions com CHECK de inteiro seguro e seis
triggers (mídia/decisão × insert/update/delete). Todo UPDATE de mídia,
inclusive ingestão/loudness, invalida a conferência conservadoramente.
Decisões de outros canais também invalidam a revisão daquele arquivo;
esta é uma recusa conservadora, não mudança do estado QC desses canais.
Tombstones sem FK sobrevivem à remoção/reinserção/ABA. Migração de 22
preserva registros existentes com baseline novo, sem contagem histórica
inventada; reabertura não repete a migração. Startup e restore recusam
tabela/trigger/counter ausente, alterado ou inválido, sem autorreparo.

GET /api/assets/:id/qc retorna snapshot privado/no-store com hash, checks,
perfil, decisões aplicáveis do canal e globais por ordem de inserção, e
review com revisões monotônicas de arquivo e configuração. ETag de decisão
vincula arquivo/canal; global usa ETag do arquivo. Lista do acervo entrega
qcRevision junto com mídia/estado no mesmo snapshot. GET qc-profile fornece
revisão e ETag do canal. PATCH global, POST QC e PUT perfil conferem provas
originais no commit imediato: 428 sem header, 400 malformado/outro alvo,
409 superado, inclusive hash/perfil restaurados aos mesmos valores.
Hash do corpo continua obrigatório e não substitui a revisão.

Sessão, identidade, papel, canal/estação e arquivo do canal são reconferidos
no commit. Uma conta restrita pode decidir no seu canal, mas não alterar
quarentena compartilhada. Perfil exige OUTPUT_CONTROL. QC não chama
reconfiguração do engine, CUE ou TAKE. Mídia/decisão/perfil e auditoria
detalhada são atômicos; counter editorial também reverte em falha SQL.
Falha posterior na atualização da visão retorna commit realizado com aviso,
não rollback fictício. API_MUTATION continua auditoria HTTP complementar.

UI usa prova da conferência, não leitura automática antes de autorizar
um rascunho. Perfil captura baseline próprio ao abrir seu editor; uma
consulta/decisão posterior não troca esse baseline silenciosamente. Ressalva
e perfil editados são preservados na recusa, bloqueando repetição até
Reabrir conferência (confirma descarte). Trocar arquivo/canal invalida a
prova; resposta anterior não aplica feedback à seleção nova. Ações por
linha primeiro selecionam para conferir, não aprovam arquivo não conferido.
Aprovar/Rejeitar padrão ficam indisponíveis enquanto há ressalva/perfil em
edição ou outra ação pendente. Quarentena global é identificada como tal.
Falha de rejeição deixou de ser sobrescrita pelo falso aviso de sucesso.
Compilação/SSR não provam interação de navegador; isso permanece pendente.

41 testes novos: seis de DB (ABA, writers, rollback/overflow, migração,
restart, backup/adulteração), 22 de HTTP (oito formatos de revisão, snapshot,
concorrência, perfil, global, três rollbacks, refresh e quatro revogações de
acesso), 13 de cliente/revisão. Primeira suíte integral encontrou só a
expectativa legada de 22 migrações no teste de checkpoint; atualizada para
23 e repetida. A primeira prova de cache privado do QC falhou por header
ausente; as consultas de conferência/perfil passaram a defini-lo explicitamente.
Tentativas com falha não foram contabilizadas como PASS.

scripts/verify-qc-reviews.mts passou em hnJK7a, HTTP 50889/50890; servidores
compilados próprios PIDs 1572 e 4320→20868→17512. Mesmo snapshot entre
processos, um vencedor entre approve/block, revisão superada após restart,
ABA de hash, alteração de perfil invalidando decisão, global invalidando
canal e histórico incluindo @all passaram. Três triggers deliberados de
falha de auditoria reverteram dados/decisões/todos os contadores. Backup
validou integrity/FK/contrato 23 e revisão persistiu no restart. Processos
e listeners próprios encerrados; verificação Windows posterior encontrou
somente o QA 14372 entre os PIDs conferidos.

A fixture usa metadados técnicos sem sonda/decoder e placeholder local
explícito para disponibilidade, não vídeo real. Não é prova de aprovação
física, transmissão, browser ou HA; dois processos usam SQLite compartilhado.
Primeira execução parou por alias de protocolo não resolvido fora do app;
segunda por cofre da fixture não isolado; terceira por reconciliação correta
de caminho inexistente. Import relativo, cofre próprio e placeholder de
disponibilidade corrigiram o verificador, não retiraram guardas do produto.

Integral final: 166 arquivos/1373 testes PASS, 62,60s às 19h58m57; typecheck
workspace, build servidor/web e diff check PASS. Backend SHA
290425D74E37B48054FDC3DA1B2AF4050BE6A2F9E0806737C728DD694ECE4177;
web index-ohG5_16B.js/index-BBx7O8R5.css (aviso de chunk ~925 kB permanece).
Engine não mudou nesta etapa: SHA
5D0AA072260AECBCFA84473CAAE69FA9E88C4C04CA9741E0F270EEAB4016E009;
72 PASS/1 OMT ignorado pertence à rodada UI-04 anterior, não novo teste nativo.

QA 4041 preservado: health 23h00m11Z, PID 14372 desde 18h43m57, canais
SIMULATED, engines/nativeEngines=0, MediaMTX disabled. Não houve nova
tentativa de contornar o bloqueio da atualização desse processo. Backend
em memória é anterior; não atribuir as novas guardas ao QA. Releases
r21/r22/r23 não foram alteradas; pacote final não produzido.

Objetivo integral continua ativo: guardas de projetos e acervo fora das
decisões QC; banco operacional separado; promoção HA executável, vínculos
locais/handoff/rejoin/failback/fencing externo; prova de mixes/trims/live
no reserva; formatos, soak/falhas, navegador e DeckLink/NDI/OMT físicos;
pacote portátil final em Windows limpo. Esta etapa não substitui nenhum
desses requisitos nem declara publicação 100% validada.

### Pausa após QC — 04/10/2026, 20h12 BRT

Operador solicitou fechar esta etapa e guardar pendências para continuação.
Retirado somente o scaffold incompleto de revisão de projetos iniciado após
SEC-20 (dois arquivos novos e referências); nenhuma migração 24 foi aplicada.
Domínio de projetos e alterações anteriores preservados. Diagnóstico e proposta
de proteção estão no arquivo de continuação, não declarados como implementados.

Após essa retirada: typecheck PASS, 6 arquivos/56 testes PASS às 20h12m24
(5,99s), diff --check PASS. Suite completa 166/1373 e build permanecem evidências
da SEC-20 anterior, não novas execuções nesta pausa. Hashes do servidor compilado
e engine preservados. QA4041 e releases não foram atualizados/reiniciados.
Objetivo fica pausado por solicitação do operador, com escopo restante intacto.

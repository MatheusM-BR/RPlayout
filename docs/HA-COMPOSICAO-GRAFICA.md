# Composição gráfica na promoção HA — NOT_RUN

Continuação: projeção read-only do diário HA_SECONDARY para snapshot e consulta
do SecondaryEventLedger normal após restart. Mantém UUID/ocorrência/edição/
decoder e cronologia, valida intenção/envio/composição SHA antes de EXECUTED.
ACCEPTED/SENDING/UNCERTAIN continuam FIRING; SUPERSEDED é FAILED (sem HIDE),
não execução física. Consulta normal fireFor/execute reconhece essas fases,
sem duplicar linhas e sem FIRE/DISMISS para fabricar histórico. FIRING HA
bloqueia comandos gráficos normais. Não existe reconhecimento automático de
incerteza; reconciliação explícita ainda necessária. Fixtures NOT_RUN.

Continuação: dispatch gráfico FUTURO ligado ao compositor/maintenance, apenas
na ocorrência e decoder retomados. UUID de execução local novo; recibos próprios
HA_SECONDARY_ACCEPTED/SENDING/CONFIRMED/REJECTED/UNCERTAIN, sem importar fases
estrangeiras. Seleção de template/mix permanece da edição derivada congelada.
Seed suprime passado; hasDue evita I/O no cadence sem trabalho. FIRE/DISMISS
executam sequencialmente e nova camada ganha dono local; descarte de camada
substituída recebe SUPERSEDED sem HIDE. Equipamento/SCTE continuam recusados sem
vínculo local explícito. Emergência dominante não é substituída automaticamente.
Fases incertas fecham o transporte próprio, não são repetidas. Esta etapa só
acompanha a ocorrência retomada: novos itens/edições exigem admissão operacional
completa, ainda faltante. Fixtures de scheduler NOT_RUN, sem testes/build.

Continuação 10/10: handle mantém o compositor preparado vivo e oferece início
de manutenção somente após saídas nativas liberadas, ligado pelo orquestrador
antes de CONFIRMED. Cadência 250 ms sem consultas/SHA quando nada expirou;
uma operação por vez, novos recibos locais de expiração e mesma geração/termo.
Prazos absolutos não se renovam. Overlay de emergência continua dominante;
não é removido pela expiração de uma camada que estava sob ele.
Falha de posse/ACK/storage interrompe a cadência e fecha apenas o transporte
próprio, sem replay/restart. Stop do decoder cancela/aguarda trabalho gráfico
antes de liberar reserva. Fixtures de ciclo de vida NOT_RUN adicionados.
Isso não reconcilia donos de eventos nem completa operação/as-run/Preview.

Implementação posterior à R55, sem testes/build/homologação física nesta etapa.

O snapshot passa a carregar `configuration.graphicRecovery`: composição ligada
ao recibo nativo confirmado do checkpoint, composição comprovadamente vazia ou
bloqueio com motivo. Comando gráfico/evento secundário inconclusivo bloqueia a
captura de display executável. Ausência de runtime/vínculo não vira tela limpa.

Candidato lê composição somente da origem autenticada da preparação. Ponte
confere recibo original, recusa recursos externos e retira donos de eventos
estrangeiros. Expiração absoluta permanece; não concede novo tempo de exibição.
Espelhos legados sem dados ficam UNVERIFIED, não autorizam preparação gráfica.

Factory cercada expõe `prepareGraphics`, deduplicado inclusive em falha, chamado
antes de `resumeProgram`. Usa compositor existente e ACK do transporte da mesma
geração retida. Registra novo UUID local ACCEPTED/SENDING/CONFIRMED ou
REJECTED/UNCERTAIN e SHA da composição realmente preparada na cópia admitida;
não importa recibo/as-run, não grava checkpoint de PGM e não libera saídas.

ACK nativo não homologa aparência/SDI. Adaptador padrão ainda null. Permanecem:
composição fiel por imagem/mix, homologação da manutenção após ativação,
reconciliação de eventos sob donos locais, operação durável e Preview posterior.
Os novos fixtures cobrem apenas tradução/recusa do display e estão NOT_RUN.

# Restaurar um backup sem substituir a instalação

No pacote atualizado, execute `restore-rplayout-backup.ps1` na máquina do
servidor. A ferramenta usa o Node e SQLite embutidos: não precisa instalar
Node, pnpm, TypeScript ou módulos adicionais. Informe:

1. O arquivo `.db` de backup.
2. Uma pasta nova de destino que ainda não exista. Não use a pasta da instalação.
3. O `vault.json` original da instalação que criou o backup.

A ferramenta confere banco, referências, revisões e cofre; cria uma cópia nova
`service.db`, copia o cofre com proteção de acesso e registra
`restore-quarantine.json`. Não altera o backup, não substitui arquivos existentes
e não inicia servidor, reprodução ou envio externo. Se falhar após criar a pasta,
a cópia parcial permanece para diagnóstico: não inicie essa cópia. Um novo pedido
deve usar outro destino; não existe opção para forçar sobrescrita.

O resultado `QUARANTINED` significa recuperação para conferência, não autorização
para colocar o canal no ar. Não apague `ha_recovery_origin` para forçar promoção.
Na cópia restaurada, tarefas de arquivo/proxy, medição, scanner e automações
não retomam seus pedidos importados. Alterações pela API são recusadas; consultas,
autenticação e criação explícita de backup continuam disponíveis com as permissões
normais. Comandos recusados permanecem auditados. Isso não significa banco
inteiramente somente-leitura: migrações, inicialização e saúde continuam aplicáveis.
O relatório informa cursores salvos/reproduzindo, edições publicadas/ativas e
registros de exibição/abertos. Esses dados são preservados: um cursor antigo em
reprodução não vira automaticamente parado, nem um registro aberto ganha um fim
inventado. `executionResumeAllowed: false` permanece explícito. As contagens
não provam sinal, aprovação de mídia ou encerramento do servidor anterior.
O bloqueio protege a partida de uma cópia importada; não desfaz trabalho já
iniciado antes de um marcador colocado durante uma execução.
As definições, filas e referências originais permanecem no banco; isso não prova
que os processos anteriores pararam nem que saídas físicas estão disponíveis.

O backup SQLite **não contém os arquivos de mídia ou a chave do cofre**. Os
caminhos originais da mídia são preservados; mantenha os arquivos e o acesso
correspondente. Não se faz remapeamento automático de disco/rede. Aprovação de
QC, edições publicadas, cursor/as-run, jobs interrompidos e retomada de transmissão
ainda exigem conferência e política operacional próprias.

O cofre Windows vincula-se à conta Windows original. Para outra conta/máquina,
é necessária a chave compartilhada `RPLAYOUT_VAULT_KEY` configurada e preservada
previamente, em base64 de32 bytes; não é possível inventá-la depois da perda da
chave original. No modo compartilhado, a chave vem somente do ambiente seguro,
nunca de argumento de linha de comando nem do relatório. O destino não recebe
uma nova chave: precisará do mesmo ambiente para ser aberto. Não informe
`--vault-file` simultaneamente ao modo compartilhado.

Uso pela equipe técnica, com os binários do pacote:

```powershell
& .\runtime\node\node.exe .\apps\server\dist\restore-backup.cjs --backup 'C:\Cópias\rplayout.db' --destination 'C:\Recuperação\conferencia-nova' --vault-file 'C:\Instalação-original\vault.json'
```

Esta ferramenta entra nos próximos pacotes. A parcial r27 é anterior a ela.
A validação em Windows limpo, a interface visual de recuperação e o fluxo de
promoção/retomada física não estão homologados por este comando.

O modo de chave compartilhada foi exercitado com os compilados em processos
e pastas isolados na mesma máquina/conta Windows: restauração e abertura com
chave correta, recusa de chave ausente/incorreta, sem fabricar `vault.json`.
Isso não homologa outra máquina/conta nem converte automaticamente um cofre
DPAPI existente para chave compartilhada. Evidência registrada em
`scratch/group09-backup-shared-key-20261009.json`.
# Identidade do restauro — atualização de 09/10/2026

## Preparação offline da operação

### Admissão do servidor mantendo a reserva

O servidor atual também aceita `--stage-restored` seguido do caminho do
manifesto protegido. Use o Node e as configurações de banco/cofre do pacote.
Essa opção confere a preparação e abre o backend completo ainda em quarentena,
mantendo a reserva de armazenamento e o mesmo controle nativo do computador.
Um segundo servidor é recusado enquanto a reserva estiver retida. Registro da
instância e auditoria da admissão são gravados juntos.

Isso ainda não é ativação de PGM: os bloqueios de execução e publicação
continuam presentes. Encerramento normal fecha a instância e libera a reserva;
uma queda pode deixá-la protegida. Não apague o marcador, não force o registro
para OPEN e não use tempo/PID isolado como autorização de retomada.

O próximo pacote inclui `apps/server/dist/review-restored.cjs`. Execute com o
Node do próprio pacote, informando `--database`, `--manifest` e, quando usado,
`--vault-file`. Cache local opcional: `--cache`. Chave compartilhada continua
somente no ambiente, não pode ser combinada com `--vault-file`.

É necessário encerrar os servidores que usam o banco e liberar os recursos
nativos anteriores. O comando reserva o armazenamento e o controle nativo do
computador durante a revisão; não usa modo simulado se o auxiliar estiver
ausente. Confere procedência, posse anterior, publicação/cursor/cortes, QC por
canal e SHA dos arquivos de partida. Não altera históricos nem remove
quarentena. Versões legadas sem posse/corte verificável podem ser recusadas.

Resultado `REVIEWED_NOT_ACTIVATED` significa apenas preparação conferida naquele
momento. A reserva é liberada ao terminar: o resultado não é autorização para
ativar posteriormente ou apagar o marcador. A ativação com retomada real do
engine e confirmação de sinal ao vivo ainda está em implementação.

A ferramenta atual registra um recibo assinado e imutável dentro do banco,
correspondente ao relatório protegido `restore-quarantine.json`. Uma segunda
restauração preserva o histórico e recebe uma identidade nova: o relatório
anterior não serve para identificar o novo restauro. Bancos restaurados por
versões anteriores, sem recibo, não recebem procedência inventada na abertura.

Essa identificação não libera PGM: ativação operacional, posse nativa, validação
de mídia/QC e retomada continuam etapas separadas e ainda em implementação.
O instalador parcial r27 é anterior a esse mecanismo.

### Ativação explícita integrada na r28 — ainda não homologada

O servidor compilado aceita `--activate-restored MANIFESTO`, com as mesmas
configurações explícitas de banco e cofre. Mantém a reserva de armazenamento
e o controle nativo durante a revisão e a inicialização. O diário assinado
registra STARTING, CONFIRMED ou FAILED; CONFIRMED só é gravado após confirmação
do engine dos canais exigidos. A origem é arquivada com a auditoria na mesma
transação, preservando o histórico. Não é promoção automática nem homologação
de saída física. Falha ou perda da reserva preserva proteção/inconclusão.

O PGM nativo pausado/congelado ainda é recusado, preservando o cursor. Retomada
nativa em reprodução e entradas ao vivo requerem a validação posterior.
A r28 é gerada sem novos testes funcionais antes do empacotamento, por pedido
do operador. Não editar o banco para simular CONFIRMED ou liberar uma reserva.

Validação posterior de09/10: backup capturado durante PGM nativo e retomada
compilada foram conferidos com vídeo/áudio sintéticos e saída nula. Corte,
posição, edição, identidade de execução, barramento de áudio e as-run foram
preservados; novo dono e ativação confirmados por registros assinados.
Isso não homologa instalação limpa, sinal físico, entrada live, PGM pausado
nem recuperação de reserva interrompida. Evidência:
scratch/group09-restored-playing-activation-20261009.json.

### Reserva preservada após queda: liberação explícita

Atualização da retomada live: a ativação exige vídeo recente no PGM da fonte
exata; ACK ou sinal do PVW não comprovam retorno ao ar. A identidade da execução
fica preservada até chegar a confirmação real do PGM, inclusive quando o ACK
chega antes do primeiro quadro. EnsaioRSgpBk verificou vídeo/áudio recentes e
as-run com uma URI sintética tratada como LIVE; não homologa NDI/OMT/SDI reais.
Essa correção é posterior à r28, que permanece imutável.

O ensaio posterior pakt0d verificou a recusa de ativação com endpoint sintético
entregando áudio real mas zero vídeo: não houve admissão HTTP operacional,
o diário registrou FAILED e cursor, as-run anterior, edição, recibo e origem
da quarentena foram preservados. A reserva própria foi liberada ao encerrar.
Isso não equivale a homologar perda de sinal de NDI/OMT/DeckLink físicos.

A próxima build inclui `apps/server/dist/recover-restored-reservation.cjs`.
Execute com o Node embutido, informando `--database`, `--manifest` e, quando
usado, `--vault-file`. Não exige pnpm/tsx/tsc. A r28 ainda não inclui esse
comando novo; não substitua seus binários manualmente.

O comando exige o manifesto autenticado correspondente ao banco, controle
nativo exclusivo do computador e confirmação local de encerramento do dono,
dos servidores e dos recursos anteriores. Dono remoto, PID reutilizado/vivo,
permissão negada ou processo sem confirmação de abertura continuam bloqueados.
Não há liberação por idade da reserva. Liberação e auditoria ocorrem juntas;
ativação interrompida autenticada pode ser marcada FAILED, nunca CONFIRMED.

`RESERVATION_RELEASED_NOT_ACTIVATED` não inicia engine nem libera PGM. Cursor,
origem, edições, posse e as-run anteriores ficam preservados. Depois ainda é
necessária a partida apropriada ao estado: banco em quarentena exige revisão
e ativação explícitas. Não apague o marcador nem force OPEN manualmente.

Ensaio compilado26505/VGeZHU verificou queda de backend em quarentena,
recusa enquanto vivo, reserva durável, liberação auditada e nova admissão.
Não verifica sinal físico ou queda exatamente durante STARTING; esse caminho
tem testes unitários de identidade e reversão, com prova nativa substituída.


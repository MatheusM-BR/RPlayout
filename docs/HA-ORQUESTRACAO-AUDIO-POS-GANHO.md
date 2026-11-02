# Orquestração da revisão isolada pós-ganho

11/10 — implementação em fonte, NOT_RUN. Sem testes/compilação/build; fora R55.

Store/Replication/API agora ligam início e consulta ao diário pós-ganho. POST
/api/ha/returns/postgain-review aceita somente UUID da revisão, UUID da cópia e
canal. GET consulta o mesmo UUID sem reenfileirar. Quarentena, acesso admin/canal,
TRANSPORT, ator estável, auditoria e no-store aplicados; paths/recibos privados
não entram na resposta. Pedido existente, inclusive falho/interrompido, não
inicia outro runner. Interface e recuperação desse novo tipo ainda pendentes.

Exige cópia própria STAGED, MAC pre-gain e SHA da origem correspondentes,
decisão AUTO própria registrada se adotada. Ganho não pode vir do navegador.
Perfil capturado do snapshot local exige canal único/id igual e valores
explícitos targetLufs/ceilingDbtp/bus/cadência; não usa padrão estrangeiro.
Plano recomposto do original/revisão/decisão registrada. Cópia selada é
reconferida sem abrir/migrar o SQLite: bytes/SHA/stamp, single link, sem junções
ou sidecars, tamanho/cofre/diário. Stamp entre fronteiras deve permanecer igual.

Preparação de evidência executa na fila existente antes da fila de medição,
sem aninhar a mesma fila. Reserva é conferida na chegada e dentro da fila;
intenção persistida antes do runner pós-ganho. Sessão/owner/abort/cópia/perfil/
decisão/plano/acervo/QC/runtime e bytes são reconferidos antes/depois; mudança
não recebe confirmação. Perda de autorização/posse preserva intenção incerta
para encerramento explícito, não adota nem repete automaticamente.

Ainda não é qualificação de publicação. Medição estéreo isolada com reset e
cauda não descarregada permanece sem aprovação editorial/QC/bus/transições/
A-V/PGM. Falhas e bloqueios são contados, não removidos como aprovação. Restam
UI, listagem/recuperação, política técnica, contrato de contingência/live,
barramento/transições/cauda/A-V e integração com engine/saídas/autoridade/
retorno real/rejoin e homologação física.

Fixtures de captura local preparadas NOT_RUN: canal ausente/duplicado, identidade
estrangeira, ausência de parâmetro obrigatório. Nenhuma rota/helper executado.

Totais: 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes). 8.5/8.6 em andamento.

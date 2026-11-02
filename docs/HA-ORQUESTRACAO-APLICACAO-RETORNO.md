# Retorno HA — aplicação de entradas locais conectada à página

11/10/2026: implementação em lote, NOT_RUN; fora do pacote R55.

Fluxo: seleção → candidato STAGED → plano local registrado → aplicação explícita
→ nova cópia bound.db STAGED. Store/Replication/API/UI agora ligados ao construtor.
O resultado não significa execução, QC aprovado, saída configurada ou autoridade.

Diário cifrado `ha_return_applications`: ACCEPTED/APPLYING/STAGED/FAILED. UUID
correlaciona intenção; repetição só consulta. Uma tentativa por candidato/plano;
falhas/partiais permanecem reservados. Reserva 256 MiB antes de criar diretório/
arquivo, com espaço real conferido. Não sobrescreve nem apaga originais.

Origem privada própria, seleção/recebimento/candidato, plano atual, inventário e
configuração local reconferidos. SHA/tamanho/identidade/cofre/sidecars fonte e
destino verificados antes/depois do worker e STAGED só após saída limpa. Fila,
cancelamento e drenagem são do mesmo Store. Planos de outro candidato, antigos
sem identidade ou desatualizados não são executados como aplicação válida.

Durante SHA por blocos, a verificação leve mantém sessão/posse/cancelamento;
configuração completa e plano são reconferidos nas fronteiras de criação e antes
da confirmação final, não recapturados a cada 256 KiB. Mudança impede STAGED.
Essa otimização de implementação não foi medida ou validada por testes.

GET/POST `/api/ha/returns/application`: consulta por UUID/canal; criação somente
IDs de aplicação/candidato/plano/canal. Admin autorizado; escrita TRANSPORT e
sessão estável. Sem cache, auditoria de canal, apenas principal persistente próprio.
Nenhum caminho/endpoint privado via API. Canal arquivado, cursor vazio/parado.

Página guarda IDs antes de enviar, não repete automaticamente e mantém consulta
da aplicação antiga se houver novo plano. Plano desatualizado bloqueia criação,
não a consulta histórica. Encerrar consulta antiga requer resultado terminal e
plano diferente; não permite refazer tentativa do mesmo plano nem adotar outra
instância. Pedidos interrompidos/nunca registrados ainda precisam recuperação
explícita, e histórico de aplicações de outra estação precisa visão própria.

STAGED comprova somente a etapa declarada: referências de entradas aplicadas.
Mídias continuam BLOCKED; outputsApplied/mediaValidated/nativePrepared/
authorityTransferred/publicationAuthorized são false. Ainda faltam arquivos
locais/QC/decode/mixes/trims/grafismos/automação, configuração e decisões atuais
do principal/KEEP_PRIMARY/híbrido, autoridade/retorno/rejoin e homologação física.

Fixtures de contrato/diário/quota/posse adicionadas, não executadas. Sem testes
ou build neste lote. Totais 10 grupos (1 concluído/9 abertos), 53 verificações
(5 concluídas/36 em andamento/12 pendentes).

# Retorno HA — vínculos locais associados ao candidato

11/10/2026 — implementação em lote, NOT_RUN; não incluída no pacote R55.

Complemento 11/10 NOT_RUN: planos novos incluem identidade explícita de candidato
e seleção no envelope cifrado. GET aceita `requestId` e retorna `requestPlan`
sanitizado mesmo se substituído por outro plano. Recusa UUID de outro canal/
candidato ou plano legado sem identidade; legado preservado e marcado stale,
nunca associado retroativamente. A página consulta o UUID guardado e pode encerrar
consulta de decisão histórica confirmada, sem remover o diário no servidor.
Ausência de UUID no diário não confirma cancelamento nem autoriza reenvio.

Fluxo conectado: candidato STAGED → leitura privada confirmada → requisitos
sanitizados → descoberta/configuração local → decisão explícita registrada.
Store, Replication, API e página do candidato estão ligados. Isso não significa
que a derivada possui vínculos aplicados: `bindingsResolved`, `operationalReady`
e `publicationAuthorized` permanecem false.

As entradas vêm de todas as edições selecionadas, inclusive inativas preservadas.
Opções locais vêm da descoberta do servidor principal e das fontes habilitadas
no canal. Cada entrada exige uma seleção inequívoca do mesmo protocolo. Descoberta
e cadastro não comprovam primeiro quadro, áudio ou estabilidade.

As saídas exigidas vêm exclusivamente da configuração atual do principal,
incluindo SDI principal. Não se reutilizam saídas/números de placa da reserva.
Cada saída exige destino explícito ou desativação com motivo. Credenciais não
voltam em claro na revisão nem são persistidas no pedido guardado pelo navegador.

Planos são cifrados e imutáveis em `ha_return_binding_plans`, separados dos planos
do espelho. Token cobre candidato/seleção/edições, configuração atual do principal,
inventário descoberto e plano anterior. Alterações invalidam a revisão. UUID de
decisão identifica intenção, não autorização de operação.

API `/api/ha/returns/bindings`: GET confere sem repetir decisão; POST registra.
Exige administrador autorizado no canal; escrita também exige TRANSPORT e mesma
sessão durante o fluxo. Corpo exige canal consistente com candidato e plano.
Respostas não armazenáveis; canal incluído na auditoria. Somente principal
persistente próprio; candidato continua arquivado/parado e marcado como bloqueado.

Página guarda somente IDs antes do POST, bloqueia reenvio automático e oferece
consulta. Consulta pode encerrar a intenção apenas quando o UUID atual é confirmado;
não apaga histórico no servidor. Destino redigido nunca preenche campo de destino.
Histórico supersedido com identidade explícita agora é consultável pelo UUID.
Legados sem identidade e intenções não registradas ainda precisam de recuperação
explícita; não assumir que ausência no plano atual permite repetir.

Próximas etapas: aplicar plano a NOVA derivada isolada com arquivos locais por
hash, QC/decode/mixes/trims/grafismos/automação; revalidar configuração principal,
edições e cursor; KEEP_PRIMARY/híbrido; autoridade e retorno/rejoin; homologação
física/partições/carga. Não há comando TAKE ou abertura de saída neste passo.

Fixtures adicionadas e não executadas: saídas locais vs estrangeiras, seleção
inativa exigindo entrada, separação/cifra/imutabilidade, alteração de configuração/
candidato invalidando plano e recusa de canal local ausente.

Totais: 10 grupos (1 concluído/9 abertos); 53 verificações
(5 concluídas/36 em andamento/12 pendentes).

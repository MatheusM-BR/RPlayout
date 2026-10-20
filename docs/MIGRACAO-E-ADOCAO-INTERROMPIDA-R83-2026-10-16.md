# Migração histórica e adoção interrompida — r83

Avanço em9.3/10.4: dois cenários integrados e suas conferências independentes
passaram. Não houve mudança de código de produto, compilação ou nova build;
r83/engine610E03E8 continuam sendo a edição atual. Não encerrar 10.4: retorno
compatível, conciliação do histórico e demais falhas/combinações permanecem.

## Migração criada por binário histórico, sem remover marcadores

Origem: `C:\IA\RPlayout\release\runtime-base-r30`. Servidor histórico SHA256
`9D8D37BA3EE8142ACF886588C3F923169171D8E555F94D87001BDEDF0F244F26`, conferido
com o manifesto antes de executar. Node do próprio artefato, v24.16.0. Rodou
sem engine, mídia, descoberta ou saídas, criando dados novos no D:. Não foi
alterado o executável histórico, usado o banco de uma instalação operacional
ou convertido um banco atual em antigo apagando versões de migração.

`D:\RPlayout-builds\qa\legacy-schema-sXZyHf\result.json`: PASS.
`assertions-legacy-migration.json` no mesmo diretório: PASS independente.

- O executável r30 criou o schema com45migrações. Depois de parar seu job,
  foram inseridas apenas duas fixtures editoriais públicas (canal e grade,
  com Unicode) por SQL no banco QA. Isso não valida CRUD/API editorial antigo.
- Backup fechado dessa origem restaurado pelas ferramentas compiladas da r83,
  em pasta nova e quarentena autenticada. Revisão antes da migração recusada;
  migrador explícito retornou MIGRATED_NOT_ACTIVATED, schema50 atual.
- Diário cifrado correlaciona STARTED e CONFIRMED com o mesmo ID e restauração;
  os45marcadores anteriores permanecem iguais. Integridade ok, foreign keys
  vazias, canal/grade preservados, cofre copiado com os mesmos bytes e origem
  de quarentena mantida. Reserva assinada terminou OPEN. Zero ativações.
- Comparação independente de todas as65tabelas da origem com seu backup
  confirma mesmos dados e schema. Hash do backup e hash do executável
  histórico permaneceram conferidos. Não é comparação bit a bit dos arquivos
  físicos SQLite, cujos auxiliares WAL/SHM podem mudar em operações de leitura.
- Nova consulta ao migrador na cópia já atual retornou CURRENT_NOT_ACTIVATED,
  sem segundo par de diário. Não foi repetida a migração para alterar status.

Limite importante: origem sem PGM/mídia/jobs legados ativos. A validação de
arquivo nativo em reprodução r80→r83 foi outro cenário, com schema já atual;
as duas provas não viram automaticamente uma homologação de PGM legado migrado.

Tentativa `legacy-schema-yLVMw0`: FAIL preservado. O QA havia omitido do PATH
o PowerShell do próprio Windows, que o executável histórico usa para DPAPI;
parou na criação do cofre. Executável antigo não foi corrigido/alterado. Uma
pasta QA nova recebeu essa dependência real do Windows para a execução válida.
Isso não certifica o contrato minimal-PATH da edição atual usando a antiga.
Antes dessa execução, uma revisão automática de permissão expirou sem iniciar
o processo; repetida uma vez conforme a orientação da ferramenta.

## Interrupção real da adoção e reconciliação explícita

`D:\RPlayout-builds\qa\upgrade-workflow-M6lwbz\result.json`: PASS.
`assertions-interrupted-adoption.json`: PASS independente, com prova adicional
de recusa da reutilização do ID já encerrado.

Foi usada outra restauração nova do backup online original IQkjFO, preservado.
O assistente real start-rplayout-upgrade.ps1 da r83 fez revisão e ACTIVATE com
adoção explícita. Um observador do QA leu a intenção UPGRADE_PROFILE_STARTED
real e encerrou imediatamente apenas seu próprio ChildProcess/job Windows.
Não inseriu/apagou registros, não fabricou fase de diário e não usou taskkill
com PID histórico. A ativação nativa anterior à adoção já era CONFIRMED.

Intenção311ea465-ef76-40df-95ae-261ed0562a81;
ativaçãoe5437294-597a-4524-b8ba-f47288efadcf;
restauração27877584-430e-4d15-be16-c7099a6e1556.

1. Após a interrupção, a intenção permanecia pendente e a reserva MAINTENANCE.
   O guard de partida da cópia recusava esse diário incerto.
2. A reconciliação comum, sem pedir recuperação da reserva, foi recusada;
   intenção e hash do perfil não mudaram. Não houve roubo por timeout.
3. O assistente real reconcile-rplayout-upgrade-profile.ps1 foi executado com
   ID exato, RecoverMaintenance e a frase LIBERAR RESERVA E RECONCILIAR, fornecida
   pelo controlador somente ao prompt previsto do teste.
4. Detentor/predecessor ausentes e exclusão nativa foram conferidos pelo produto;
   liberação da reserva e auditoria RESTORED_RESERVATION_RECOVERED ocorreram
   antes da reconciliação. Assinaturas/procedência foram verificadas depois.
5. O arquivo observado ainda correspondia ao perfil anterior. Resultado
   UPGRADE_PROFILE_REFUSED, OBSERVED_FILE_ONLY e historicalPublicationAckKnown=false:
   registra o estado observado agora, sem afirmar conhecer o ACK perdido.
6. Reserva OPEN, nenhuma adoção pendente, apenas STARTED+REFUSED no diário.
   Perfil não escrito pela reconciliação; checkpoint e as-run idênticos antes
   e depois. Nenhuma nova ativação ou TAKE. Família própria encerrada; perfil
   original do ambiente QA restaurado pelo controlador depois da parada.
7. Reutilizar o mesmo ID com confirmação foi recusado como não pendente; não
   criou terceiro registro nem fez nova troca. Não foi reativado o canal.

Limites: este teste alcançou o ramo **perfil anterior**, não a janela depois
da publicação do candidato; não equivale a corte físico de energia, validação
de filesystem/hardware nem rollback operacional. A restauração do perfil do
ambiente QA pelo controlador não é o recurso de rollback do produto.

## Continuação objetiva de10.4

- Publicação do candidato sem confirmação terminal: reconciliar o ramo de
  candidato observado, preservando o arquivo anterior e o contexto assinado.
- Interrupção real durante migração, outros schemas/dados e estados nativos
  legados; não converter o caso editorial45→50 em prova de todos eles.
- Implementar/qualificar o retorno compatível e a conciliação de as-run/dados
  após atualização. A ferramenta atual compara histórico, mas não entrega
  uma cópia antiga pronta/compatível nem autoriza rollback.
- Manter Windows limpo, contas/máquinas diferentes, sinais externos/hardware,
  licenças e publicação como gates separados. DeckLink adiada, grupo8v3.

Sem limpeza, movimentação do projeto, alteração de firewall, contas, bancos ou
serviços operacionais. Não houve nova distribuição. Totais preservados:
10grupos/53verificações —8concluídas,34em andamento,4pendentes,7v3.

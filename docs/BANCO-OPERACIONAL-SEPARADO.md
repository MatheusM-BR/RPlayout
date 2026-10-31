# Banco operacional em processo separado — integração em revisão

Implementação de lote em 10/10/2026. Não é homologação nem evidência de HA.
Nenhum banco de usuário foi aberto para testar esta alteração.

## Caminho de execução

Backend → bridge em worker → processo Node privado → SQLite/WAL existente.

O processo SQLite recebe apenas IPC herdado do backend; não abre porta de rede.
Uma conexão pertence a uma única instância do backend. Duas instâncias usam
conexões distintas e a exclusão do SQLite, preservando os contratos existentes
de revisões, reservas e auditoria. Isso não é um cluster de banco.

Na execução compilada `.cjs`, PROCESS é o padrão. Desenvolvimento em TypeScript
usa INLINE. `RPLAYOUT_STORAGE_MODE` permite selecionar explicitamente esses dois
modos; valores desconhecidos são recusados. `RPLAYOUT_STORAGE_BIN_DIR` define a
pasta absoluta dos dois auxiliares quando usada uma build externa. Não há retorno
automático para INLINE se PROCESS falhar ou os auxiliares estiverem ausentes.

Arquivos obrigatórios: `storage-service.cjs` e `storage-bridge.cjs`, compilados
pela build do servidor e exigidos pelo empacotamento/verificador de pacote.
O serviço usa o mesmo Node portátil e o mesmo módulo nativo SQLite do pacote.

## Contrato implementado

- SQL preparado e parâmetros tipados via serialização privada, sem expor
  consultas, valores, caminho do banco ou cofre no diagnóstico HTTP.
- `run/get/all`, modo de linhas por arrays, parâmetros vinculados e metadados.
- Transações síncronas, BEGIN IMMEDIATE/EXCLUSIVE e savepoints aninhados;
  callbacks assíncronos não são aceitos em transações síncronas.
- Iteração em páginas de 64 linhas, até 64 cursores simultâneos; cache de
  statements limitado a 512 combinações de SQL/modo.
- Resposta síncrona limitada a 16 MiB, prazo de 30 s. Resposta grande demais ou
  desconexão bloqueia a conexão, sem repetir consulta/gravação.
- Backup assíncrono com prazo de 60 s, sem transportar callbacks JS. Timeout
  mantém resultado desconhecido e não remove um arquivo parcial por suposição.
- Encerramento do IPC fecha a conexão e seus cursores; não reaproveita PID
  histórico, não toma posse de outro serviço e não reconecta automaticamente.
- Falha de armazenamento bloqueia API/WS e novas rotinas de automação,
  distribuição, ingestão e HA. Não executa TAKE/STOP de emergência nem substitui
  o PGM automaticamente. A continuidade real do engine ainda precisa de ensaio.
  Em modo HA, a cerca nativa existente continua independente: perda de posse ou
  impossibilidade de autorizar novas concessões pode expirar o engine/relay;
  isso não é promoção ou TAKE automático de um segundo nó.

## Diagnóstico e revisão pendente

Administrador: `GET /api/engineering/storage`, com dados de conexão, isolamento
e latência das chamadas. O painel HOST exibe conexão e tempos, e não confunde
integração implementada com homologação. Sem conexão válida, a API retorna 503;
o último painel recebido não é apresentado como estado atual.

O fixture `scripts/verify-storage-process.mts` foi preparado, **não executado**.
Ele exige os auxiliares compilados, cria seus próprios bancos temporários e
verifica Drizzle, Unicode, rollback/savepoints, leitura por arrays, cursores,
dois clientes, backup e bloqueio após resposta excessiva. Não prova PGM, placa,
outra máquina, carga sustentada ou instalação limpa.

Para encerrar 7.1–7.4, revisar em conjunto: compilação, compatibilidade completa,
shutdown/órfãos, colisões multiusuário, crash durante commit/backup, as-run e
reservas, restauração/cofre, memória/CPU/latência e canal nativo sob carga.
Os receipts e registros existentes continuam sendo a fonte de verdade; uma
resposta perdida nunca é interpretada como recusa definitiva ou autorização de
reenvio. Ainda não há promoção HA por causa desta implementação.

# 6.4 /7.1 — credenciais do backend não herdadas pelo banco privado

## Correção integrada

O Worker de transporte e o processo SQLite herdavam o ambiente completo do
servidor. O serviço lê apenas o arquivo de banco explicitamente atribuído; não
usa senha administrativa, chave do cofre, token de controle ou configuração de
mídia. Não houve prova de vazamento externo, mas a herança era desnecessária.

Nova função `storageProcessEnvironment`, aplicada nos DOIS limites:

1. `ProcessDatabase` fornece ambiente explícito ao Worker.
2. `storage-bridge` filtra novamente ao criar o processo SQLite e atribui
   somente então seu próprio `RPLAYOUT_STORAGE_FILE`, vindo do workerData.

Allowlist de runtime/caminhos de módulos/temporários/localidade; chaves
normalizadas sem duplicar PATH, sem modificar o ambiente do servidor. Variáveis
desconhecidas também são descartadas, não só uma lista de senhas atuais.
NODE_OPTIONS ambiental não é herdado. Não foram alterados flags de permissão
da linha de comando, protocolo SQL/IPC, deadlines, transações ou política de
não reabrir/repetir após falha. NODE_PATH é preservado para resolução de módulos;
este lote NÃO certifica ausência de dependências emprestadas em Windows limpo.

## Evidências realizadas

- 14 testes unitários PASS: allowlist, ausência de mutação, nomes em diferentes
  caixas, duplicação de PATH, variáveis privadas/futuras, opções/hooks ambientais.
- Tipos completos do servidor e tipos dirigidos do roteiro PASS.
- Build isolado do servidor com14 entrypoints PASS. Interface não recompilada:
  não houve alteração nela neste lote.

`scratch/storage-environment-pbEgT0/result.json`: PASS preliminar, observação
do Worker e de um proxy de serviço. Esse caso NÃO observa diretamente o
ambiente do processo SQLite atrás do proxy; não ampliar sua conclusão. O proxy
copiado e o resultado originais foram preservados, sem reclassificação.

Para provar o limite real sem essa inferência, o observador de serviço foi
alterado: ele carrega por `require` o arquivo compilado exato no MESMO processo,
sem fork/proxy, alteração de mensagens, ACK sintético ou SQL adicional oculto.
É uma instrumentação QA declarada, não uma instalação do backend de produção.

`scratch/storage-environment-6xdhUV/result.json`: PASS. Worker real thread2 no
backend15392; resposta `open` do SQLite confirma PID416, o MESMO do observador
direto. Oito variáveis-canário, de valores exclusivamente QA, ausentes nos dois:
senha administrativa, chave do cofre, token de controle, runtime OMT, segredo
futuro, chave de API, proxy HTTP e NODE_OPTIONS. Apenas presença/nomes de chaves
registrados, jamais valores. Arquivo de banco ambiental do pai não foi herdado;
o serviço recebeu o arquivo QA Unicode explicitamente designado.

O Windows acrescentou variáveis básicas de perfil ao processo filho (nomes
como USERPROFILE/HOMEDRIVE observados). Portanto NÃO alegar que só11variáveis
existem no processo: a prova é da filtragem fornecida pelo aplicativo e dos
canários ausentes, não controle de toda injeção externa do sistema operacional.

Mesmo serviço compilado executou gravação/leitura Unicode, rollback real sem
linha residual e backup SQLite. Marcador EXITED/código0, serviço e backend QA
ausentes nas consultas posteriores. Não se matou PID reconstruído ou alheio.

Conferência posterior somente-leitura, sem repetir o cenário: probes/bridge/
serviço/fontes com hashes correspondentes, oito canários ausentes, PID do open
igual ao observador, banco/backup íntegros e FK sem violações, uma linha QA
esperada e nenhum efeito do rollback. Bytes dos dois arquivos principais iguais
antes/depois da leitura; auxiliares SQLite não são prometidos imutáveis.

## Artefatos atuais

Servidor `scratch/host-history-r88-storage-env-20261019/server.cjs`:
`99748aeddc6260aa8340f652be4348df18d1225fdfefb545729827fb6407453b`.

Bridge no mesmo build:
`c60c2efdc5a68983c1c27febdedc8c882b696a90ba450cfcc90d6025b6d64b5d`.
Serviço SQLite permanece9EB4D10D…; fonte do filtro430D4261…. Probes e hashes
completos estão no resultado6xdhUV. O bridge mudou; não o chamar de inalterado.

Interface continua `host-history-r88-web-native-diagnostic-20261018`, entrada
index-DED2jcbR.js/EFDC03FF…. Builds anteriores preservados, dist convencionais
não substituídos. Caso de seleção preparado com servidor atual, NÃO executado
sob recusa de carregamento dos scripts já registrada.

## Pendências preservadas

6.4/7.1 em andamento. Este ensaio não prova pacote instalado/Windows limpo,
compatibilidade SQL completa, carga multiusuário, continuidade de PGM, expiração
de concessões durante bloqueio30s, restauração histórica ou falha de energia.
Esses requisitos permanecem separados e não se encerram por este PASS.

R88 ainda NOT_BUILT/NOT_INSTALLED: seleção/ZIP funcionais, compilação nativa,
consulta de portas e integração instalada pendentes. Sem escrita D:, limpeza,
movimentação, alteração de política ou instalação. Grupo8v3/DeckLink física adiada.

Total:10grupos/53verificações —8concluídas,34em andamento,4pendentes,7v3.

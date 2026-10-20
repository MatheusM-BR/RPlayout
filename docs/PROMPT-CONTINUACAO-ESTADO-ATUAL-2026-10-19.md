# Prompt de transferência — RPlayout — 19/10/2026

Continue o projeto RPlayout a partir do estado REAL do repositório. Não comece
uma reescrita e não considere relatos antigos como prova de que o código mais
recente foi compilado, instalado ou homologado. Leia este documento inteiro.

## 1. Últimas solicitações e ordem de trabalho

O usuário pediu, nesta ordem recente:

1. Explicação de por que a execução acumulou aproximadamente seis dias sem
   fechar uma entrega. Foi reconhecido excesso de escopo aberto, validações
   parciais e falta de um marco utilizável; não foi apresentado como inevitável.
2. Antes de continuar implementando, salvar o estado atual no GitHub.
3. ANTES desse envio, entregar este prompt de estado, pendências e últimas
   solicitações para continuar em outra LLM.

No momento em que este prompt foi preparado e entregue, o envio ao GitHub ainda
não havia sido realizado: somente inspeção de branch, remote e alterações.
Uma publicação do snapshot pode ter ocorrido DEPOIS: confira o log local e a
branch remota antes de repetir commit/push. A confirmação mais recente no chat
prevalece sobre esse registro histórico. Não retome implementação antes de
tratar a solicitação de GitHub, salvo nova orientação do usuário.

Trabalhe em lotes delimitados: implemente o grupo, depois faça uma rodada de
validação. Não repita testes porque mudou texto/status. Se um teste falhar,
corrija e repita o escopo afetado. Não crie execução autônoma ilimitada. Ao fim
do lote acordado, entregue evidências, limites e o que falta para o próximo.

## 2. Ambiente, repositório e segurança

- Projeto atual: C:\IA\RPlayout. Windows/PowerShell.
- Não mover nem apagar C:\IA ou C:\RPlayout: o usuário abandonou a migração.
- Builds novas: D:\RPlayout-builds, destino autorizado. Não apagar releases,
  scratch, bancos ou pastas para liberar espaço sem autorização específica.
- Git origin: https://github.com/MatheusM-BR/RPlayout.git.
- Branch observada: claude/playout-ndi-srt-rtmp-iqz2c7.
- HEAD local observado: c0e350e446d5b590adb1cfbd540989fd7e1a554b,
  assunto `docs: include binary broadcast QA evidence artifacts`.
- Existem centenas de alterações e arquivos novos acumulados. Preserve-os.
  Confira o estado atual antes de escolher o que será commitado. Não use reset,
  checkout destrutivo, force-push ou troca automática de branch principal.
- Não enviar node_modules, scratch, release, bancos, mídia, builds, runtimes,
  credenciais, cofre ou arquivos locais de agentes. .gitignore já cobre vários
  desses caminhos; confira arquivos rastreados também, pois ignore não os remove.
- Foi observado um arquivo local `undefined` com texto de execução e alteração
  em .claude-flow/policy/state.json. Não incluir automaticamente no commit.
- Não publicar binários/instaladores no GitHub: uso confirmado é interno e
  testes, sem distribuição. O pedido de GitHub é para salvar o projeto-fonte.
- Nesta sessão .git não tinha escrita livre; obtenha a autorização da ferramenta
  quando necessária, sem contornar restrições. Não exponha tokens/credenciais.
- Instrução fornecida de AGENTS: procurar ferramentas Ruflo para tarefas
  complexas; a busca disponível não encontrou Ruflo/ToolSearch. Não inventar
  ferramenta nem tratar ausência como proibição de continuar com ferramentas
  normais. Não iniciar agentes paralelos sem instrução aplicável.

## 3. Arquitetura e contratos que precisam ser preservados

React/Vite no navegador, Fastify/TypeScript no servidor, SQLite com migrações e
cofre, engine Rust/GStreamer em processo próprio, MediaMTX/relays para monitores
e saídas. O navegador não deve sustentar o canal no ar. Há infraestrutura
parcial de HA; isso não significa redundância entre máquinas homologada.

- CUE prepara/seleciona PVW. TAKE leva a seleção preparada ao PGM apenas com
  confirmação de vídeo válido. Próximo é a sugestão/continuação automática e
  não deve sobrescrever o CUE manual. Falha preserva PGM, sem troca para preto.
- QC deve abrir a fonte diretamente, sem passar pelo Master/PVW primeiro.
  Deve haver qualidade de aprovação, preview 16:9 adequado e safe area só sobre
  o vídeo. Safe area começa DESATIVADO.
- Preview normal deve ser econômico; alta qualidade é opção explícita no QC.
  Scopes/áudio não devem bloquear a operação. Medir CPU/rede na máquina remota.
- Seletor de pastas deve aparecer na página de controle e navegar pelo servidor
  remoto, não abrir diálogo nativo no desktop do servidor. Preservar Unicode.
- Primeiro selecionar NDI/OMT/entrada; depois nome abaixo da seleção, preenchido
  com o nome encontrado e editável. Não deixar nome antigo de outra seleção.
- Fonte descoberta, cadastrada e com sinal são estados diferentes. Não anunciar
  placa instalada por inferência nem equiparar OMT a SMPTE-2110/NMOS.
- Live prioritária deve permanecer na grade, interromper VT no horário definido
  conforme política e sinal, registrar conflito/interrupção e permitir compensar
  segundos ou 2–3 minutos rapidamente, com saldo e ações claras.
- Separar intenção editorial, playlist operacional publicada/versionada e as-run.
  Conservar timing persistido, revisão, simulação, proteção e rollback seguro.
- Manter ingestão/versionamento/proxy/QC por perfil, aprovação e bloqueio de PGM.
  Em ignorados, mostrar somente vídeos; suporte genérico a qualquer formato de
  vídeo foi reservado para v2.5, não prometer compatibilidade irrestrita atual.
- Pacote Windows deve abrir sem instalar Node/pnpm/tsx/tsc/node_modules à parte:
  JavaScript compilado, Node portátil e módulos de produção materializados,
  incluindo better-sqlite3 com binário nativo compatível com Node/arquitetura.
  Os erros anteriores incluíam tsx ausente e better-sqlite3 ausente. Testar o
  conteúdo EXTRAÍDO/INSTALADO, não só o workspace com dependências disponíveis.
  Incluir runtimes/plugins permitidos de GStreamer/NDI/OMT e avisos aplicáveis;
  não prometer eliminar a necessidade do driver físico Desktop Video/DeckLink.

## 4. Decisões explícitas do usuário

- DeckLink: pular a validação física por enquanto; não declarar homologada.
- Não há emissor EXTERNO NDI ou OMT disponível na máquina para esse teste.
- Grupo 8 inteiro, redundância entre máquinas: adiado para v3. Preservar código
  parcial, mas não gastar esta entrega concluindo HA física.
- Recuperação após perda de banco/reinício: retomar AUTOMATICAMENTE do último
  ponto realmente salvo, aceitando possível repetição. Não inventar cursor
  atualizado nem exigir confirmação manual como política padrão.
- Endereço remoto informado: 192.168.42.172; localhost quando sem configuração;
  permitir configurar IP/nome e porta. Não quebrar origem/host/CORS por isso.
- Sem SDK/licença original do NDI 6.3.2 disponível. Uso interno/testes não é
  aceite de licença nem prova de redistribuição autorizada. Revisão continua.
- Gerar instalador para teste, inclusive parcial quando solicitado, identificando
  exatamente o que não foi validado. Não rotular servidor isolado como instalador.
- Em cada retorno, usar grupos/subitens numerados, situação e faltas do grupo,
  além dos totais de grupos e verificações. Sem repetir validações por status.

## 5. Estado real dos artefatos

Último instalador existente/verificado: r87, em
D:\RPlayout-builds\RPlayout-1.1-parcial-20261016-r87-instalador.zip.
SHA256: 769BD3BC3FC9284CE9F08D47431B56CAFCB8B41A676C6671E31B396EB3F5FE80.
Instalação QA: D:\RPlayout-builds\qa\r87-installed-20261016.

r88: NÃO GERADA. Não existe nova instalação validada. As mudanças recentes não
estão na r87. Leia docs/BUILD-PARCIAL-R88.md; há histórico de candidatos que
não deve ser confundido com seleção automática para empacotamento.

Última compilação ISOLADA do servidor:
C:\IA\RPlayout\scratch\native-replacement-bridge-20261019\server\server.cjs.
SHA256: FF4784EE30AE34872FC018DDDB9D0D9D955354CF2A8DE86F4F2F551FE00D4BCC.
As 14 entradas JS compilaram; CLI de rollback declara 50 migrações e formatos
de checkpoint [1,2]. Isso NÃO é build Windows completa nem integração nativa.

Última rodada consolidada deste lote: 335 PASS / 0 FAIL, 10 arquivos.
Relatório: scratch/native-replacement-bridge-20261019/tests.json.
Typecheck completo do servidor também PASS. Foram testes locais, com filho
nativo SIMULADO e SQLite real nos casos de persistência; não mídia física.
Não somar rodadas anteriores sobrepostas como testes distintos.

## 6. Último lote implementado e fronteira EXATA ainda aberta

Leia primeiro docs/TROCA-LIVE-PIPE-E-COMMIT-2026-10-19.md.

Implementado/validado localmente:

- EngineTransport: ponte privada PREPARE/COMMIT/CANCEL/STATUS na fila, no filho
  e na sequência de RPC próprios. Posse/contexto e intenção persistida antes
  de escrever no pipe. Sem fallback de troca por LOAD/TAKE.
- Troca confirmada preserva relógio, CUE, próximo armado e ocorrência de as-run.
  Exige recibo COMMITTED e State do decoder correto; sem onTakeConfirmed novo.
- Fonte selecionada vinculada em envelope protegido ao canal, revisão,
  execução/ocorrência, item, geração, decoders e recibo; checkpoint v2.
- Recuperação normal valida vínculo e recibo durável, abre conexão congelada no
  cursor salvo, sem voltar à fonte principal por fallback ou catálogo editado.
- Helper atômico: recibo + auditoria + vínculo + checkpoint na mesma conexão
  SQLite/transação. Replay valida também a ocorrência ATUAL. Corrigida comparação
  que dependia da ordem de campos. Recibo histórico não substitui PGM atual.
- Falha de gravação após corte bloqueia novos cortes/checkpoint; STATUS permite
  reconciliar a mesma transação sem repetir COMMIT.
- STOP exige ACK + PGM vazio do filho correto; resolução e cursor parado
  atômicos. Erro SQL mantém bloqueio. Uma troca desconhecida B não é resolvida
  retomando vínculo antigo A. STOP não fabrica confirmação de transmissão.
- Contrato de rollback verifica formato de dados, não somente schema. Nunca
  descartar vínculo/rebaixar v2 para tornar servidor antigo compatível.

AINDA FALTA, imediatamente:

1. Criar a fábrica de sessão autorizada no ChannelRuntime (apps/server/src/app.ts)
   ligando ledger, snapshot de execução e helper atômico ao transporte real.
2. Revalidar sessão/papel/acesso ao canal e posse no momento de cada ação na fila.
   Não capturar para sempre a autorização da primeira requisição. Gravação de
   fatos do engine continua possível após expiração da sessão, com posse válida.
3. Ligar ações HTTP e controles de operação a essa fábrica. Hoje NÃO há endpoint
   novo ativado. O failover manual existente é METADATA_DECISION_ONLY e não corta
   PGM. Não ligar seus listeners a TAKE para fingir integração.
4. Resolver journal de geração predecessora após reinício completo do servidor;
   callbacks atuais de STOP cobrem sessões conhecidas pelo transporte atual,
   não provam reconciliação entre processos do servidor.
5. Compilar e testar Rust atualizado; depois validar IPC real, vídeo/áudio,
   recuperação, CUE/próximo e repetição de comando no fluxo completo.
6. Compilar interface atualizada, selecionar componentes compatíveis do pacote,
   gerar r88, instalar e executar o roteiro integrado, respeitando bloqueios.

Arquivos principais desse núcleo:
apps/server/src/domain/engine.ts;
native-live-replacement.ts e .test.ts;
native-live-replacement-ledger.ts e .test.ts;
native-live-replacement-commit.ts e .test.ts;
live-program-binding.ts e .test.ts;
checkpoints.ts; checkpoint-recovery.test.ts;
apps/engine/src/live_replacement.rs, channel.rs, protocol.rs, main.rs.

Rust: terceira superfície do seletor para não roubar próximo/CUE, preparo/corte
explícitos, geração/revisão, recibos/idempotência, deadline e rollback incerto.
Há 12 novos testes ESCRITOS mas NÃO EXECUTADOS. Parser/rustfmt não é compilação.
O binário antigo não implementa esse contrato novo. Não anunciar corte pronto.

## 7. Matriz oficial — todas as 53 verificações

Legenda: C = concluída no escopo registrado; A = em andamento; P = pendente;
V3 = adiada por decisão do usuário. C não estende validação local a hardware.

1. Proteção da distribuição local (4/4 C):
   1.1 Identidade nativa de processos/sockets — C.
   1.2 Bootstrap compilado, bancos distintos/configuração privada — C.
   1.3 Engine e relays pelo bootstrap protegido — C, escopo local.
   1.4 Regressão final do grupo — C, cobertura com replay dirigido documentado.
2. Entradas e operação ao vivo (5 A, 1 P):
   2.1 Estados de fonte e sinal — A.
   2.2 DeckLink — P, validação adiada pelo usuário.
   2.3 NDI — A.
   2.4 OMT — A.
   2.5 CUE/TAKE/Próximo — A.
   2.6 Dispositivos de automação — A.
3. QC e operação remota (2 C, 5 A):
   3.1 Pastas na página remota — C.
   3.2 Nome da input — C, escopo funcional nome/cadastro.
   3.3 QC direto — A.
   3.4 Layout QC — A.
   3.5 Qualidade para aprovação — A.
   3.6 Preview econômico — A.
   3.7 Scopes/áudio e telas compartilhadas — A.
4. Grade, playlist e timing (5 A):
   4.1 Publicação operacional — A.
   4.2 Timing persistido — A.
   4.3 Live prioritária — A.
   4.4 Compensação rápida — A.
   4.5 Retorno e auditoria — A.
5. Ingestão, mídia e aprovação (1 C, 4 A):
   5.1 Jobs duráveis — A.
   5.2 Versões de mídia — C, escopo versionamento/execução.
   5.3 Proxy — A.
   5.4 QC por canal/perfil — A.
   5.5 Tracks/mixes/trims e ignorados — A.
6. Segurança, contratos e administração (5 A):
   6.1 Mutadores editoriais restantes — A.
   6.2 Comandos operacionais restantes — A; inclui último lote de troca de live.
   6.3 Contas e sessões — A.
   6.4 Segredos e fronteiras de acesso — A.
   6.5 Legado e diagnóstico — A.
7. Banco operacional separado (4 A):
   7.1 Serviço/worker e contrato — A.
   7.2 Concorrência e consistência — A.
   7.3 Falha e recuperação — A; inclui checkpoint/commit atômico recentes.
   7.4 Migração e latência — A.
8. Redundância de máquinas (7 V3, NÃO executar agora):
   8.1 Replicação para outro host — V3.
   8.2 Reserva apto — V3.
   8.3 Promoção executável — V3.
   8.4 Fencing externo — V3.
   8.5 Handoff e replicação reversa — V3.
   8.6 Rejoin/failback — V3.
   8.7 Falhas físicas e RPO/RTO — V3.
9. Recuperação e observabilidade (4 A, 1 P):
   9.1 Histórico de saúde — A.
   9.2 Incidentes — A.
   9.3 Backup/restauração real — A.
   9.4 Watchdog e recuperação — A.
   9.5 Soak e desempenho — P, roteiro prolongado 24/48h.
10. Pacote Windows e publicação (1 C, 2 A, 2 P):
   10.1 Artefato portátil atualizado — C para r87 histórica, NÃO para r88.
   10.2 Dependências nativas — A.
   10.3 Windows limpo — P.
   10.4 Upgrade e integridade — A.
   10.5 Publicação — P; separar fonte no GitHub de distribuição de binários.

Totais: 10 grupos / 53 verificações: 8 C, 34 A, 4 P, 7 V3.
1 grupo concluído, 8 abertos nesta versão, 1 adiado para v3.
Escopo da versão atual: 9 grupos / 46 verificações, das quais 38 não concluídas.
Não converter essa contagem em percentual de código pronto.

A matriz com evidência e o que falta em CADA item está em
docs/PENDENCIAS-NUMERADAS.md. O arquivo tem histórico extenso: use os blocos
`## Pendência 1` até `## Pendência 10` e `## Totais` para o quadro atual,
com as atualizações mais recentes no início. Não confundir números históricos.

## 8. Bloqueios e limites de validação

Houve restrições de autorização/execução para compilação nativa e geração do
pacote em D:, execução de scripts PowerShell, build web e alguns clientes HTTP.
Os relatos históricos são pistas, não prova de bloqueio atual. Reconfira a
operação necessária e use aprovação normal, sem bypass de política, troca de
cache/target para contornar recusa, alteração de ACL ou instalação silenciosa.
Não pedir a mesma autorização repetidamente quando houver recusa vigente.

Testes com Fastify.inject não comprovam acesso remoto. Filho simulado não
comprova vídeo nativo. Sinais sintéticos locais não homologam emissor externo
NDI/OMT ou placa DeckLink. Build JS não comprova Rust nem instalador. Licença
pública encontrada não comprova o contrato específico da DLL recebida.

Também estão abertos: clean Windows, ensaio prolongado, estações remotas,
interface atual integrada e testes completos de retomada/upgrade do pacote novo.
Não prometer ausência de bugs ou aptidão broadcast crítica sem essas evidências.

## 9. Documentos de referência e próxima entrega

Leia por prioridade:
1. Este prompt.
2. docs/TROCA-LIVE-PIPE-E-COMMIT-2026-10-19.md.
3. docs/LIVE-BINDING-RETOMADA-2026-10-19.md.
4. docs/CONTINUACAO-FAILOVER-NATIVO-E-BUILD-2026-10-19.md.
5. docs/BUILD-PARCIAL-R88.md.
6. Blocos atuais da docs/PENDENCIAS-NUMERADAS.md.
7. docs/FAILOVER-SERVIDOR-JOURNAL-2026-10-19.md e
   docs/FAILOVER-NATIVO-CONTRATO-FONTE-2026-10-19.md para detalhes do protocolo.

Primeira ação após o handoff: conferir se o envio de fonte ao GitHub já
solicitado foi concluído após a preparação deste documento. Se não foi, fazer
inventário/revisão de segredos, commit identificável e push sem force. Não
repetir envio já confirmado. Informe branch/hash/link e exclusões; se bloqueado,
informe o motivo real e não declare enviado. Só então retome o lote
Runtime/autorização/controles.

Ao concluir o próximo lote, apresentar: mudanças efetivas, testes daquele lote,
artefato REAL existente, limitações conhecidas, subitens numerados ainda abertos
e totais atualizados. Não marcar requisito amplo concluído por um teste estreito.

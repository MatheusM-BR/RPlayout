# Cópia local da execução HA — NOT_RUN

Etapa 8.3 integrada ao orquestrador de promoção, posterior à R55. Sem testes,
build ou homologação física neste lote.

Continuação: diretório gerado vazio é protegido antes dos dados. Auxiliar nativo
aceita --private-directory-stdin apenas para nome .ha-execution.private-UUID,
sem operação recursiva e recusando conteúdo/link/reparse/owner estranho. Aplica
DACL protegida com apenas usuário corrente e SYSTEM, com herança para filhos
futuros, e verifica ACL antes de confirmar. Não altera a raiz de instalação
nem diretórios comuns. Unix usa modo 0700. Auxiliar antigo recusa a operação;
nova build conjunta é necessária. Fixtures de ACL Windows adicionados, NOT_RUN.

O orquestrador agora autentica o marcador cifrado e reconfere UUID/preparação/
canal/caminho/hash/tamanho/identidade e ausência de WAL/SHM antes do adaptador.
Leitura do marcador é limitada a 64 KiB e vinculada ao handle. Verificação da
cópia imutável não é reserva de execução: admissão host/storage ainda precisa
ser adquirida antes de alterar o banco. Após alteração deliberada sob admissão,
o diário/lease de storage substitui esse hash inicial; não usar o marcador
staged para afirmar que uma execução já em andamento continua imutável.

Antes de preparar processos, o diário registra executionCopyId igual ao UUID
da promoção. O backend cria executions/.ha-execution.private-UUID/operational.db em diretório novo;
uma repetição nunca sobrescreve esse diretório. A raiz vem da configuração
interna HA, não do navegador. Fonte vem do candidato autenticado/validado, não
de caminho indicado pelo operador.

Protege o destino vazio antes dos bytes, recusa links/junções/hardlinks, fonte
com WAL/SHM, tamanho acima de 16 GiB e falta de espaço (mais reserva de 64 MiB).
Copia em blocos, confere identidade dos handles e caminhos, tamanho/mtime/ctime,
SHA da fonte durante leitura, fsync e SHA do destino real. Reconfere candidato,
inventário e autorização antes/depois. Marcador de origem é cifrado/autenticado
com cofre local e UUID, sem expor caminho em texto aberto.

O adaptador recebe executionCopy separada do candidato original. A preparação
original não é modificada. Canal, cursor e saídas continuam exatamente como na
preparação: arquivado/parado, sem saídas configuradas. A cópia NÃO dá posse
host/storage, não migra schema, não abre PGM, não altera perfil de instalação
e não é promoção automática. A admissão posterior deve autenticar origem e
revalidar cópia antes de modificar deliberadamente o novo banco sob sua reserva.
WAL/SHM futuros herdam restrição do novo diretório; sua identidade/posse ainda
precisam ser verificadas pela admissão posterior de storage.

Falha parcial conserva a cópia isolada para diagnóstico, sem limpeza de dados
do usuário. Antes do adaptador, nenhuma abertura de processo de programa foi
iniciada. Interrupção deixa o UUID do diário e a pasta preservados; consulta não
retoma a cópia. Refusa terminal não permite reutilizar a pasta/UUID. Após entrada
no adaptador, ausência de handle/parada continua sendo UNCERTAIN.

Ainda falta factory da execução admitida: conferir proteção efetiva e sidecars,
posse host/storage, abertura do banco distinto, instalação explícita dos
destinos locais revisados, cursor/áudio/grafismos e recursos próprios rastreados.
Não habilitar o adaptador apenas porque a cópia existe. NÃO usar createApp
comum no banco preparado nem remover sua quarentena para contornar admissão.

Fixtures byte-copy de preservação da fonte, repetição sem overwrite e hash
incorreto foram adicionados, NOT_RUN. Proteção de arquivo é mockada nessas
fixtures: não são prova de ACL Windows, integridade SQL ou engine físico.
Fixtures do orquestrador mockam a cópia explicitamente e também não comprovam
storage/engine/rede reais. Qualificar a cadeia completa na rodada consolidada.

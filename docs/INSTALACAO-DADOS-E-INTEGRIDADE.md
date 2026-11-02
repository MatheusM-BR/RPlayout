# Instalação, dados e integridade — lote NOT_RUN

Implementação agregada de 10/10/2026. Pendência 10.4 em andamento, não
homologada. Nenhum teste, compilação, extração, instalação ou atualização
real foi executado nesta etapa. R55 não contém este código posterior.

## Contrato implementado

O instalador confere o catálogo completo do ZIP antes da extração: caminhos
Windows, duplicatas sem distinção de caixa, traversal, links, limites de
quantidade/tamanho e correspondência completa com manifesto. Arquivo extra
não declarado é recusado. O destino precisa ser novo e não atravessar junções.
Depois da extração, todos os hashes declarados são conferidos antes de criar
perfil, recibo ou atalhos. Falha preserva arquivos parciais para diagnóstico,
sem apagar a edição antiga. Hashes não equivalem a assinatura/autenticidade
do publicador: assinatura de distribuição continua pendente.

Cada instalação nova recebe `installation-profile.json`, com caminhos absolutos
de dados, mídia e arquivo de cofre. Dados começam em `data` da nova edição,
sem reutilizar o banco de uma edição anterior. O cofre continua no local
protegido por usuário do Windows; não se cria/copia/exporta chave no instalador.
O lançador fornece os caminhos declarados ao servidor, inclusive backups.
Perfil inválido, caminho relativo/junção ou variável externa conflitante
interrompe a abertura, sem fallback para outro banco/cofre. Instalações
portáteis antigas sem perfil mantêm seu comportamento anterior.

Pacote instalado exige Node portátil; o lançador não usa Node global quando
o runtime do pacote está ausente. Perfil/recibo de outra máquina não podem
vir pré-incluídos no manifesto. O recibo registra hashes do payload/manifesto,
integridade conferida, edição/destino e `functionalVerification=NOT_RUN`.
Ele não atesta sucesso dos atalhos, compatibilidade ABI, execução ou hardware.

O empacotador streaming aceita `LauncherBinary` absoluto junto de
`UseCurrentBuilds`, para integrar o launcher realmente compilado no lote,
inclusive quando a compilação ocorre fora do disco C. É obrigatório recompilar
esse launcher e todos os auxiliares alterados antes da próxima build.

## O que falta em 10.4

### Preparação guiada implementada, NOT_RUN

`prepare-rplayout-upgrade.ps1` é incluído no pacote novo. Confere arquivos
imutáveis declarados, exige Node/ferramenta de restore no manifesto e usa
somente runtime embutido. Solicita backup, pasta nova, cofre original e pasta
de mídia original explicitamente — não usa mídia vazia da nova instalação.
Não copia arquivos de mídia nem altera seus caminhos no banco.

Invoca a restauração isolada já existente, que valida SQLite/cofre e registra
quarentena durável. Só depois de receber QUARANTINED sem prontidão de promoção
cria perfil candidato e recibo de preparação por criação exclusiva. Destino
existente é recusado; falha conserva a cópia parcial. O perfil candidato aponta
ao `service.db` e ao cofre copiado nessa quarentena. O launcher ganha suporte
a `databaseFile` explícito, obrigatório diretamente sob `dataRoot` quando
informado. Este código novo/integração ainda não foi compilado ou exercitado.

Nenhum servidor é iniciado/parado, nenhum perfil ativo é substituído e nenhuma
edição anterior é alterada. Não copiar o perfil candidato para ativar sem
revisão operacional. A identidade do banco e a compatibilidade por edição
ainda precisam de gates de ativação/retorno. Recibos/caminhos não contêm chave
em claro, mas não constituem autenticação criptográfica do instalador.

### Fechamento restante

Comparação de as-run para retorno integrada (NOT_RUN):
`review-rplayout-rollback.ps1` usa Node e auxiliar compilado do próprio pacote,
confere manifesto e exige dois backups fechados, cofre original e pasta nova.
Valida restauração/schema com a versão atual e compara todas as colunas por ID:
novos registros, alterados (incluindo fechamento posterior) e ausentes. Contagens
e hash cobrem o inventário inteiro; relatório limita detalhes a mil, explicitando
truncamento, e recusa acima de 500 mil registros por snapshot. Relatório completo
fica cifrado e privado; console contém apenas contagens/ID. Não mescla evidência,
não escolhe cursor, não troca perfil, não inicia engine e nunca declara rollback
pronto. Schema conhecido não prova compatibilidade do binário antigo. A
conciliação de histórico e geração/ativação de cópia compatível ainda faltam.
Onze bundles passam a ser obrigatórios no próximo pacote; R55 não contém este
lote. Fixtures adicionadas, sem testes/build nesta etapa agregada.

Recuperação conjunta de reserva/adopção integrada no código (NOT_RUN):
`reconcile-rplayout-upgrade-profile.ps1 -RecoverMaintenance` exige a frase
LIBERAR RESERVA E RECONCILIAR. Consulta de IDs não aceita nem executa essa
mutação. A opção é extra e explícita; não é padrão de reconciliação.

Se houver MAINTENANCE, autentica o manifesto da mesma restauração da intenção
antes de qualquer liberação e reutiliza recoverRestoredReservation sob o mesmo
host fence. Exige detentor local com PID ausente, todas as instâncias liberadas
e predecessor nativo liberado. Owner remoto/vivo/inconclusivo, spawn desconhecido
ou origem diferente recusa sem apagar reserva. Liberação existente registra
auditoria e mantém todos os gates de execução; depois adquire reserva própria
para conferir/reconciliar o perfil observado, sem publicar arquivos ou TAKE.

Se a conferência de perfil falhar após recuperar a reserva, a recuperação
fica auditada, mas a intenção de perfil continua bloqueando a partida. Nunca
declara resultado global concluído apenas porque storage ficou OPEN. Se cair
durante a operação, a nova reserva novamente exige prova explícita de morte;
nenhum timeout rouba a posse. Fonte/integração ainda sem testes/build/execução;
qualificação real de energia/PID/Windows permanece em aberto. Rollback com
dados compatíveis e conciliação do as-run ainda falta implementar/revisar.

Reconciliação offline de adoção implementada (NOT_RUN):
`reconcile-rplayout-upgrade-profile.ps1` confere pacote e consulta IDs pendentes
sem trocar arquivos. Exige ID exato/frase RECONCILIAR, cofre/banco da adoção,
schema atual, posse nativa/manutenção e predecessor liberado. Diário deve
correlacionar intenção e resultado pelo contexto completo, não só UUID/fase.

O auxiliar aceita somente hash do perfil anterior ou do candidato. Candidato
exige anterior preservado/hash, ativação CONFIRMED autenticada correspondente
e caminhos do banco/cofre corretos. Perfil diferente é recusado. Resultado
fecha a intenção como observado CONFIRMED ou REFUSED, sem rename, TAKE ou
repetição de ativação. Hash/diário e posse são reconferidos na transação.
ACK histórico perdido permanece desconhecido; resultado observado agora não
é certificado físico. Cópia/histórico/arquivos anteriores são preservados.

Reserva MAINTENANCE ainda protegida, criador vivo/remoto/incerto ou predecessor
não liberado recusa reconciliação: não há roubo por timeout. Reservas
interrompidas precisam do fluxo separado de manutenção sob prova nativa; esse
caminho conjunto após corte de energia ainda deve ser integrado/qualificado.
Dez bundles exigidos pelo pacote. Fixtures de contexto de diário preparadas,
NOT_RUN; ferramenta nova não foi compilada/exercitada. Rollback/as-run e
provas Windows/energia permanecem pendentes.

Adoção permanente opcional integrada no código (NOT_RUN):
`start-rplayout-upgrade.ps1 -Mode ACTIVATE -AdoptProfile` exige a frase
ATIVAR E ADOTAR. STAGE recusa essa opção. O launcher remove variável herdada
de adoção e só a fornece no caminho explícito autorizado. Antes de ativar, o
backend captura e valida candidato/perfil anterior e os caminhos efetivos de
banco, mídia e cofre; candidato deve pertencer à pasta de dados declarada.

Depois de CONFIRMED nativo na instância atual, sob reserva/posse mantidas,
preserva perfil anterior em arquivo privado novo e publica candidato via
rename atômico do helper existente. Hashes impedem substituir silenciosamente
candidato/ativo alterados durante a operação. Diário cifrado registra intenção,
hashes, ativação, arquivo anterior e resultado. Falha com ativo ainda anterior
registra REFUSED; perfil publicado sem confirmação durável fica UNCERTAIN.
STARTED/UNCERTAIN bloqueiam partida normal, sem repetir adoção/TAKE.

Com confirmação durável, próximos duplos cliques da edição nova passam a usar
dados/cofre preparados; não recriam o banco inicial vazio. Sem AdoptProfile,
o perfil normal permanece anterior, como nas etapas precedentes. Se adoção
falhar, a tentativa de backend candidato é encerrada, preservando arquivos e
diário; não reinicia automaticamente a edição antiga. Perfil anterior preservado
não equivale a rollback de dados ou conciliação do as-run ocorrido.

Fixtures de diário preparadas e não executadas. Ainda falta reconciliação
explícita de adoção incerta, provas Windows de publicação/ACL/interrupção,
retorno compatível e conciliação de histórico. Nenhuma troca real, compilação
ou teste foi feita nesta etapa. Proteção não é CAS contra um invasor da mesma
conta Windows nem autenticidade de pacote sem assinatura.

Migração isolada integrada no código (NOT_RUN): `migrate-restored.cjs` e opção
explícita `-MigrateSchema` nas ferramentas review/start de atualização. Só
aceita arquivo regular em quarentena com origem protegida atual, cofre original
e schema conhecido. Exige posse nativa e reserva de armazenamento; não para
o predecessor e recusa instância viva/remota/incerta. Portanto a migração
exige janela operacional com predecessor liberado, não ocorre sobre o banco
ao vivo. O backup original e a instalação anterior não são alterados.

Na cópia, reutiliza migrações transacionais existentes de openDatabase sob
reserva mantida, sem criarApp/engine/publishers. Confere todos os IDs suportados,
integridade, foreign keys e origem antes de concluir. Mantém quarentena,
cursores/publicações e histórico; alterações próprias das migrações continuam
exigindo revisão. Diário cifrado correlaciona intenção/resultado/fase e origem.
STARTED sem terminal bloqueia revisão/ativação posterior; nada limpa/reexecuta
por timeout. Em perda da posse, reserva/diário permanecem protegidos. Cópia já
atual gera apenas resultado CURRENT_NOT_ACTIVATED, sem nova migração.

Ferramentas oferecem essa mutação somente quando `-MigrateSchema` é informado.
Revisão sem a opção permanece sem migração; depois da migração é feita revisão
operacional fresca. Empacotamento exige nove bundles, incluindo o auxiliar novo.
Fixtures de diário preparadas, não executadas. Ainda falta comprovar migração
real entre versões, corte de energia, manutenção/processo separado e fidelidade
dos dados/cursor, além de adoção permanente do perfil e rollback/as-run.

Início integrado do candidato implementado no código, NOT_RUN:
`start-rplayout-upgrade.ps1 -Workspace <pasta> -Mode STAGE|ACTIVATE`.
STAGE é padrão e abre backend em quarentena, sem ativar canais. ACTIVATE
exige que o operador digite ATIVAR e pode recuperar PGM/saídas. A ferramenta
não para o predecessor: se posse/porta estiver ocupada, o início é recusado.
Antes do início, repete a revisão offline e usa o launcher portátil da edição
nova com perfil candidato e manifesto protegido explicitamente selecionados.

O launcher aceita o par perfil/manifesto absoluto, recusa modos duplicados,
ativação sem confirmação e reutilização de uma API já existente nesse fluxo.
O Node recebe `--stage-restored` ou `--activate-restored`; o backend adquire
novamente os gates de posse nativa/manutenção/origem/revisão, mantendo-os
durante a admissão/ativação existente. Recibo offline não é capacidade de TAKE.
Resultado nativo incerto/STARTING não é repetido automaticamente. Saída não
zero do backend agora é propagada pelo launcher, não tratada como sucesso.

Esta ferramenta não troca `installation-profile.json`, cria atalhos permanentes
de retorno ou promete downgrade. Após encerramento, um novo duplo clique comum
ainda usa o perfil original da edição, não o candidato. Falta finalizar adoção
permanente do perfil com confirmação autenticada, histórico/incerteza, política
de migração isolada de backup antigo e rollback/as-run compatíveis. Não é
upgrade completo. Fixtures de opções CLI preparadas, sem execução/build nesta
etapa; nenhum processo/canal real foi iniciado por esta implementação.

Compatibilidade de schema integrada no código (NOT_RUN): o binário mantém
registro explícito das migrações suportadas (1–50, com nomes exatos). Abertura
operacional confere marcadores antes de alterar journal/DDL/admissão e novamente
sob transação. ID futuro/desconhecido ou nome divergente recusa sem apagar
marcadores. Após migração, exige todos os IDs esperados, não apenas o máximo.
Backups/restauração e revisão offline usam o mesmo guard somente leitura.
Isso é contrato de versão, não substitui validadores de tabelas/triggers/segredos.

Pedidos de backup passam a integrar migração 50, com schema validado;
construtor do serviço não cria/adota tabela ad-hoc. Fixtures de registros
históricos, marcador futuro, identidade divergente e migração faltante foram
preparadas e não executadas. O pacote novo precisa recompilar servidor e
ferramentas para compartilhar esse contrato.

Limite importante: versões antigas que nunca possuíram esse guard não ganham
proteção retroativa. O fluxo de rollback ainda deve selecionar backup compatível
e impedir abrir dados migrados com aqueles binários. Registro conhecido por si
só não prova compatibilidade ABI de Node/SQLite/plugins/engine ou qualificação
de um downgrade. Nenhuma restauração/migração real foi exercitada neste lote.

Revisão offline guiada integrada no código (NOT_RUN):
`review-rplayout-upgrade.ps1` recebe a pasta preparada, recusa junções/links e
verifica a correspondência entre candidato, banco, cofre, recibo de preparação
e edição imutável do pacote. Confere hashes dos binários declarados antes de
executar o `review-restored.cjs` embutido. O domínio existente autentica a
origem cifrada da restauração e adquire posse nativa/manutenção para conferir
predecessor liberado, publicações, cursores, mídia SHA/QC e pendências de execução.

O script exige REVIEWED_NOT_ACTIVATED com o mesmo requestId e confere novamente
os hashes do candidato/manifestos. Gera recibo novo por criação exclusiva,
sem substituir revisão antiga. Nenhum perfil é trocado ou reprodução iniciada.
Recibo é somente evidência de revisão naquele instante, não capacidade de
execução, posse contínua, homologação física ou aprovação do retorno. Lives
ainda precisam de confirmação nativa. Ativação deve repetir/adquirir os gates
sob posse continuamente mantida, não aceitar este JSON como autorização.

Fonte e integração da ferramenta/painel/empacotador não executadas nesta etapa.
O script não produz migração aprovada de schema e não altera o as-run anterior.
Ainda falta ligar revisão/ativação, troca de perfil e rollback em um fluxo
único com confirmação e histórico de resultado incerto.

Backup online guiado também integrado no código (NOT_RUN): painel HOST oferece
pedido UUID e consulta separada via `/api/backups/upgrade`. Administração global
e sessão fresca são necessárias; todo o banco não é exportado a um operador
limitado a canal. Serviço usa API SQLite online, valida restauração/cofre e
registra SHA/arquivo em relatório cifrado. Cópias ficam em `backups/upgrade`,
com `retainExisting=true`, fora da poda dos backups regulares.

Pedido repetido só consulta. CHECKING persistido sem builder próprio aparece
como UNCERTAIN e não é retomado. Reconciliação explícita exige criador local
com PID comprovadamente morto, sem apagar arquivos. Snapshot restaurado pode
conter o CHECKING histórico do backup que o originou; também não é reexecutado.
Sessão expirada/falha preserva a cópia e não declara READY. Encerramento normal
do servidor aguarda os builders antes de fechar o banco. Painel guarda o UUID
na sessão do navegador antes do envio e não produz novo UUID por timeout.

READY significa cópia/cofre conferidos naquele momento, não aprovação da nova
edição. Ferramenta de preparação revalida o arquivo quando o consumir. Arquivo
permanece no servidor: caminho exibido não é download nem exportação do cofre.
Fixtures de autorização, UUID, cifragem, fechamento e recusa de reconciliação
foram preparadas, **não executadas**; backup real/processo separado/UI/permissões
e shutdown ainda precisam da rodada consolidada.

- Revisão consolidada da geração guiada de backup SQLite online e integração
  da preparação à revisão de configuração/mídia e à ativação da instalação nova.
- Restauração em cópia isolada e revisão operacional explícita antes de ativar.
- Política de compatibilidade de schema/ABI por edição e bloqueio de downgrade
  sobre banco migrado. Nunca abrir banco migrado com binário antigo por atalho.
- Rollback para binários e cópia de dados compatíveis, com decisão sobre novos
  as-run/checkpoints; não descartar execução ocorrida após o upgrade.
- Cenários de ZIP adulterado, Unicode/UNC, disco cheio, arquivo bloqueado,
  junction, interrupção de instalação e preservação da edição antiga/cofre.
- Instalação Windows limpa, atualização/retorno reais, assinatura e publicação.

Fixtures de perfil Rust preparadas e não executadas. A conferência completa
de ZIP precisa de fixtures próprias na rodada consolidada. Até esses gates
serem fechados, este código não constitui upgrade/rollback pronto.

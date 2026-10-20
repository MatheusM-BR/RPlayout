# 6.1 — Pastas/categorias visuais e consultas com prazo

Dois escopos distintos; não transferir o ensaio visual anterior para o build
posterior de consultas.6.1 continua em andamento, não houve novo pacote.

## Interface antes do lote de consultas

Fixture própria WQl8im, script verify-settings-browser.mts --direct, backend
compilado do lote anterior e interface index-B0b5xQEY.js. Conta sintética
settings-verifier, mídia/banco/pastas próprios. Engine/broker/probe/proxy e
saídas desativados. Não acessou o servidor operacional ou192.168.42.172.

Observado pela habilidade de controle do navegador:

- Login sintético abriu configuração e mostrou transporte simulado.
- NAVEGAR NO SERVIDOR abriu o explorador dentro da página, sem seletor nativo.
- Caminho Acervo São José Çãó mostrou a subpasta Região Óptica; navegar e
  conferir a subpasta habilitou o cadastro.
- Trocar o caminho invalidou a conferência, desabilitou USAR PASTA CONFERIDA
  e não exibiu a lista antiga como se pertencesse ao novo caminho.
- Reabrir/conferir/cadastrar a pasta criou a segunda raiz uma vez. A página
  informou sonda indisponível e cadastro **sem pedido de leitura**; não afirmou
  varredura, mídia aprovada ou sinal disponível.
- Nova categoria Jornal São José Çãó em azul abriu conferência, ainda não criada,
  com0 vínculos. Salvar cor conferida gravou a categoria e voltou à lista.
- Escolher verde abriu outra conferência sem gravação automática. A mudança
  verde não foi enviada; a categoria persistida continua azul.

Conferência posterior somente leitura, verify-settings-visual-result.mts:
PASS/exit0, scratch/group06-settings-visual-20261014/persisted.json.
Duas raízes, uma inclusãoMEDIA_ROOT_ADDED, umaCATEGORY_COLOR_CHANGED,
doisAPI_MUTATION, umaSESSION_CREATED. Categoria#5b8fd6; scanQueued0,
as-run0, liveSources0, accountMutations0; diretório/subpasta preservados.
O leitor inicial recusou TEMP diferente entre sandbox/criação elevada; passou
após admitir explicitamente os dois diretórios temporários locais, sem abrir
um caminho arbitrário e sem alterar o banco.

Captura:pasta-unicode-cadastrada.png na mesma pasta de evidência. Instância
encerrou pelo limite de600s com exit0/serverExitObserved; aba própria fechada.
O resultado da fixture não é uma certificação visual automática: as observações
e a conferência de persistência acima delimitam o que foi testado.

Tentativa de peer para provar stale/same-value foi recusada antes da execução:
revisão automática indisponível por limite de uso. NOT_RUN, não FAIL do produto;
não houve fallback por outra ferramenta. Script verify-category-visual-peer.mts
preparado, não homologado; sua rota de revisão de raízes foi ajustada para
/api/library/roots/review antes de qualquer execução futura. Nada foi gravado
por esse peer; não existe peer-same-value.json nesta prova.

## Lote posterior na fonte

Catálogo/conferência de categorias, catálogo/navegação/conferência de pastas e
estado do scanner recebem AbortSignal somente em GET. Sem signal em mutações.
BoundedLatestRead.read encerra a espera no prazo10s mesmo se o transporte
ignorar abort, drena a promessa tardia sem publicá-la e elimina timer/listener.
Fechamento/substituição são cancelamentos silenciosos, não erros de rede.

Respostas antigas não substituem a seleção atual; fechamento/StrictMode
invalidam a geração. Falha conserva lista/caminho/draft e pede nova conferência;
não presume acervo vazio, scan concluído ou cadastro enviado. Poll de scanner
não sobrepõe/cancela leitura ativa, nem impede o prazo reiniciando a cada2s.
Categoria tem guarda imediata de recarga. Caminho de gravação permanece intacto.

22 casos dirigidos em7 arquivos PASS: prazo com transporte que ignora abort,
supersessão/resposta tardia, fechamento, polling sem sobreposição, erro real;
API GET/Unicode/signal e escritaPUT sem abort; contratos de leitura anteriores,
seleção de raiz e markup inicial protegido. Tipos web PASS; build web PASS:
index-LkFuB0wC.js SHA256
CA0B57889D701230F279115CF4167D24607E7DA56E7E411487FFB367EFAC3E86.
Aviso de tamanho de bundle permanece, não é medição de performance.

Lote novo **ainda sem ensaio visual de atraso no navegador** e fora da r67.
Não repetir os ensaios de vídeo/hardware apenas pela atualização de status.

## O que falta

6.1: atraso/falhas/concorrência no navegador para este build, fechamento das
interfaces de raízes/scan, categorias e integrações, incluindo remoção e
reconferência sem caixas nativas. Scan real/probe/QC não foram testados aqui.
6.3: fluxo visual completo de contas/sessões permanece aberto. A habilidade
computer-use limita alterações de segurança por UI; nenhuma criação/edição de
conta, troca de senha ou permissão foi automatizada. Backend tem suas provas
separadas; isso não substitui homologação visual.

Sem mudança operacional, limpeza, build instalada, hardware, teste de rede
remota ou homologação de proxy/TLS. Grupo8 v3.
Totais10 grupos/53 verificações:6 concluídas/36 em andamento/4 pendentes/7v3.

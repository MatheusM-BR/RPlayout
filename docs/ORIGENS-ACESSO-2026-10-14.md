# Origens de acesso — configuração explícita e recusa segura

Lote 6.4 posterior à r66, implementado na fonte/servidor compilado. Requisito
continua **em andamento**; não é homologação geral de acesso remoto.

## Comportamento

`RPLAYOUT_ALLOWED_ORIGINS` agora usa um parser compartilhado pela configuração
de CORS e pela guarda HTTP/WebSocket. Validação ocorre no início de `main`,
antes de criar/ativar a aplicação, banco ou runtime. Registro de rotas também
valida a configuração, em vez de aceitar uma lista arbitrária por outra entrada.

- Vazio mantém acesso pela origem da própria página; não abre CORS para todos.
  Controlar pelo endereço do servidor, inclusive numa outra máquina, não exige
  cadastrar a máquina de controle como origem extra.
- Extras devem ser origens HTTP/HTTPS explícitas: protocolo, host e porta.
  Caixa do hostname, portas padrão e slash final são normalizados; duplicadas
  são removidas. IPv6 com colchetes é suportado.
- Configuração com `null`, curingas (também codificados no hostname), credenciais,
  caminho além `/`, query, fragmento, controle/backslash, entrada vazia no meio
  da lista ou protocolo diferente é recusada inteira. Sem fallback permissivo.
- Limites:64 entradas/2048 caracteres por entrada; não trunca a autoridade.
  Erro informa índice e formato esperado, sem repetir o valor fornecido.
- Origin de requisição precisa ser serializado válido e exato. `null`, vazio,
  URL com caminho/credenciais ou header malformado não passam por inclusão numa
  lista legada. Ausência de Origin permite CLI/serviço, ainda sujeitos à sessão
  e às permissões. Uma origem extra não autoriza comando nem cria sessão.
- Comparação da autoridade própria normaliza caixa, porta padrão e IPv6;
  não concede outra porta/host nem aceita userinfo/caminho no header Host.

Exemplo técnico válido para UI de desenvolvimento separada:
`RPLAYOUT_ALLOWED_ORIGINS=http://localhost:5173,https://controle.example`
Não use a URL de uma tela, senha, chave ou `*`. Configuração vazia é o caso
normal da interface servida pelo próprio RPlayout. Cookies/HTTPS/proxy não foram
relaxados para tornar esse ensaio positivo. Alterar essa configuração exige
reinício planejado do servidor; não houve mudança no servidor operacional.

## Validação

45 casos dirigidos PASS:25 política de origem +20 acesso/sessões existentes
afetados pela guarda. Tipos servidor PASS; build servidor PASS. Não repetida
bateria nativa/ingestão nem geração de ZIP somente por alteração de status.

Prova compilada: `scratch/http-origins-ac50DO/result.json`, PASS/exit0,
SHA256 79F6358D43E29EAA436F7774930F3730135C8445CB52EE655118880675C2B335.
Script `scripts/verify-http-origin-policy.mts`; todos os bancos, contas e
processos são próprios. Engine, broker, probe/proxy, relays e dispositivos
desativados; zero as-run, nenhum TAKE executado.

1. Cinco partidas inválidas (`null`, `*`, credencial em URL, caminho/query,
   vírgula final) encerraram exit1. Bancos/cofres dos casos não foram criados;
   listeners não estavam disponíveis. Fonte confirma validação antes da
   criação da app/listen. Credenciais de fixture ausentes do diagnóstico.
2. Lista válida normalizada de HTTP/HTTPS/IPv6 aceitou GET autenticado200,
   com CORS refletindo apenas a origem explícita. Sem cookie retornou401 para
   todas as três origens. Permitir CORS não autorizou ler o estado.
3. Seis origens opacas/não cadastradas/malformadas negadas403 com cookie válido,
   sem reflexão do Origin em Access-Control-Allow-Origin.
4. Página na origem do próprio servidor e CLI com cookie continuaram200.
5. Preflight OPTIONS204 aceitou headers/método da origem cadastrada;
   POST TAKE subsequente sem sessão foi401, antes de operar qualquer canal.
6. WebSocket da origem extra explícita foi aberto/fechado; `null` e origem
   estrangeira foram403. Há17 casos HTTP e três resultados de WS registrados.
7. Credencial/cookie de fixture não apareceram no log INFO. Servidor próprio
   encerrado. Não foi acessado `control.example`: só usado como header/lista
   sintética, com todas as conexões em127.0.0.1.

## Ainda falta

Origem não é política de hostname/DNS de destino. O header Host ainda não é
conferido contra uma lista de endereços reais do servidor; essa proteção,
aliases personalizados e cenários de DNS/proxy permanecem abertos. Comparar
Origin/Host não substitui esse controle nem prova TLS.

Fechamento integrado do cofre/configuração/backup e runtimes, implantação TLS,
navegador remoto com cookies, restrições reais por estação, falhas/recuperação
e integração instalada também continuam necessários. Foi solicitada ao
operador a URL usada remotamente, sem senhas/chaves, para não bloquear um alias
real quando a admissão de Host for integrada. Não repetir perguntas de hardware.

Este lote e o anterior de privacidade HTTP **não estão na r66**, que foi
preservada. Não houve limpeza, nova instalação, publicação no GitHub ou
qualificação física. Totais mantidos:10 grupos/53 verificações —6 concluídas,
36 em andamento,4 pendentes,7 reservadas à v3.

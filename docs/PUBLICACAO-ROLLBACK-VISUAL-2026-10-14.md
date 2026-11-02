# Publicação e rollback — lote local de 14/10/2026

Requisitos 4.1 e 4.5 continuam **em andamento**. Este lote corrige a interface
e comprova parte do fluxo visual; não homologa o grupo inteiro.

## Implementação

- Simulação/histórico, atualização editorial e conferência de rollback usam
  consultas GET com prazo de 10 segundos. Troca de contexto e desmontagem
  cancelam leituras antigas; falha em uma consulta do par cancela sua irmã.
- Falha não é catálogo vazio. Publicação/restauração ficam bloqueadas até
  uma nova conferência explícita, com motivo acionável na página.
- Publicação e confirmação de rollback têm guarda imediata contra clique
  repetido. Não recebem sinal de cancelamento de consulta: uma escrita já
  enviada não é anunciada como desfeita por timeout ou troca de tela.
- Após commit, o sucesso só aparece depois da leitura/carga confirmada.
  Falha posterior informa a revisão gravada e sincronização não confirmada.
  Seleção é reconferida antes de solicitar outra carga e depois da resposta;
  sair e voltar à mesma data/canal não torna uma resposta antiga atual.
- Fechar o histórico cancela a conferência de rollback pendente; ela não
  deve abrir um diálogo atrasado depois do fechamento. Esse último guard
  foi incluído no fechamento do lote, sem cenário visual de atraso ao fechar.

## Validação direcionada

27 testes PASS: 7 snapshot pós-publicação, 3 API/abort, 5 política de leitura,
11 contratos existentes de contexto e 1 correspondência da conferência.
Tipos web PASS. Build web PASS, com aviso existente de tamanho do bundle.
Não foi executada regressão global nem repetida validação nativa inalterada.

## Conferência visual e recibos reais

Fixture: `scratch/operational-review-browser-lOAOuP`.
Script: `scripts/verify-operational-review-browser.mts`.
Gateway apenas de atraso GET; servidor compilado real, banco/vault/usuário
sintéticos próprios. Engine, MediaMTX e saídas desativados. A fonte NDI de
fixture não transmite: não é prova de sinal NDI ou de proteção física do PGM.
Instância operacional e aba do usuário não foram alteradas.

1. Consulta demorada encerrou em 10,003s (a leitura inicial em 10,011s).
   Tela bloqueou publicação, liberou Atualizar e conferir e não afirmou
   ausência de publicações. Reabertura mostrou revisão 2 e diff de título.
2. Publicação criou revisão 3 uma vez (HTTP 201). GET posterior encerrou em
   10,002s. Tela informou revisão gravada/sincronização não confirmada,
   sem botão verde de sucesso nem replay automático da escrita.
3. Primeira conferência de rollback encerrou em 10,004s. Nenhuma revisão
   foi restaurada nessa leitura; houve mensagem e reabertura explícita.
4. Após recarregar a versão final, conferência da revisão 1 mostrou diff
   contra a revisão 3. Confirmação criou a revisão 4 (HTTP 200) uma vez;
   tela mostrou histórico 4/3/2/1 e rascunho ainda “Estúdio editorial C”.
5. Banco confirmou revisão 4 ativa com título “Estúdio publicado A” e
   `restoredFrom.revision=1`, revisões iniciais byte-a-byte preservadas,
   duas decisões do operador sintético (publicar/restaurar) e zero as-run.
   Aba própria fechada e encerramento do servidor observado.

O resultado automático da fixture conserva `browserValidated:false`: não
transforma interação manual em certificação automática. O verificador de
recibos `scripts/verify-operational-review-evidence.mjs` confere os fatos
SQL/conexões separadamente; este documento registra a observação visual.

Assets: timeouts observados em `index-qwoXHQgZ.js`, SHA256
E7B91EDCE6BF613DF638CA2F28923549ED1BEDFF3DC5B59497AAAD088C3F2519.
Fechamento do histórico/guard de cancelamento incluído depois; restauração
observada após reload de `index-D6kw1rzP.js`, SHA256
A1CC19FA03FDA1CE6561EB82596E17190AC004F7E73F6B2BD1772E879A62403E.
Servidor inalterado SHA256
E5E95ECDB75DFBD2B597C0C11709C73B2340233F20F0C5DE869311A5FBA03CDD.

Screenshots: `comparison-timeout.png`, `publication-committed-timeout.png`,
`rollback-timeout.png`, `rollback-confirmed.png` na pasta da fixture.

Primeira tentativa não chegou ao navegador: execução restrita não confirmou
readiness e a coleta final usou a coluna inexistente `actor`. Coluna corrigida
para `actor_username`; ensaio seguinte com acesso loopback autorizado PASS.
Artefatos iniciais `scratch/operational-review-browser-gGNQjE` preservados.
Esperas do navegador com deadline curto retornaram timeout enquanto a leitura
ainda estava em progresso; estado seguinte confirmou os avisos do produto.

## Ainda falta

- Troca visual de data/canal durante POST/carga, incluindo sair/voltar;
  falhas concorrentes e proteção de CUE/PGM no navegador com engine real.
- Ensaiar fechamento do histórico enquanto a conferência GET está atrasada.
- Integrar publicação urgente, live prioritária, compensação e retomada no
  mesmo fluxo nativo; qualificar também em estação remota.
- Integrar este lote no próximo instalador. **A r65 não contém estas mudanças**;
  não houve nova instalação, Windows limpo ou publicação no GitHub neste lote.

Totais mantidos: 10 grupos, 53 verificações; 6 concluídas, 35 em andamento,
5 pendentes e 7 reservadas à v3. DeckLink física segue adiada, NDI/OMT externos
indisponíveis e liberação de redistribuição ainda aberta. Nenhuma limpeza.

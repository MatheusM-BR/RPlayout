# RPlayout r79 — parcial instalável para teste interno

Destino previsto: `release/RPlayout-1.1-parcial-20261016-r79-instalador.zip`.
Registrar tamanho/hash/integridade externamente após geração.

Registro externo pós-geração:540.388.970bytes, SHA256
`DC4BA09DEB545FB8A081242C47B696031259AFE6A529DAD4DF9E0D1034BA49FE`.
Integridade PASS:7.094hashes/7.095entradas emmemória, sem extração/instalação.
`scratch/r79-zip-integrity-20261016/result.json`; engine191CD1E1 confirmado.
Detalhes do lote em `LAUNCHER-PORTA-IDENTIDADE-2026-10-16.md`.

Inclui a r78 e corrige o launcher:

- Uma porta validada governa partida, verificação e endereço da página.
  Padrão4000; aceita PORT ou `--port=NUMERO` (opção explícita prevalece).
  HOST específico/IPv6 é considerado, sem alterar firewall ou endereço remoto.
- Porta ocupada não é prontidão: compara identificação privada da instalação,
  banco e processo com resposta HTTP local da instância. Outra instalação,
  perfil, processo ou registro antigo é recusado sem encerrar o serviço.
- A identificação é publicada com proteção de arquivo somente após listen.
  Endpoint local não divulga caminhos/credenciais, recusa Origin, metadados
  de navegador e encaminhamento. Não é login ou permissão de TAKE.
- Node portátil não herda NODE_PATH/NODE_OPTIONS globais. Servidor próprio
  fica em job do Windows: encerramento usa identificadores do SO, não taskkill
  de um PID antigo. Abertura que reutiliza servidor não controla esse job.

Launcher SHA256
`101A28C9E55C5A826B9805804F10853227D539B9A98CC4B018DDEC81F9DC82B8`;
servidor SHA256
`6E061188E72EEB5FAE57666C5B2717E51D736C085F267638C94B2783CCE7023D`.
Engine191CD1E1 e web8B0D3FCB preservados; sem teste de mídia repetido por status.

65 testes TS +12 Rust distintos PASS; tipos servidor e builds servidor/launcher
release locked PASS. Três testes de conexão Rust precisaram de loopback fora
do ambiente restrito; espera do teste foi limitada, tentativa interrompida não
é aprovação. Falha inicial de caminho de tsc corrigida no comando, não produto.

Integração real MPdJnf PASS em fixture portátil isolada (não instalação r79):
oito cenários de colisão, porta inválida/configurada, opções Node globais
inválidas excluídas, reuso, perfil diferente, identidade antiga, acesso local
restrito e encerramento do Node próprio. Partida3666,55ms; nenhum engine/PGM
ou saída física. Serviço falso próprio preservado durante os testes; nenhum
serviço operacional alterado. Todos os launchers próprios encerrados.

Instalador/startup da edição completa r79 NOT_RUN. Prova de instalação r78
não é transferida para r79; fixture pequena não homologa dependências da
edição completa, interação dos jobs com engine/MediaMTX, Windows limpo,
upgrade/rollback, sinal externo/físico, remoto ou soak. Não reutiliza servidor
antigo/manual sem identificação; encerre o predecessor explicitamente, sem
forçar parada. A identificação local não protege contra administrador/processo
com acesso de escrita à própria instalação/conta Windows.

Runtimes/Node/módulos/SQLite incluídos; não exige tsx/tsc/pnpm globais.
Redistribuição REVIEW_REQUIRED: falta acordo original NDI. Driver DeckLink
externo/validação física adiada; grupo8v3. Sem limpeza, migração ou mudanças
de dados/contas/rede operacional; releases/evidências anteriores preservadas.

10grupos/53verificações:7concluídas/35andamento/4pendentes/7v3. Parcial, não
entrega final homologada.

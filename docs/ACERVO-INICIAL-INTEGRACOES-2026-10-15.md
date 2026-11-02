# Grupo 6.1 — carga inicial do acervo e integrações

## Resultado

Corrigida na fonte a dependência indevida entre abrir a operação e consultar
o acervo. Sessão/estado/grade têm um prazo conjunto de 10 segundos. A consulta
de pastas/scan/categorias ocorre separadamente, também limitada a 10 segundos.
Falha desse segundo conjunto não impede Master/Playlist/QC de abrir, não limpa
um catálogo já conferido e não envia comandos de playout.

Consultas do mesmo contexto compartilham uma execução e uma publicação.
Mudança de canal/sessão cancela somente leituras e limpa metadados anteriores;
resposta atrasada não pode reinstalar o acervo de outro contexto. Gravações
não recebem cancelamento. GET de sessão/acervo aceita signal, canal Unicode
é codificado na URL. Há aviso persistente e reconsulta na página.

Master, Playlist e QC recebem explicitamente o estado de primeira consulta:
não apresentam ausência de resposta como catálogo vazio. Contagens do QC
ficam N/D; a operação da grade permanece separada dessa indicação.

33 testes / 6 arquivos PASS, checagem de tipos web PASS. Builds web/servidor/
engine release locked PASS. Avisos preexistentes: tamanho do bundle web,
deprecated/dead_code Rust. Não são evidência de carga prolongada homologada.

## Evidência instalada r68: resultado parcial, não certificação geral

`scratch/editorial-read-browser-FxphMe/result.json` e
`assertions-installed-editorial.json`, gerado por
`scripts/verify-editorial-read-evidence.mjs`: PARTIAL_PASS.

Produto r68 intacto: servidor 5F33C58E, web Cc-PfGGg/E80385B2. Node incluído;
controlador de QA utiliza tsx e fixture de banco da fonte, não é requisito
para iniciar o produto. Instância/banco/conta/mídia/receptor são sintéticos,
loopback; engine, broker e saídas desligados. Não houve dados operacionais.

- Categorias, navegação de pastas, catálogo/fila de integrações, editor e
  conferência de entrega abortaram GETs em aproximadamente 10 segundos.
  Máximo de uma consulta simultânea por endpoint de catálogo/fila do painel.
- Reabertura explícita recuperou dados. Nome do gateway alterado uma vez
  para `Gateway QA revisado Çãó`; permaneceu desativado, sem alteração de URL.
- Dois pedidos UI de teste com a mesma identidade produziram uma entrega e
  um POST. Um reenvio de entrega sintética produziu outro POST: exatamente
  dois IDs/POSTs no receptor local, idempotency-key correspondente e dois
  registros DELIVERED. Auditoria: alteração 1, teste 1, reenvio 1; API_MUTATION 4.
- Consentimentos de teste/reenvio iniciaram desmarcados. Não foram alteradas
  contas/permissões/credenciais, nem removidos dados pela interface.
- As-run 0, mutações de conta 0; aba própria fechada e processo encerrado.

Falha encontrada e preservada: a carga GLOBAL de categorias não tinha o prazo
do painel; aguardou 25 segundos/504 e houve concorrência máxima 2. A r68
continua contendo essa falha. Não reinterpretar PARTIAL_PASS como PASS global.

## Regressão da fonte, sem adulterar a r68

O controlador recebeu opção explícita `--source-web`: servidor/Node instalados
r68 com web compilada da fonte através de RPLAYOUT_INSTALL_ROOT. Manifesto da
fixture registra `sourceWebOverride`, caminho e hash. Nenhum arquivo instalado
foi sobrescrito. Isso NÃO é homologação de outra instalação.

- `scratch/editorial-read-browser-bfRYn8`: web BQN1XvLH,
  SHA256 4548101b98f28ad44eb0d60cb25801569976dd36bdfbf65393825ffb48769e3d.
  Operação abriu antes do término do GET bloqueado. Três GETs de categoria
  encerrados em 10000–10003 ms, máximo simultâneo 1, sem 504. Reconsultas
  repetidas compartilharam a leitura ativa. Removida a falha, polling recuperou
  acervo sem recarregar/login. As-run/mutações/POSTs 0; processo encerrado.
- `scratch/editorial-read-browser-Rb3ouu`: web DBqnax3p,
  SHA256 cb7a550addf5d921580f983a1a3ef66064e1727814e509719897f9904f59f854.
  Observados Master/Playlist/QC com acervo não conferido e QC N/D; sem fatal
  de carga inicial. Recuperação por reconsulta exibiu total 0 somente após
  resposta válida do catálogo sintético vazio. Asserções de transporte PASS,
  máximo simultâneo 1, as-run/mutações/POSTs 0; processo e aba encerrados.
  Imagens: master-nao-conferido.png, playlist-nao-conferido.png,
  qc-nao-conferido.png e qc-recuperado.png. Viewport de teste limitado;
  não comprova todos os tamanhos de tela.

Depois dessa observação, o rodapé secundário da Playlist também deixou de
exibir `0 clipes listados` antes da consulta. Última compilação B4CsWAEs,
SHA256 3F13498EA4D12EA450886C8A4B37EC56754FEBF8A665219727155E4BD7DC4FD8;
essa última mudança textual teve build, não nova rodada de navegador.

## Limites e continuidade

ZIP r69 incorporado/verificado: 540186632 bytes, SHA256
5E51B978F35F3AF1229753BC9C08509AE46337509C218C4B0E03483D2FCE6C3C;
7094 arquivos de manifesto/7095 entradas PASS. Não instalado/iniciado.
Falta qualificar instalação/interface
completa, acesso remoto, proxy/HTTPS, alterações de segurança por operador,
remoções e cenários restantes do grupo. A navegação automatizada ficou no QA,
sem alterar controles de acesso/privacidade do sistema operacional ou produto.
DeckLink física adiada; não existem emissores externos NDI/OMT disponíveis.
Não houve conexão a 192.168.42.172. Localhost só representa a máquina onde o
navegador está; controle remoto usa IP/nome e porta do servidor, sem fixar IP.

Os 33 testes de software não são 33 requisitos encerrados. A matriz permanece
10 grupos/53 verificações: 6 concluídas, 36 em andamento, 4 pendentes e 7 v3.
Grupo 8 permanece adiado por decisão do usuário. Não houve limpeza/migração
ou publicação final neste lote.

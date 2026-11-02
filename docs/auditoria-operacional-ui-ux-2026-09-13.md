# Auditoria operacional e UI/UX — RPlayout — 13/09/2026

## Escopo verificado

A revisão percorreu launcher Windows, servidor Fastify, domínio de engine, GStreamer, MediaMTX/WHEP, acervo, grade, automação, saídas, auditoria, diálogos e frontend React. Também foi conferido o artefato servido por `localhost:4000`, para evitar validar uma build diferente da executável.

## Fluxo operacional, passo a passo

1. `rplayout-test.exe` encontra a raiz da instalação e verifica `apps/web/dist/index.html`.
2. O launcher sobe o servidor e injeta os caminhos do engine, probe, relay, devices e MediaMTX.
3. O servidor inicializa banco, canais, saídas e reconciliação do acervo.
4. A interface consulta o snapshot e mantém WebSocket/reconsulta periódica.
5. Ao selecionar um arquivo, o preview é preparado sem alterar o PGM.
6. `TAKE` envia o item ao engine; o engine valida arquivo, decoder e transição.
7. Arquivo ausente/recusado é sinalizado e pulado quando existe candidato válido.
8. PGM, PVW, RTMP, SRT e demais saídas são controlados por perfil; monitores são sob demanda.
9. AsRun registra os itens efetivamente no ar; auditoria registra ações administrativas.
10. Ao fechar o launcher, a árvore de processos é encerrada com `taskkill /T /F`.

## Mudanças concretas desta revisão

- PGM do painel passou a usar o fluxo `/pgm` com áudio, em vez do `/mon` reduzido que podia chegar sem trilha.
- Recepção de trilha WebRTC marca `MediaStreamTrack.enabled = true`; o gesto no speaker chama `play()` e libera o áudio conforme a política do navegador.
- Removida a barra de posição duplicada dos monitores; o controle de volume aparece no hover/foco do speaker.
- Removido o texto de arquivo/preparação no rodapé.
- PGM FIXADO bloqueia roda/toque e também o overflow do pane externo.
- Diálogos ganharam largura responsiva, cabeçalho/rodapé fixos, overflow horizontal bloqueado e melhor área de conflito.
- Auditoria passou a usar tabela responsiva sem rolagem horizontal.
- Marcador vermelho do corte foi removido de cima do quadro; a marcação permanece na régua inferior.

## Validação automatizada

- `pnpm test`: **21 arquivos, 164 testes, todos passaram**.
- `pnpm typecheck`: pacotes server, web, protocol e scheduler passaram.
- `cargo test --manifest-path apps/engine/Cargo.toml`: **38 testes Rust passaram**.
- `pnpm --filter @rplayout/web build`: passou; bundle atual `index-Bc28U7s6.js`/`index-BjlDw0KB.css`.
- `pnpm --filter @rplayout/server typecheck`: passou.
- `gst-inspect-1.0 opusenc`: encoder Opus disponível nesta máquina.
- O endpoint local confirmou que a página servida referencia o bundle novo; o launcher antigo foi encerrado para impedir reutilização.

## Procedimento de teste manual

1. Encerrar qualquer `rplayout-test.exe` antigo pelo launcher, nunca pelo engine isolado.
2. Abrir [rplayout-test.exe](../rplayout-test.exe) e confirmar `http://localhost:4000`.
3. Selecionar uma linha da grade e conferir PVW sem alterar PGM.
4. Clicar no speaker do PVW/PGM; confirmar que o ícone muda e que o navegador não está silenciado na aba.
5. Executar TAKE e observar a linha `NO AR`, o tempo restante e a terceira posição com **PGM FIXADO**.
6. Ativar PGM FIXADO e tentar roda, touch e barra lateral; a grade deve permanecer travada.
7. Abrir Auditoria, filtrar usuário/ação/data e baixar CSV; a tabela não deve criar scroll horizontal.
8. Abrir Marcação de entrada e saída; o vídeo deve aparecer e a linha vermelha deve estar somente na régua.
9. Desligar/ligar perfis em Saídas e confirmar alteração sem reiniciar o servidor.
10. Remover uma pasta, atualizar o acervo e confirmar que arquivos ausentes ficam sinalizados.

## Pontos que ainda exigem conferência física

A automação não consegue certificar sozinho a saída NDI/SDI de placas específicas, o dispositivo de áudio escolhido pelo Windows ou a política de autoplay de cada perfil do Chrome. Se o speaker continuar sem som após o clique, o próximo diagnóstico deve capturar o SDP WHEP e o estado da trilha no MediaMTX; a origem `/pgm` já foi confirmada com áudio no navegador.

## Referências de UX operacional

A organização adotada segue a separação de rundown, painel de controle, monitor e ações rápidas documentada por [Cinegy Air](https://home.cinegy.com/products/cinegy_air/), [PlayBox Neo](https://playboxneo.com/playout) e [Grass Valley Playout X](https://www.grassvalley.com/products/homepage-products/playout/).

# Manual de uso do RPlayout

**Versão 1.1 · operação, programação, saídas e diagnóstico**

Este manual explica o uso diário do RPlayout e registra a correção da abertura de **SAÍDAS E PROCESSOS**: o botão agora abre um único painel dentro da tela do operador, sem criar uma aba duplicada no navegador.

## Telas e fluxo

1. **Operador/Master** — acervo à esquerda, grade no centro, PGM/PVW e conflitos à direita.
2. **Acervo** — `+ PASTA` abre o explorador do Windows; somente vídeos entram; `REMOVER PASTA` remove a origem da indexação.
3. **Grade** — preparar, executar TAKE, parar, mover e remover itens; `PGM FIXADO` acompanha o item no ar e bloqueia a rolagem.
4. **PGM/PVW** — ícone de alto-falante ativa o áudio; a barra vermelha abaixo do vídeo permite seek; o VU permanece visível.
5. **Saídas e Processos** — RTMP, SRT, arquivo, DeckLink, publishers, PID, CPU, memória, timeline e saúde em um único painel.
6. **Playlists** — importação M3U/M3U8/CSV/TXT, programação por data, blocos ao vivo e publicação na grade.
7. **Usuários** — login, papel e ativação/desativação de contas.
8. **AIRED/Auditoria** — histórico do que entrou no ar, filtros e exportação CSV.
9. **IN/OUT** — vídeo, marcadores I/O e comandos de salto na mesma janela.

## Operação básica

- Selecione um item do acervo e adicione-o ao fim da grade.
- Clique **PREPARAR** para carregar o PVW.
- Confira imagem, duração, áudio e conflitos.
- Clique **TAKE** ou pressione espaço.
- Use **PARAR** somente quando precisar interromper o ar.
- Ative **PGM FIXADO** para manter a linha no ar na terceira posição e impedir a rolagem manual.

## Acervo e pastas

Clique `+ PASTA`, escolha a pasta no explorador e confirme. O nome selecionado aparece na árvore. PNG/JPEG são ignorados. Remover uma pasta retira a origem do acervo e não apaga arquivos do disco.

## Áudio e seek

PGM e PVW iniciam sem áudio. Clique no alto-falante para ouvir; passe o mouse sobre ele para revelar o volume. Arraste a barra vermelha abaixo do vídeo para escolher o ponto da mídia. O áudio WebRTC depende da trilha Opus publicada pelo endpoint e do volume do navegador.

## Saídas e processos

Clique **SAÍDAS E PROCESSOS** na barra inferior. O painel é interno e único. Filtre por tipo (`engines`, `saídas RTMP/SRT`, `MediaMTX`) e por canal. Ligue/desligue perfis e consulte saúde, timeline e eventos. Monitores não usados podem permanecer desligados para reduzir consumo.

## Playlists 24h

Abra **PLAYLISTS**, escolha a data, importe o arquivo, corrija itens sem arquivo, inclua blocos ao vivo e publique no fim ou no próximo bloco. A publicação atualiza a grade sem apagar o histórico Aired.

## Usuários

Abra **USUÁRIOS**, crie o login, escolha o papel e ative o acesso. O papel define as ações disponíveis. **SAIR** encerra a sessão atual.

## Diagnóstico rápido

- **SINTONIZANDO:** confira o estado do engine e do MediaMTX em Saídas e Processos.
- **Sem áudio:** clique no alto-falante, verifique o VU e confirme a trilha Opus no endpoint.
- **Arquivo ausente:** remova o item da grade ou corrija a origem no acervo.
- **Conflitos:** abra a área de conflitos e use a sugestão apresentada; exporte o CSV de saúde quando necessário.

## Capturas de tela

As capturas usadas neste manual ficam em `docs/screenshots`:

- `webrtc-pgm.png` — PGM em endpoint do navegador com controle de áudio.
- `trim.png` — marcação de entrada e saída.
- `conflitos-rodape.png` — conflitos e mensagens operacionais.

## Referências

- `docs/RPLAYOUT-1.1-FUNCIONALIDADES.md`
- `docs/ROADMAP-XPAYOUT-BENCHMARK.md`
- `docs/auditoria-funcionamento-2026-09-13.md`
- `docs/auditoria-operacional-ui-ux-2026-09-13.md`

### Capturas adicionais

As capturas reais usadas no documento DOCX ficam em `docs/screenshots/manual` e cobrem:\n\n- Operador e grade principal.\n- Acervo e seleção de pasta.\n- PGM/PVW com áudio e medidores.\n- Marcação IN/OUT com preview.\n- Ações consolidadas de saída.\n\nA imagem que mostrava a organização de playlist do RW VideoWall foi removida porque pertence a outro aplicativo. A organização de playlists do RPlayout está descrita na seção Playlists 24h e deve receber uma captura própria quando essa tela for executada no RPlayout.


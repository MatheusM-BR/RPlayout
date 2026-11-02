# RPlayout r33 — instalador parcial para teste

Inclui a correção WHEP da r32 e novos proxies de arquivo que preservam a
proporção da imagem: 16:9, 4:3 e vertical, em até 426x240, 10 fps e 220 kbps
de vídeo, com áudio. As faixas pretas pertencem ao player, não ao arquivo proxy.
O campo de visão e as safe areas podem acompanhar o raster real.

Migração46 identifica a receita do cache. Proxies antigos não recebem essa
identidade por inferência: ao consultá-los, o QC solicita regeneração explícita.
O original, o arquivo antigo e a edição são conservados. O servidor só aceita
um novo proxy se o executável confirmar a receita picture-raster-v2.

Extraia TODO o ZIP e execute INSTALAR.cmd em uma pasta NOVA. Faça backup de
dados e cofre antes de migrar. Não é Setup.exe assinado e não inicia o servidor
automaticamente. Inclui Node, dependências de produção/SQLite, GStreamer e
runtimes NDI/OMT/MSVC; não exige instalar pnpm, tsx ou tsc.
DeckLink requer o driver oficial Blackmagic Desktop Video.

58 testes afetados e tipos servidor passaram. Dois testes nativos passaram,
incluindo transcodificação/decodificação reais com áudio, caminhos Unicode e
três proporções. Apenas servidor e gerador de proxy foram recompilados; web e
engine principal permanecem os da r32. Este instalador não foi instalado ou
homologado em Windows limpo. Ainda falta conferir arquivos e safe areas no
navegador real; não aprovado para operação no ar.

Total: 10 grupos, 1 concluído e 9 abertos; 53 verificações de fechamento,
5 concluídas, 23 em andamento e 25 pendentes. Nenhum grupo é encerrado pela
parcial; releases anteriores não foram excluídas.

Registro externo após empacotamento (não incluído no LEIA-ME interno):
536325401 bytes; SHA-256
DA2EC6CEFD81304C44212024BD159656DE05BFF8CF33B97C7B127D4BE670DDE7.

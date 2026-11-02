# RPlayout r34 — instalador parcial para teste

Inclui o fluxo QC integrado: proxy leve com proporção preservada, acesso ao
original pelo botão Ver em qualidade e safe areas sobre a imagem, desligadas
por padrão. Também corrige o texto da lista Ignorados: ignorado ou em quarentena
não significa necessariamente rejeitado no QC.

Inclui as correções da r33, a receita picture-raster-v2 e a recuperação WHEP.
O fluxo isolado de arquivos H264/AAC foi observado no servidor compilado e no
navegador em 16:9, 4:3 e vertical. Isso não homologa formatos adicionais,
hardware físico, desempenho remoto ou operação no ar.

Extraia TODO o ZIP e execute INSTALAR.cmd em uma pasta NOVA. Faça backup de
dados e cofre antes de migrar. Inclui Node, dependências de produção/SQLite,
GStreamer e runtimes NDI/OMT/MSVC; não exige pnpm, tsx ou tsc na máquina de destino.
DeckLink requer o driver oficial Blackmagic Desktop Video.

Pacote parcial solicitado sem teste do instalador. Não é Setup.exe assinado,
não inicia o servidor automaticamente e não foi homologado em Windows limpo.
Não aprovado para operação no ar. Nenhuma release anterior foi excluída.

Total: 10 grupos, 1 concluído e 9 abertos; 53 verificações de fechamento,
5 concluídas, 23 em andamento e 25 pendentes.

Registro externo após empacotamento (não incluído no LEIA-ME interno):
536325207 bytes; SHA-256
A3EE07903A55E7F9E569B37C03BB13D23A98E8D0937E0DDC08454E81D76D210F.
Alterações posteriores de fallback JPEG ainda não fazem parte da r34.

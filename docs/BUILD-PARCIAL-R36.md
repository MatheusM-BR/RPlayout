# RPlayout r36 — instalador parcial para teste

Inclui r35 e a extração QC por quadro: a inspeção em qualidade não espera mais
a fita completa de 24 JPEGs. Somente o quadro solicitado é gerado, com busca
precisa e preparação pausada do decoder. A régua permanece leve. JPEG é
publicado por gravação/rename antes de confirmar conclusão; cache novo não
reutiliza os quadros anteriores com posicionamento aproximado.

Prova nativa de GOP longo: quatro posições, timestamps correspondentes e quatro
JPEGs diferentes, um arquivo gerado por chamada. HTTP compilado FFV1 respondeu
em 845ms gerando somente um JPEG; antes a fita24 levou7644ms em outra execução
da mesma família de fixture. Não é benchmark controlado ou homologação remota.
12 testes nativos e12 testes HTTP/lifecycle passaram, tipos e builds passaram.

Extraia TODO o ZIP e execute INSTALAR.cmd em uma pasta NOVA. Faça backup de
dados/cofre antes da migração. Node, módulos de produção/SQLite, GStreamer e
runtimes NDI/OMT/MSVC incluídos; pnpm/tsx/tsc não são exigidos no destino.
DeckLink requer o driver oficial Blackmagic Desktop Video.

Instalador parcial sem teste de instalação. Não é Setup.exe assinado, não
inicia o servidor automaticamente e não é homologado para operação no ar.
Novos caminhos de posição ainda exigem conferência visual de operação/remota;
sinais físicos, carga e redundância continuam separados e abertos.

Total10grupos:1concluído/9abertos;53verificações:5concluídas/23em andamento/25pendentes.

Registro externo após empacotamento (não incluído no LEIA-ME interno):
536351446 bytes; SHA-256
A5D249924C3FCE4D409820E3515CF84BC84647156BE10D96C0E25E094C14B607.

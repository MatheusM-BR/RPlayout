# RPlayout r37 — instalador parcial, não homologado

Inclui a r36 e o fluxo integrado de seleção de pastas e nomes de entradas.
O navegador apresenta as pastas do servidor na própria página. A confirmação
fica vinculada ao caminho revisado; ao alterar o caminho, a lista anterior
de subpastas deixa de aparecer até clicar em ABRIR. Caracteres Unicode são
preservados. O campo de nome da entrada fica abaixo da seleção da fonte e
mantém a identificação acessível; nomes sugeridos e apelidos manuais seguem
o fluxo de seleção existente.

Parcial criada antes de concluir as verificações desse fluxo, a pedido do
usuário. Nenhum teste de instalação foi executado. Não é uma versão homologada
para operação no ar nem comprova descoberta ou sinal de NDI, OMT ou DeckLink.

Extraia TODO o ZIP e execute INSTALAR.cmd em uma pasta NOVA. Faça backup dos
dados e do cofre antes de migrar. Node, módulos de produção/SQLite, GStreamer
e runtimes NDI/OMT/MSVC estão incluídos; pnpm, tsx e tsc não são exigidos no
destino. DeckLink continua exigindo o driver oficial Blackmagic Desktop Video.

O instalador não é um Setup.exe assinado e não inicia o servidor automaticamente.
Releases anteriores são preservadas. As verificações continuarão após a parcial.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações: 5 concluídas,
23 em andamento e 25 pendentes. Empacotamento não encerra essas pendências.

Registro externo após empacotar (não integra o LEIA-ME interno): 450385939 bytes;
SHA-256 360785BE618BE610AE4D4A355E64E937E573EF1E8FA5824973DD19474BA8CBA6.

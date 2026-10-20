# RPlayout r24 — build parcial para teste

Não homologada. Gerada a pedido do operador sem novos testes funcionais do
pacote ou do instalador. Não é a entrega final e não encerra as pendências.

Extraia TODO o ZIP do instalador e execute **INSTALAR.cmd**. Escolha uma pasta
nova ou aceite a pasta sugerida. A instalação é por usuário, sem necessidade de
administrador, e cria atalhos no menu Iniciar. Não abre o servidor automaticamente.
Abra **RPlayout Server**, depois **Master** ou **QC**. Para controlar remotamente,
acesse no navegador o endereço do servidor; confirme rede/firewall localmente.

O instalador é ZIP com instalador PowerShell, não um Setup.exe assinado. Inclui
Node, servidor compilado, módulos de produção/SQLite, interface, engine e
auxiliares, GStreamer, runtime NDI/OMT e MSVC app-local. Não precisa de tsx, tsc,
pnpm nem compilação na máquina de operação. Drivers físicos, como Blackmagic
Desktop Video para DeckLink, continuam necessários e não são instalados aqui.

Não sobrescreve instalações anteriores, dados ou cofre. Os hashes do manifesto
são conferidos na instalação; falha mantém os arquivos para diagnóstico.
Não migre dados de produção sem backup. Faça os testes em ambiente separado.

O fluxo scanner → proxy → QC → publicação → TAKE passou em ensaio local com
API compilada, vídeo/áudio reais e saída nula. QC bloqueado e perfil incompatível
preservaram o PGM; reaprovação permitiu o próximo TAKE. Isso não aprova a build
instalável, a interface visual, hardware DeckLink/NDI/OMT, redundância ou soak.

Pendências:10 grupos,1 concluído/9 abertos;53 verificações,4 concluídas/
17 em andamento/32 pendentes. Consulte o inventário numerado e a matriz para
os próximos passos. Engine/proxy e componentes atuais substituem os binários
antigos no novo pacote; r23 permanece preservado.

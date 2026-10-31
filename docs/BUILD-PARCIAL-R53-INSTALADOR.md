# RPlayout r53 — instalador parcial para testes

Inclui a r52 e o tratamento de recusa tardia da entrada ao vivo durante recuperação.
O ACK de abertura não é confirmação de PGM. Uma recusa nativa vinculada ao decoder
da tentativa permite no máximo quatro novas tentativas, com espera progressiva,
mantendo item, cursor, publicação e posse do canal. Timeout, falha de PVW ou decoder
antigo não autorizam repetir TAKE. STOP ou PGM confirmado cancelam a recuperação.

Extraia TODO o ZIP e execute INSTALAR.cmd. Escolha pasta NOVA. Faça backup do banco
e do cofre; não sobrescreva uma instalação em operação. Abra RPlayout Server e
depois Master/QC pelos atalhos. O servidor não inicia sozinho.

Node, módulos nativos e runtimes portáteis da base estão incluídos. Não precisa
instalar globalmente pnpm, tsx, tsc ou GStreamer para iniciar. DeckLink ainda exige
driver oficial compatível. Este pacote não é um Setup.exe assinado.

25 testes dirigidos, checagem de tipos e compilação PASS nesta integração.
Server SHA256: 97C072BBC0A72EBBACC23BB39584C2A9532AF1C4CA325BC6F70BC588657DE940.
Engine SHA256: AEBDED621B60041206BA45C4122B7BAE48DBCEBC0465A4B023559FB78E31201B.
O hash do engine acima é informado também pelo manifesto do pacote.

Não testado: instalação, recuperação completa com estes binários e reconstrução
de display após crash. Os ensaios anteriores qm2i5F/JE25xA/VddK8F falharam antes
de restaurar PGM; não são evidência de conclusão. A prova local mxilhz de imagem
e áudio durante emergência pertence aos binários da r52, não homologa esta edição.

Continuam abertos sinais físicos NDI/OMT/DeckLink, navegador remoto, HA entre
máquinas, operação prolongada, instalação limpa, upgrade, rollback e demais marcos.
Não usar esta parcial como entrega final para ir ao ar.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações: 5 concluídas,
26 em andamento e 22 pendentes. Testes individuais não encerram esses marcos.

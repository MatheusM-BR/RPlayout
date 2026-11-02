# RPlayout r54 — instalador parcial para testes

Inclui o engine atualizado para preservar o tempo salvo da entrada ao vivo após
reinício, o tratamento de recusa tardia da r53 e a recuperação de composição
gráfica confirmada: camadas simultâneas, propriedade, substituição manual e prazos
absolutos de exibição. Recuperação não dispara novamente SCTE/equipamentos.

A composição é persistida no recibo confirmado e vinculada ao checkpoint.
Comando incerto, composição alterada ou registro antigo sem imagem persistida
nunca autorizam restaurar um SHOW histórico. Deixas legadas já confirmadas na
mesma execução não substituem a composição recuperada. Arte de emergência usa
a imagem persistida, sem acionar novamente automações externas.

Extraia TODO o ZIP e execute INSTALAR.cmd. Escolha pasta NOVA. Faça backup do banco
e do cofre; não sobrescreva uma instalação em operação. Abra RPlayout Server e
depois Master/QC pelos atalhos. O servidor não inicia sozinho.

Node, módulos nativos e runtimes portáteis da base estão incluídos. Não precisa
instalar globalmente pnpm, tsx, tsc ou GStreamer para iniciar. DeckLink ainda exige
driver oficial compatível. Este pacote não é um Setup.exe assinado.

60 testes de software afetados, tipos e compilação do servidor PASS no lote.
Dois testes nativos de cursor e compilação do engine PASS na etapa anterior.
Server SHA256: 2A9512D5B1BF3864EB23EFDCB8508B90CB19D7FC43BDF1F2359178CD78779ABB.
Engine SHA256: 28916DE9F60DC035B95E958CB4788D48C1D68B2282C0D8D6442B9076C059AF23.

Criada antes do ensaio nativo integrado desta composição, sem teste de instalação,
conforme solicitado. A prova FsekVy de imagem/tempo da live pertence ao servidor
anterior EFF62925 com este engine; o teste completo falhou na composição então
ausente. Não transferir essa prova para homologação completa desta edição.

Continuam abertos hardware NDI/OMT/DeckLink, navegador remoto, áudio após crash,
perda de ACK, redundância entre máquinas, operação prolongada, instalação limpa,
upgrade, rollback e demais marcos. Não usar como entrega final para ir ao ar.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações: 5 concluídas,
26 em andamento e 22 pendentes. Testes individuais não encerram esses marcos.

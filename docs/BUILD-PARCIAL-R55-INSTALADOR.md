# RPlayout r55 — instalador parcial para testes

Inclui a r54 e o bloqueio de restauração de composição antiga após reconhecer
um comando nativo de resultado incerto. Reconhecer o incidente não comprova o
estado físico. Uma nova intervenção explicitamente confirmada define o novo
checkpoint gráfico. Recusa nativa definitiva não cria esse bloqueio de incerteza.

Extraia TODO o ZIP e execute INSTALAR.cmd. Escolha pasta NOVA. Faça backup do banco
e do cofre; não sobrescreva uma instalação em operação. Abra RPlayout Server e
depois Master/QC pelos atalhos. O servidor não inicia sozinho.

Node, módulos nativos e runtimes portáteis da base estão incluídos. Não precisa
instalar globalmente pnpm, tsx, tsc ou GStreamer para iniciar. DeckLink ainda exige
driver oficial compatível. Este pacote não é um Setup.exe assinado.

21 testes afetados, tipos e compilação PASS neste lote. Server SHA256:
9ED3338E7F0BB4523DDB55BD43494220B938E89548AFCB69AE99B40422CEC821.
Engine SHA256: 28916DE9F60DC035B95E958CB4788D48C1D68B2282C0D8D6442B9076C059AF23.

Criada antes do ensaio nativo específico deste bloqueio, sem teste de instalação.
RipsqZ PASS da r54 pertence ao servidor anterior: recuperação SRT própria com
tarja/cursor/identidade/as-run. Não transferir essa prova para homologação completa.
O novo ensaio injeta falha de persistência da confirmação após efeito nativo;
isso não equivale a perder o ACK no protocolo. Perda real de ACK ainda pendente.

Também faltam áudio após crash, cenários nativos de multilayer/emergência, hardware
NDI/OMT/DeckLink, navegador remoto, redundância entre máquinas, operação prolongada,
instalação limpa, upgrade, rollback e demais marcos. Não usar como entrega final
para ir ao ar.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações: 5 concluídas,
26 em andamento e 22 pendentes. Testes individuais não encerram esses marcos.

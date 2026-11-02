# RPlayout r41 — instalador parcial, não homologado

Inclui r40 e o lote de contexto/consulta dos incidentes. Novos incidentes PGM
guardam item, edição, execução, fontes e saídas reportadas na detecção; retry
não troca esse contexto pelo item seguinte. Endereços, credenciais e IDs de
fontes/perfis privados ficam protegidos. Contexto é cifrado no banco e validado
na consulta, sem confundir cadastro/prontidão com sinal físico.

Migração48 adiciona contexto nullable e índices de histórico por canal;
incidentes antigos continuam sem contexto explícito. Backup autentica versões
anteriores e valida contexto48/canal. ACK não resolve incidente nem elimina
o contexto original. Painel separa incidentes sem recuperação, observação
encerrada e contexto ausente; são registros históricos, não prova de sinal atual.

Consultas de distribuição têm prazo10s, cancelamento de leitura antiga e
proteção contra sobreposição do polling. A âncora histórica é mantida ao
voltar à primeira página, até MAIS RECENTES. Cancelamento não envolve TAKE,
ACK ou outras gravações. Conferência visual deste lote ainda em andamento.

50 testes distintos afetados aprovados em lotes dirigidos; tipos e builds
aprovados após correções. Ensaio compilado/native local ZWq3uF aprovou
contexto na API/fila configurada/migração48; arquivos sintéticos e saída nula.
Não são homologações de DeckLink, NDI, OMT, estação remota ou operação prolongada.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup dos dados
e cofre antes de migrar. Não volte um banco48 a pacote antigo como rollback
homologado. Inclui Node/módulos de produção/SQLite, GStreamer, NDI/OMT/MSVC;
pnpm/tsx/tsc não exigidos no destino. DeckLink requer driver oficial Blackmagic.

Instalação NÃO testada. Não é Setup.exe assinado nem inicia servidor sozinho.
Releases anteriores preservadas; não é entrega final para operação no ar.
Total:10 grupos —1 concluído/9 abertos;53 verificações —5 concluídas,
24 em andamento/24 pendentes.9.2 permanece em andamento.

Registro externo após empacotamento (não integra o LEIA-ME interno):
450442256 bytes; SHA-256
A046D95C7A4DB5827F4C55EB1352D21873EE013B70F5626E04735EF8D32AD548.
Revisão visual posterior aprovada no escopo local: contexto histórico,
âncora mantida ao voltar à primeira página, evento novo somente após reset,
prazo10s/retry por filtro. 31 consultas de saúde, máximo1 ativa,4 canceladas.
Engine da revisão visual desligado/as-run0; servidor próprio encerrado.
Não homologa instalação, hardware, estação remota ou operação prolongada.

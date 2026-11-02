# RPlayout r45 — instalador parcial, não homologado

Inclui r44 e preserva o snapshot original durante retry de gravação: o item
seguinte, um novo nome ou um novo estado não substituem o contexto da detecção.
Fontes PGM/PVW e publishers têm falha/recuperação/fim de observação persistidos
com atualização, fila e auditoria atômicas. Não executa TAKE nem altera grade.

Recuperação de fonte exige SIGNAL_OK com vídeo/áudio recentes; READY/cadastro
não resolve. Publisher exige onAir sem erro e entregas acima do baseline da
falha. Não prova recepção física. Desaparecimento, parada ou novo dono encerram
observação sem resolver. Contexto/ACK anteriores ficam preservados; retenção
não apaga falha ativa não resolvida após ACK. Posse de outro canal e quarentena
não autorizam gravação. Identidades HMAC/nome seguro substituem URLs/segredos.

Aliases de perda/retry/recuperação mantidos para os incidentes correlacionados.
Eventos informativos de seleção/conexão não são prova de recuperação. Painel
de riscos históricos inclui fontes/saídas além da sonda PGM. Sem nova migração;
engine preservado da r43, interface compilada na r44, servidor atualizado.

32 testes distintos afetados aprovados em lotes dirigidos. Prova compilada
Tc9rWE pertence ao servidor AF16FCEA da r44: dois servidores/engines isolados,
predecessor assinado, incidentes históricos sintéticos PGM/OUTPUT encerrados
sem recuperação, duas auditorias/entregas loopback, as-run0/saída nula.
Não atribuir essa prova à r45 antes de ensaio próprio. Tipos finais em andamento.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup do banco
e cofre antes de migrar. Mantém migração48; retorno a pacote antigo não é
rollback homologado. Inclui runtimes portáteis; DeckLink exige driver oficial.
Instalação NÃO testada. Não é Setup.exe assinado nem inicia servidor sozinho.

9.2 em andamento: falhas/retorno com NDI/OMT/DeckLink e saídas reais, captura
de transições subsegundo por eventos nativos, operação remota e prolongada
ainda exigem validação/continuação. Reconciliação atual consulta a cada segundo.
Total10 grupos:1 concluído/9 abertos;53 verificações:5 concluídas,
24 em andamento/24 pendentes. Não é entrega final para ir ao ar.

Registro externo posterior ao pacote (não consta no LEIA-ME interno):
450445614bytes; SHA256
7D95169C1A90CD6245246C5243B3D37DFEB8B2AD9285BB51F945B54E5675C9D5.
Tipos finais PASS. Ensaio66rmAb PASS no server final62573A62: duas instâncias
próprias sucessivas encerradas, histórico sintético PGM/OUTPUT com contexto/ACK
preservados, observação encerrada sem recuperação, auditorias2/loopback2,
as-run0/saída nula. Não é teste de instalação nem homologação física.

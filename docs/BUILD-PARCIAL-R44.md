# RPlayout r44 — instalador parcial, não homologado

Inclui r43 e ciclo durável de falhas de fontes PGM/PVW e publishers.
Incidente, fila e resolução são atômicos; tentativas não duplicam a falha.
Fontes só recuperam com SIGNAL_OK e vídeo/áudio recentes; READY/cadastro não
resolve. Saídas precisam onAir sem erro e entregas acima do contador observado
na falha. Não constitui prova de recepção ou conformidade física.

Desaparecimento, parada e admissão de novo dono encerram a observação sem
resolver o incidente. Contexto original e ACK são preservados. Registros ativos
não resolvidos não são apagados pela retenção após ACK. Posse de outro canal,
encerramento e quarentena não autorizam a gravação. Sem ação automática de PGM.

Mensagens usam nomes seguros e identidades HMAC, não URLs/segredos de fontes e
saídas. Aliases de perda/retry/recuperação foram mantidos; eventos de estado
informativo não devem ser interpretados como recuperação. Painel de riscos
históricos passa a incluir entradas e saídas além da sonda PGM.

31 testes afetados distintos aprovados; servidor/interface compilados.
Tipos finais e ensaio compilado de admissão deste lote ainda em andamento
no momento do empacotamento. Engine preservado da r43; sem nova migração.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup do banco
e cofre antes de migrar. Mantém migração48; rollback para pacote antigo não
homologado. Inclui runtimes portáteis da base anterior; DeckLink exige driver
oficial. Instalação NÃO testada. Não é Setup.exe assinado, nem inicia servidor.

9.2 em andamento: ainda faltam validar falha/retorno com NDI/OMT/DeckLink e
saídas reais, operação remota e prolongada. Não é entrega final para ir ao ar.
Total10 grupos:1 concluído/9 abertos;53 verificações:5 concluídas,
24 em andamento/24 pendentes.

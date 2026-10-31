# RPlayout r49 — instalador parcial, não homologado

Inclui r48. Incidentes das saídas agora distinguem o destino do perfil:
trocar a URL encerra a observação anterior, não registra recuperação falsa.
Engine informa a geração do contador de entregas. Uma conexão recriada pode
confirmar recuperação com novas entregas, sem esperar alcançar o contador
da conexão antiga. Geração antiga, ausente ou sem entrega não comprova retorno.
A saída do processo nativo também encerra a observação sem aguardar polling;
runtime fechado não grava observações após liberar a posse do canal.

14 testes do ciclo de incidentes PASS, tipos servidor PASS e teste dirigido
nativo de geração PASS. Compilações servidor/engine PASS. Interface preservada.
ServerSHA256 4C56E221A424C76968C959A377FF8B9869BBB485DCD7B21D1002D379D0884854.
EngineSHA256 8390A48C6EE8ED91EF1098594554CCB8CF12D9C6ECB9A20458A0275EE8E22EA5.
Contador no sink não prova recepção/decodificação no destino externo.
Ensaio de perda/retorno de receiver próprio ainda pendente nesta edição.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup do banco
e cofre. Mantém migração48; retorno a pacote antigo não é rollback homologado.
Inclui runtimes portáteis da base anterior; DeckLink requer driver oficial.
Instalação NÃO testada. Não é Setup.exe assinado e não inicia servidor sozinho.

9.2 continua aberto: sinais NDI/OMT/DeckLink, destinos reais, carga, falha de
armazenamento/crash antes do commit, estação remota e operação prolongada.
Total:10 grupos,1 concluído/9 abertos;53 verificações,5 concluídas/24 em andamento/
24 pendentes. Não é entrega final para ir ao ar.

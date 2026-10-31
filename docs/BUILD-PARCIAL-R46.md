# RPlayout r46 — instalador parcial, não homologado

Inclui r45 e captura síncrona após eventos nativos aceitos de publisher,
ciclo de entrada e telemetria de fonte. Falha/retorno rápidos não dependem da
consulta de1s. Eventos de item/decoder descartado continuam rejeitados antes
da captura. Não executa TAKE nem altera grade. Engine binário preservado;
servidor e interface recompilados.

Snapshots ficam ordenados na fila até gravação atômica. Retry não muda contexto
nem ordem. Fila limitada a512: excesso durante falha de armazenamento é
registrado como lacuna CRITICAL após o banco voltar; não há garantia de captura
ilimitada ou recuperação silenciosa. Enquanto não grava, fila é memória:
crash do servidor durante falha de armazenamento ainda exige conferência.

Eventos informativos CUEING/PVW_READY/ON_PGM/IDLE e connecting/onAir/idle
voltam a ser persistidos e notificados independentemente de incidente anterior,
com deduplicação em SQLite. Informativo não resolve falha, não homologa sinal
e leva signalRecovered=false; recuperação medida usa source/output.recovered.
URLs/credenciais continuam fora de mensagens/payloads. Rótulos do painel
incluem PGM, entradas e saídas. Sem nova migração; contexto48 preservado.

17 testes afetados aprovados (12 ciclo/fila,2 marcação,3 transporte dirigidos);
tipos e builds aprovados. Tests de callbacks usam transporte simulado por
mensagens nativas, não constituem homologação física. Ensaio compilado do
pacote ainda em andamento ao empacotar.

Extraia TODO o ZIP e execute INSTALAR.cmd em pasta NOVA. Faça backup de banco
e cofre. Não retornar banco48 a pacote antigo como rollback homologado.
Inclui runtimes portáteis; DeckLink requer driver oficial. Instalação NÃO testada.
Não é Setup.exe assinado e não inicia o servidor automaticamente.

9.2 segue em andamento: validar perdas/retorno/configuração com fontes e saídas
reais, comportamento sob carga/armazenamento degradado e operação remota/
prolongada. Total10grupos1 concluído/9abertos;53checks5concluídas,
24 em andamento/24 pendentes. Não é entrega final para ir ao ar.

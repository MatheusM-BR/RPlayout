# RPlayout r38 — instalador parcial, não homologado

Inclui o fluxo de pastas/nomes da r37 e os lotes locais de incidentes:
reconhecimento auditado/idempotente, visibilidade por canal, detecção PGM,
registro e fila externa na mesma transação, recuperação separada de ACK e
retenção que preserva incidentes sem resolução. Migração 47 adiciona os horários
de recuperação e fim da observação; backups validam esses campos.

Engine atualizado informa duração nativa de freeze, sem dupla espera na sonda,
e idade da última leitura de vídeo. Protocolo aditivo conserva a classificação
legada de freeze. Interface distingue recuperação medida de observação encerrada.

Provas locais em desenvolvimento não homologam instalação, sinais físicos,
operação remota nem desempenho prolongado. Esta parcial é gerada sem teste
de instalação, conforme solicitado. Não usar como entrega final para operação no ar.

Extraia TODO o ZIP e execute INSTALAR.cmd em uma pasta NOVA. Faça backup dos
dados e do cofre antes de migrar. Não volte um banco migrado para um pacote
antigo como se fosse um rollback homologado. Node, módulos de produção/SQLite,
GStreamer e runtimes NDI/OMT/MSVC incluídos; pnpm/tsx/tsc não são exigidos no
destino. DeckLink requer o driver oficial Blackmagic Desktop Video.

Não é Setup.exe assinado e não inicia o servidor automaticamente. Releases
anteriores preservadas. Falta conferência visual dos incidentes e homologações
físicas/remotas, operação prolongada e demais grupos de fechamento.

Total: 10 grupos, 1 concluído e 9 abertos. 53 verificações: 5 concluídas,
24 em andamento e 24 pendentes. Empacotar não encerra esses marcos.

Registro externo após empacotamento (não integra o LEIA-ME interno):
450391431 bytes; SHA-256
EF962DE86F97E41F00D75F5B6C57B1990CE8FFF80DCAAB398AD67CC707F34827.

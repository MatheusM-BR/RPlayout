# Retorno HA — escolha explícita de mídia local

11/10/2026 — implementação em lote, NOT_RUN; fora R55.

Store/Replication/API/UI agora oferecem opções locais antes de iniciar revisão.
GET `/api/ha/returns/media-options` recebe somente aplicação/canal, exige aplicação
STAGED própria e administrador autorizado/sessão estável. Busca no acervo primário
por SHA e tipo; expõe títulos/IDs/QC/ignorado, não caminhos ou probes privados.
Esta consulta não abre mídia nem comprova bytes/decode.

Quando há múltiplos ativos locais com o mesmo SHA, operador escolhe explicitamente
o ativo. Tipo, SHA e ID devem corresponder ao acervo local. Ausente/incompatível
não é convertido em fallback de caminho estrangeiro. Arquivo sem QC explícito
ou ignorado continua bloqueado, mesmo quando escolhido para análise.

POST da revisão recebe mediaChoices (SHA + localAssetId) e inventoryMac. Escolhas
duplicadas por SHA recusadas; escolha exige MAC. MAC liga aplicação e hash da
cópia ao inventário/QC/perfil atual. Mudança invalida conferência antes da aceitação
e novamente antes da análise enfileirada. Request persistido guarda escolha, e
UUID repetido com outra escolha é outra intenção recusada, não sobrescrita.

Uma sonda continua por SHA, com SHA/stamp antes/depois e montagens independentes
por edição/item. Escolha de ativo não ignora QC/mix/corte/live/grafismo/autoridade.
Solicitações legadas sem escolha permanecem possíveis no domínio, mas ambiguidade
continua bloqueada. A página exige conferir opções antes de criar pedido novo.

Seletor limita a 1000 conteúdos e 10000 candidatos locais; excesso falha explicitamente,
sem truncar um inventário como completo. Consulta paginada de inventários maiores
ainda é necessária. Evidência detalhada e caminhos continuam só no diário cifrado;
pending do navegador contém IDs, hashes e MAC, nunca caminhos de mídia.

Fixtures de escolha, tipo, resposta sem caminhos, mudança de QC invalidando MAC e
contrato adicionadas, não executadas. Sem testes/build nesta fase.

Próximo: leitura privada da evidência confirmada e aplicação a nova derivada
com mídia/QC/mixes/trims/grafismos/automação/saídas, principal atual/KEEP_PRIMARY/
híbrido, engine/autoridade/retorno/rejoin, histórico/recuperação explícita e
homologação. Opções e revisão não são prontidão operacional.

Totais: 10 grupos (1 concluído/9 abertos), 53 verificações (5/36/12).

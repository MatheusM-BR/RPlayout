# Decisão AUTO na página de revisão do retorno

Atualização 11/10: adoção explícita à nova cópia agora conectada em fonte,
sem execução/validação. O histórico abaixo descreve o checkpoint anterior.
Estado atual: HA-ADOTAR-AUTO-NA-COPIA.md.

Estado: implementado em fonte, NOT_RUN. Sem teste, navegador ou nova build;
não está no pacote R55. Não conclui as verificações 8.5/8.6.

A página de revisão local agora oferece consulta explícita das montagens
master já AUTO que possuem medição local. Exibe edição/item, LUFS, LRA e pico
antes do ganho. Nenhuma montagem é marcada automaticamente. O operador
seleciona as montagens e fornece justificativa de 5 a 2000 caracteres.

Antes do envio, a intenção fica em sessionStorage com UUID, revisão, canal,
MAC da evidência, chaves de montagem e justificativa. Depois de erro ou
recarregamento, a ação disponível consulta o mesmo UUID, sem reenviar o POST.
Não há botão de apagar/recriar a intenção nem retry automático. Se a consulta
disser que não foi registrada, uma futura recuperação explícita ainda precisa
ser implementada; não interpretar ausência como autorização para repetir.

As respostas são correlacionadas à revisão/evidência e ao pedido exato.
Mudanças de contexto invalidam respostas assíncronas antigas. A seleção e
gravação ficam desabilitadas quando o contexto está obsoleto, a revisão não é
local, não está REVIEWED ou não tem bytes/decodificação completos.

Registrar a decisão não altera itens, ganho, QC, banco de mídia, saídas ou
engine. MANUAL/OFF, live e contingência não são convertidos. O resultado é
histórico, sem autorização de publicação. O botão de criar cópia com mídia
continua usando o contrato anterior: NÃO adota esta decisão AUTO.

Continuação: aplicação explícita da decisão à nova derivada, recuperação de
pedidos não registrados/interrompidos, contrato de contingência, QC, áudio após
ganho/limitador/barramento, grafismos, saídas, engine, autoridade e retorno
entre nós. Depois, validação conjunta e build instalável.

Totais mantidos: 10 grupos (1 concluído, 9 abertos); 53 verificações
(5 concluídas, 36 em andamento, 12 pendentes).

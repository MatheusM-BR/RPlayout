# Recebimento reverso no principal — NOT_RUN

Implementação em lote; nenhum teste, compilação ou homologação executado.
Não incluída no pacote R55. Transporte de envio da reserva integrado em fonte
em HA-ENVIO-REVERSO.md, também NOT_RUN; sem sincronização operacional/retorno.

O principal persistente configura uma quarentena separada do banco operacional.
Recepção usa o mesmo pareamento HA, mas domínio RETURN separado de STATE/MEDIA:
somente PRIMARY aceita RETURN; somente STANDBY aceita STATE/MEDIA. Cabeçalhos
autenticam finalidade, cluster, nós, sequência, digest e timestamp recente.
Envelope AES-GCM e MAC de payload/recibo têm domínios exclusivos de retorno.
Não utiliza sessão de operador ou token de administrador para tráfego entre nós.

POST `/api/ha/return` limitado a 1 MiB recebe BEGIN/WRITE/VERIFY/STATUS cifrados.
BEGIN inclui selo de exportação e SHA canônico do manifesto. Novo UUID cria cópia
privada local, nunca caminho fornecido pelo par. Uma cópia por exportação/promoção;
quota inclui todos os parciais, limite de 128 cópias e espaço livre verificado.
Diário cifrado é registrado ANTES da alocação. Não se apagam parciais para retry.

WRITE aceita até 256 KiB, base64 canônico, offset sequencial e tamanho limitado
pelo selo. Fsync precede atualização durável do offset. Bloco repetido só responde
após comparar bytes existentes, sem reescrita. Sobreposição parcial, salto ou
arquivo à frente/atrás do diário são recusados; não truncar nem adivinhar após crash.
Instância perdida não adota parcial: consulta histórica permanece disponível.
Links/junções/hardlinks, identidade ou tamanho alterados e WAL/SHM bloqueiam uso.

VERIFY relê todo o destino, confirma SHA executado/tamanho/identidade e registra
RECEIVED_QUARANTINE. Recibo assinado corresponde exatamente ao envelope/transferência,
exportação, execução, canal, parada, manifesto, hash e tamanho. Repetição de VERIFY
apenas consulta o registro histórico; NÃO revalida integridade atual do banco.
Encerramento do serviço drena operações antes de fechar o diário.

GET `/api/ha/returns?channelId=...` exige administrador autorizado no canal;
mostra somente recibos/resumo sem caminhos ou conteúdo. Painel no principal é
somente consulta manual e informa parciais, evidência histórica e posse perdida.

Recebimento NÃO: abre/migra/instala banco; importa chaves; mescla as-run;
resolve comandos incertos; aprova mídia/edição; altera PGM; concede retomada.
Campos primaryApproved/publicationAuthorized/authorityTransferred permanecem false.

Faltam envio explícito da exportação própria com diário/outbox e verificação do
recibo no reserva, recuperação de resposta perdida/reinício, reconciliação
SQLite/schema/chaves/edição/mídia/cursor/as-run, devolução admitida/rejoin, revisão
de geração perdida/offline, testes de quota/bytes/crash/TOCTOU/limites/pareamento,
qualificação real entre hosts, build e publicação. Fixtures: NOT_RUN.

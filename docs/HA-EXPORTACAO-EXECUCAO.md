# Exportação da execução encerrada — NOT_RUN

Implementação em lote; não executada, compilada ou homologada. Não incluída em R55.

Após parada confirmada de engine, mídia, warmup e backend próprios e liberação
de storage, o mesmo backend guarda o descritor da cópia encerrada. Não adota
arquivos/handles após reinício. Exportação exige administrador, canal autorizado,
sessão estável, posse local e prova atual do host; não concede execução.

POST `/api/ha/executions/export` recebe somente UUID, canal, promoção e UUID
de parada. Pedido persistido cifrado antes da cópia. UUID repetido apenas consulta;
uma exportação por promoção. GET consulta sem repetir. A interface salva intenção
antes de enviar, preserva falha/resposta perdida e não sobrescreve intenção inválida.
Conferência de retorno oferece exportação somente para cópia fechada própria.

Copia todo o banco operacional efetivamente executado para novo diretório privado,
sem substituir original, sem WAL/SHM pendentes, sem links/junções/hardlinks.
Verifica identidade/tamanho/tempo de origem e destino, espaço disponível,
SHA dos bytes de origem e leitura do destino, reconferindo posse entre blocos.
Manifesto cifrado/assinado separa SHA original de preparação do SHA executado.
Falha retém evidência parcial; não há limpeza/retry automático. API não revela
caminhos privados nem conteúdo do banco.

Selo é evidência histórica de bytes, NÃO aprovação SQLite/mídia, transferência
confirmada, merge de histórico, devolução de autoridade ou principal pronto.
Plano de retorno remove apenas o bloqueio de exportação quando diário/selo/parada
correspondem. Mantém bloqueios de sincronização reversa e reconciliação no principal.

Faltam: transporte autenticado ao principal com recibo durável e quarentena;
verificação atual de integridade/schema e chaves protegidas do banco recebido;
reconciliação de edição, mídia, cursor, as-run e comandos incertos; parada perdida/
offline; retorno de concessão e rejoin; fixtures de falha/TOCTOU/reinício, integração,
homologação física, build nova e publicação. Fixtures adicionadas: NOT_RUN.

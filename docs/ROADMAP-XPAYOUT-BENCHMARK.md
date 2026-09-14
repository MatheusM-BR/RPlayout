# RPlayout — roadmap técnico baseado no benchmark XPlayout

O XPlayout será usado como referência funcional. O RPlayout mantém uma arquitetura web/API-first, com observabilidade e operação moderna.

## Estado atual

| Área | Estado no RPlayout |
|---|---|
| Grade, PGM/PVW, TAKE e trim | Implementado |
| Playlists, importação e programação por data | Implementado |
| Filler e montagem explicável | Implementado |
| As-Run, auditoria e exportação | Implementado |
| Loudness e medidores | Implementado/parcial conforme engine |
| RTMP/SRT e MediaMTX | Implementado |
| Login, usuários e permissões | Implementado |
| CG básico | Implementado |
| WebSocket e monitoramento de processos | Implementado |
| LIVE nativo com preview e TAKE | Parcial |
| Correção automática de atraso | Parcial: regras existem, falta política operacional completa |
| Timeline visual | Endpoint e faixa visual no painel de Distribuição |
| Multiview de entradas | Pendente |
| NDI e SDI físicos | Pendente de hardware |
| SCTE-35/104 | API normalizada, consulta/auditoria e eventos de gateway implementados; inserção física depende do encoder |
| N+1 failover e sincronização de estado | Failover lógico, backoff, heartbeat, hash e comparação operacional do peer implementados; sincronização de frames entre hosts depende de segunda instância |
| Cache local de continuidade | Implementado: aquecimento, fallback por hash e quota com poda por antiguidade |
| Controle externo GPI/ATEM/routers | API protegida por token para take/cue/stop/park; integração física depende do gateway |
| Multi-tenant/cloud | Pendente, fora do escopo local 1.1 |

## Ordem de desenvolvimento

### Fase A — núcleo de automação 24/7

1. Tipos de evento explícitos: `FIXED`, `SEQUENTIAL`, `HARD_TIME`, `LIVE` e `FILLER`.
2. Política de atraso: cortar itens marcados como `TRIMMABLE`, remover `OPTIONAL`, reduzir filler e preservar `HARD_TIME`.
3. LIVE como item de grade, com fonte cadastrada, preview, status, áudio e TAKE.
4. Correção automática de horário e relatório da compensação aplicada.

### Fase B — entradas e distribuição profissional

1. SRT Manager com caller/listener/rendezvous, latência, RTT, perda, bitrate, passphrase mascarada e reconnect.
2. Perfil primário/secundário para cada entrada e saída.
3. Normalização de resolução, frame rate, aspecto e codec no engine.
4. Multiview operacional para várias entradas.

### Fase C — continuidade e compliance

1. Cache local das próximas 48 horas e indicador de cobertura.
2. N+1 com heartbeat e sincronização de item, frame e estado de saída.
3. As-Run com previsto/executado/falha e exportação de relatório.
4. Detecção de black, silêncio e congelamento de vídeo implementada no PGM; perda de fonte segue os eventos do engine.

### Fase D — eventos secundários e integração

1. CG vinculado ao evento: logo, clock, ticker, crawl e lower third.
2. Secondary events com disparo temporal e por estado.
3. SCTE-35 em IP e SCTE-104 em SDI.
4. Controle externo de routers, GPI e ATEM via gateway autenticado.

### Fase E — timeline e operação distribuída

1. Timeline visual de vídeo, áudio, CG, LIVE e SCTE.
2. Workspace concorrente com bloqueio otimista e histórico de conflitos.
3. Multi-tenant e canais por cliente.
4. Operação cloud/hybrid mantendo o mesmo contrato API-first.

## Critério de produto

O RPlayout só deve marcar uma função como pronta quando houver teste automatizado, estado visível na UI, registro no As-Run/auditoria e comportamento definido para falha. Recursos que dependem de NDI, SDI, GPI ou hardware devem permanecer explicitamente marcados como validação física.

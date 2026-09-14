# Auditoria profunda de UI/UX — RPlayout x XPlayout

Data: 14/09/2026  
Escopo: aplicação web do RPlayout, fluxo Master/Operador, playlist 24h, usuários, monitoração, saídas/processos e documentação integrada.

## Como a comparação foi feita

O RPlayout foi analisado a partir do código servido em `apps/web/src`, das rotas do servidor em `apps/server/src`, dos testes e dos documentos já mantidos no repositório. O XPlayout foi confrontado com a página oficial da Axel Technology e o folheto oficial publicado pela fabricante. Esses materiais descrevem recursos, organização operacional e requisitos do produto; não são uma inspeção da interface instalada do XPlayout.

Referências públicas usadas:

- [XPlayout — página oficial](https://www.axeltechnology.com/tv-automation-tv/xplayout/)
- [XPlayout — folheto oficial](https://www.axeltechnology.com/wp-content/uploads/2025/07/XPLAYOUT_Vertical.pdf)
- [XTV/XPlayout — guia oficial](https://www.axeltechnology.com/public/xtv/XTV%20Guide%20ENG.pdf)

## Diagnóstico executivo

O RPlayout já tem um núcleo funcional consistente: grade, TAKE/PARAR/PREPARAR, PGM/PVW, acervo, importação de playlist, programação por data, Aired, auditoria, perfis de saída, processos, login, usuários, monitor WebRTC, integração por API e testes automatizados. A separação entre Master e o workspace de playlists também está representada no código.

O principal problema atual não é falta de botões. É a hierarquia da operação. A tela Master concentra acervo, grade, monitores, conflitos, transportes, saídas e avisos em uma única superfície; ações de configuração abrem diálogos largos; o operador precisa interpretar muitos estados textuais pequenos; e funções importantes ficam condicionadas a configuração de ambiente ou a validação física. Isso aumenta o risco de erro exatamente no momento em que o operador precisa decidir rápido.

O XPlayout se apresenta como um conjunto de módulos com papéis claros: XPlayout para operação, XScheduler para programação offline, XTrimmer para QC/metadata, XLogsViewer para As-Run, XInfo para informação de playlist, XRouter/XRemote para roteamento e XEmergency para redundância. A referência oficial também explicita gestão de atraso/adiantamento, filler, live dentro da playlist, hotkeys, status detalhado, Mark In/Out, loudness, backup path e logs de certificação.

Conclusão: o RPlayout está tecnicamente mais próximo de uma plataforma web modular do que de uma réplica visual do XPlayout, mas ainda precisa transformar essa arquitetura em uma experiência de trabalho mais previsível. A prioridade deve ser reduzir ambiguidade e contexto, depois completar automação e hardware.

## Matriz comparativa

| Área | Padrão observado no XPlayout | Estado observado no RPlayout | Diferença de UX | Prioridade |
|---|---|---|---|---|
| Operação no ar | Playlist, status, preview/output, atalhos e estados por cor em uma visão otimizada para operação | Master reúne Explorer, Rundown, Monitors, conflitos e transporte; há PGM FIXADO e estados `NO AR/PRÓX` | A informação existe, mas a tela tem alta densidade e pouca distinção entre ação imediata, preparação e configuração | P0 |
| Playlist/rundown | View de playlist, duração total/restante, edição durante o ar, modo manual/automático e hotkeys | Grade editável, importação M3U/CSV/TXT, revisão, publicação no fim/próximo, histórico e exportação | O workspace de playlist é bom como base, mas ainda parece um diálogo ampliado; falta uma convenção visual de calendário, revisão e publicação | P0 |
| Scheduler 24/7 | Scheduler dedicado, loop, preenchimento, correção de atraso/adiantamento e corte quando atrasado | Faixas, autofill explicável, cobertura, proposta até horário e status do scheduler | Falta mostrar a política aplicada diretamente na grade: “cortou”, “pulou”, “preencheu” e o impacto no relógio | P1 |
| Acervo/QC | XTrimmer e metadata/QC; compatibilidade ampla e adaptação de formato | Pastas pelo explorador, reconciliação, ignorados, arquivos sem imagem/áudio e 9:16 tratados | O operador vê o item ignorado, mas não há um fluxo de revisão/QC com motivo, correção e reprocessamento | P1 |
| PGM/PVW | Preview em tempo real, VU/waveform, pre-listen e Mark In/Out | WebRTC/WHEP, VU, speaker sob demanda, timeline e marcação IN/OUT | A mídia e o áudio existem, mas a timeline ainda é principalmente controle de monitor; falta feedback frame-accurate garantido pelo engine | P0 |
| Saídas | SDI/IP/NDI, múltiplos codecs, escalonamento e rotas visíveis por perfil | RTMP/SRT/SDI assistido, DeckLink descoberto, processos por canal, health events e N+1 lógico | A tela é funcional, porém mistura configuração, diagnóstico e operação em um único painel | P1 |
| Live/input | Live source dentro da playlist, preview, VU, pre-listen e take rápido | SRT/RTMP por URL, fontes descobertas para SDI/NDI, item LIVE parcial | A seleção é técnica; falta apresentar fonte, latência, saúde, fallback e “pronto para TAKE” em uma única linha | P1 |
| Continuidade | Backup path, autofill, automatic skip/cut, delay management e XMirror | Cache de continuidade, reconexão, health events e failover lógico | A base está presente, mas a política de decisão ainda precisa de uma tela operacional explicando a ação automática | P0 |
| Logs/Aired | As-Run e system logs para certificação, exportação e consulta | Aired, auditoria por usuário/ação/data e CSV | RPlayout atende a consulta básica; falta separar claramente “o que foi ao ar” de “o que o sistema fez” | P1 |
| Usuários | GUI lock/password e operação multiusuário | Login condicional por ambiente, papéis e painel de usuários | Se `RPLAYOUT_ADMIN_USER/PASSWORD` não estiver configurado, o login não aparece; isso é seguro para laboratório, mas pouco descobrível em produção | P0 |
| Controle externo | GPI, ATEM, routers, RS232/RS422, XRemote | API autenticada e documentação; conexão física depende de gateway | O estado “API preparada” pode ser confundido com “hardware conectado” | P1 |
| Gráficos | CG, logos, clock, tickers, squeezeback, secondary events | GC básico e eventos/integrations | O caminho de CG precisa de presets, preview e estado por evento para competir com uma operação de canal | P2 |
| Arquitetura | Suite de aplicações com funções bem separadas | API-first com workspaces Master, Playlist, Usuários e Distribuição | A separação existe tecnicamente, mas ainda aparece como diálogos e abas na mesma aplicação | P0 |

## Auditoria de usabilidade

### 1. Visibilidade do estado

Há estados úteis (`NO AR`, `PRÓX`, `SINTONIZANDO`, saúde de publisher, conflitos e scheduler), mas eles competem visualmente com metadados. O estado mais crítico deve ocupar sempre a mesma região e usar a mesma gramática: estado, tempo restante, próxima ação e motivo da falha. “SINTONIZANDO” sozinho não explica se o problema é ausência de trilha, WHEP, processo ou arquivo.

Correção recomendada: um cartão de estado operacional por canal com quatro linhas fixas: **estado**, **item**, **relógio**, **ação de recuperação**. O painel de processos fica como diagnóstico detalhado.

### 2. Ações perigosas e ações de consulta

`TAKE`, `PARAR`, `PREPARAR`, `MONTAR`, `SAÍDAS E PROCESSOS`, `AIRED` e `PGM FIXADO` estão próximos na mesma topologia geral, apesar de terem riscos diferentes. O código já moveu AIRED para o cabeçalho da grade, mas a operação ainda depende de leitura dos rótulos.

Correção recomendada: três grupos persistentes e visuais:

1. **AR**: TAKE, PARAR, estado e atalho.
2. **ITEM**: PREPARAR, IN/OUT, áudio e corte.
3. **GRADE/SISTEMA**: montar, Aired, exportar, saídas e auditoria.

`PGM FIXADO` deve ser tratado como modo de navegação, com ícone de cadeado e estado global no cabeçalho da grade. Quando ativo, o pane deve capturar roda, touch, PageUp/PageDown e teclado; o operador ainda precisa de um botão explícito para liberar.

### 3. Densidade e leitura

O design atual usa muitos textos em caixa alta, fonte monoespaçada e bordas de baixo contraste. Isso combina com uma central técnica, mas reduz escaneabilidade em monitores menores. O XPlayout também usa codificação por cor, porém combina isso com modos de playlist e painéis dedicados.

Correção recomendada: reservar a fonte monoespaçada para timecode, IDs e logs; usar uma fonte proporcional para nomes e ações; reduzir rótulos redundantes; manter cor apenas para estado e risco. Ações devem usar verbo + objeto: `Publicar próximo`, `Exportar grade`, `Abrir processos`.

### 4. Modais e workspaces

Os diálogos têm cabeçalho/rodapé fixos e largura responsiva, mas playlist, usuários, documentação e saídas ainda podem aparecer como grandes modais. Isso cria a sensação de que são telas incompletas dentro do Master.

Correção recomendada: manter somente confirmações e edição curta em modal. Playlist, Usuários, Saídas/Processos, Aired e Documentação devem ter rotas/workspaces próprios, com breadcrumb, título, contexto de canal e ação de retorno. A abertura em nova aba deve ser opcional; não pode ser o único modo de obter uma tela dedicada.

### 5. Feedback e recuperação

A aplicação possui toast, alertas, health events e histórico. O gap é o vínculo entre o erro e a recuperação: um publisher que cai precisa mostrar `reconectar`, `desligar perfil`, `abrir diagnóstico` e `copiar endpoint`; um item sem mídia precisa mostrar `aceitar`, `localizar arquivo` ou `remover da publicação`.

Correção recomendada: cada erro operacional deve ter ação contextual e ser gravado com causa, ação automática e resultado. Isso também melhora o As-Run e a auditoria.

### 6. Áudio

O speaker sob demanda é correto para não iniciar dezenas de pipelines com áudio, e a barra aparece no hover/foco. Porém, o operador precisa de um estado inequívoco: áudio recebido, áudio mutado pelo operador, trilha ausente, codec incompatível ou autoplay bloqueado pelo navegador.

Correção recomendada: o botão deve expor `aria-label`, estado textual curto no tooltip e um indicador de trilha. O VU deve continuar visível; detalhes de codec e dispositivo ficam em “detalhes de áudio”. Em WHEP, o teste de áudio precisa validar o SDP e a trilha Opus, não apenas a existência de vídeo.

### 7. Timeline, seek e IN/OUT

A régua inferior resolve a intenção visual do operador, mas o contrato de comportamento precisa ser único em PGM, PVW e recorte: posição atual, duração total, arrastar, teclado e frame-step. Streams ao vivo não podem parecer seekable; arquivos devem mostrar tempo `atual/total` e resposta imediata.

Correção recomendada: separar explicitamente `timeline operacional` de `transport control`. O seek do monitor é local; o marcador IN/OUT é edição do item; o ponto que está no ar é engine-owned. O UI deve rotular essa diferença para evitar que o operador ache que arrastou o PGM real.

### 8. Acessibilidade e operação sem mouse

Há bloqueio de menu nativo, botões e alguns `aria-labels`, mas o fluxo broadcast precisa ser operável por teclado: TAKE, PARAR, PREPARAR, próximo item, buscar, abrir Aired, aceitar erro e travar/destravar acompanhamento.

Correção recomendada: mapa de atalhos visível no AJUDA, foco sempre devolvido ao contexto que abriu um diálogo, foco preso em modal e confirmação visual do atalho executado.

### 9. Responsividade

O layout é otimizado para uma tela larga. Em janelas menores, a densidade aumenta e os painéis verticais competem por altura. O padrão de referência deve ser 1920×1080, mas também é preciso definir um modo operador 1366×768: acervo recolhível, conflitos como drawer, monitores com altura fixa e grade como área dominante.

### 10. Performance percebida

O painel de Distribuição atualiza processos, saúde, scheduler, N+1 e timeline a cada dois segundos. Isso é útil para diagnóstico, mas caro para uma tela que fica aberta ao lado do Master. A arquitetura já permite fechar monitores e desligar saídas; a UI precisa tornar isso explícito.

Correção recomendada: polling adaptativo: 250 ms somente durante transição crítica, 1 s no Master, 2–5 s em diagnóstico, pausa quando workspace fica oculto. Indicadores de processos devem ser agregados por canal antes de renderizar.

## Falhas de produto que a comparação revela

### P0 — corrigir antes de chamar de release operacional

- **Login descobrível**: mostrar a configuração de acesso no primeiro uso e explicar quando o modo local sem autenticação está ativo.
- **Modo Master versus diagnóstico**: tirar configuração pesada da barra de operação e abrir Saídas/Processos como workspace dedicado.
- **PGM/PVW/timeline**: definir contrato único de seek, tempo atual/total e origem do relógio; marcar claramente o que é local e o que é engine.
- **Falha acionável**: cada estado `SINTONIZANDO`, `CAIU`, `SEM ÁUDIO`, `SEM ARQUIVO` deve ter causa e recuperação.
- **PGM FIXADO**: bloquear todos os caminhos de scroll e indicar o modo no cabeçalho, sem depender apenas do botão.
- **Playlist em produção**: publicar deve mostrar diff do futuro da grade, impacto no horário, itens pulados e operação de desfazer.

### P1 — fechar a paridade operacional

- calendário diário/semanal persistente, com regras de faixa e exceções;
- policy engine visível para atraso, filler, corte e itens opcionais;
- LIVE com fonte, latência, áudio, fallback e TAKE numa única linha;
- QC do acervo com motivo, revisão e reprocessamento;
- separação de Aired, Auditoria, eventos de saúde e logs do engine;
- monitor de processo com filtro por canal, uso e impacto no GPU/CPU;
- estados físicos explícitos para DeckLink, NDI, GPI, ATEM e router;
- importação/exportação com validação, diff e relatório de erros.

### P2 — diferenciação de produto

- presets de CG e secondary events;
- multiview 2×2 para entradas;
- waveform e loudness por canal/faixa;
- hotkeys configuráveis por operador;
- multiusuário concorrente com bloqueio otimista;
- N+1 com sincronização real de frame e saída;
- SCTE-35/104 inserido no encoder físico;
- instalador self-contained com atualização e rollback.

## Ordem de desenvolvimento recomendada

1. **Sistema visual**: tokens, tipografia, estados, botões de risco e layout 1366/1920.
2. **Workspaces reais**: Master, Playlists, Usuários, Monitoramento e Documentação como rotas coerentes; modal apenas para edição curta.
3. **Núcleo de operação**: TAKE/PARAR/PREPARAR, PGM FIXADO, timeline, áudio e erro acionável.
4. **Scheduler**: calendário, faixas, filler, atraso/adiantamento e diff antes de publicar.
5. **Media/QC**: ingestão, motivos de rejeição, revisão e reprocessamento.
6. **Saídas e saúde**: perfis, processos, publishers, N+1, cache e diagnóstico por canal.
7. **Live e hardware**: SRT/RTMP, DeckLink/NDI, GPI/ATEM/router, com estados “descoberto/configurado/conectado/testado”.
8. **Compliance e diferenciação**: As-Run, auditoria, SCTE, CG, loudness, multiview e instalador.

## Critérios de aceite para uma UI de nível broadcast

- Em até três segundos, o operador identifica canal, item no ar, item seguinte, tempo restante e saúde de saída.
- TAKE e PARAR têm posição fixa, contraste alto, atalho e confirmação de estado.
- Nenhum erro crítico aparece apenas em toast ou log; há causa e ação na mesma tela.
- O workspace de playlist permite revisar, simular horário, publicar e desfazer sem alterar o Master até a publicação.
- PGM/PVW mostram tempo atual/total e seek coerente; ao vivo é identificado como não seekable.
- O login e o papel da sessão são visíveis; ações administrativas exigem permissão e entram na auditoria.
- Saídas desligadas não criam pipeline; o processo correspondente desaparece do monitor e deixa registro.
- Hardware físico só aparece como “pronto” depois de descoberta e teste real.
- A mesma ação tem o mesmo nome, cor, posição e confirmação em todas as telas.
- A operação continua compreensível em 1366×768 e 1920×1080, sem scroll horizontal no Master.

## Resultado desta auditoria

O RPlayout não deve ser redesenhado copiando a aparência do XPlayout. O caminho mais forte é adotar a mesma disciplina de produto: módulos com responsabilidade única, estado operacional explícito, scheduler separado, QC separado, logs certificados e fallback visível. A base de código já suporta essa direção; o próximo trabalho deve transformar os componentes existentes em workspaces claros e fechar os contratos de estado antes de adicionar mais integrações.


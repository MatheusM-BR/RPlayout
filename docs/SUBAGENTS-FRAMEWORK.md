# Framework de Subagents & Estrutura de Papéis — RPlayout

Este documento consolida a arquitetura de papéis e especialidades do ecossistema **RPlayout**, integrando o benchmark do **XPlayout (Axel Technology / XTV)** formalizado em [`ROADMAP-XPAYOUT-BENCHMARK.md`](file:///c:/IA/RPlayout/docs/ROADMAP-XPAYOUT-BENCHMARK.md) com a governança da equipe de subagents.

---

## 1. Matriz de Papéis e Subagents

| Subagent ID | Papel | Responsabilidade Principal |
| :--- | :--- | :--- |
| **`tech_lead`** *(Agente Principal)* | **Tech Lead / Arquiteto** | Coordena o time de agentes, valida a arquitetura integrada, audita entregas e garante estabilidade sem regressões. |
| **`broadcast_analyst`** | **Analista de Sistemas / Produto** | Traduz os requisitos operacionais de broadcast (benchmark XPlayout, regras MCR 24/7, compliance EBU/SMPTE/ANCINE) em especificações e roadmaps. |
| **`broadcast_ui_designer`** | **Broadcast UI/UX Designer** | Camada visual, layout de alta densidade (Variante 2 Monumental Grade), contraste WCAG AAA para sala de controle escura, ergonomia de botões táteis e monitores PGM/PVW. |
| **`broadcast_dev`** | **Desenvolvedor Fullstack** | Implementação de motores, APIs e UI nas Fases A a E (Fastify/Node.js, React/Tailwind, Rust/GStreamer, MediaMTX, WebRTC WHEP e SRT). |
| **`broadcast_qa_tester`** | **QA Tester Broadcast** | Testes automatizados via Chrome DevTools Protocol (CDP 1080p), suítes unitárias/integração (Vitest, Cargo test), conformidade de sinais e black/freeze detection. |

---

## 2. Pilares de Produto Integrados (Benchmark XPlayout)

1. **SRT Manager Completo:**
   - Suporte aos modos `Caller`, `Listener` e `Rendezvous`.
   - Telemetria em tempo real: RTT, Packet Loss, Bitrate e Latência.
   - Perfis Primário/Backup com chaveamento de redundância automático.
2. **Redundância N+1 e Sincronização de Estado:**
   - Cluster Primário/Backup com heartbeat de anel contínuo.
   - Sincronização de estado frame-accurate: assunção transparente no mesmo quadro SMPTE.
3. **Cache Inteligente de Continuidade (estilo XMirror):**
   - Garantia de que os arquivos das próximas 48h (e até 7 dias) estejam no cache local de SSD, operando mesmo sem conexão com o NAS ou rede.
4. **CG Dinâmico como Evento Secundário (*Secondary Events*):**
   - Disparo automático acoplado ao tempo do bloco de programação: Logotipo $\rightarrow$ GC Programa $\rightarrow$ GC Apresentador $\rightarrow$ Ticker $\rightarrow$ Fade Out.
5. **As-Run Logs e Compliance Comercial:**
   - Relatórios formais para emissora e anunciantes (Previsto vs. Executado vs. Falhas) com auditoria e exportação (BXF, CSV, PDF).
6. **Timeline Visual 24h Multicamada:**
   - Visualização integrada de Vídeo, Áudio, CG, LIVE e SCTE-35/104.

---

## 3. Fases de Execução do Roadmap

* **Fase A (Núcleo 24/7):** Tipos explícitos de eventos (`FIXED`, `SEQUENTIAL`, `HARD_TIME`, `LIVE`, `FILLER`), política de compensação de atrasos (`TRIMMABLE`, `OPTIONAL`), LIVE nativo com preview e TAKE.
* **Fase B (Entradas e Distribuição):** SRT Manager completo, normalização multiformato no engine, Multiview.
* **Fase C (Continuidade e Compliance):** Cache local 48h, Redundância N+1, detecção de black/silêncio no PGM e As-Run com relatórios.
* **Fase D (Eventos Secundários):** CG sincronizado por tempo de bloco e SCTE-35/104.
* **Fase E (Timeline e Operação Distribuída):** Timeline visual rica e operação multi-tenant.

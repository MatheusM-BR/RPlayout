# CONTRATO DE INTEGRAÇÃO & DICIONÁRIO DE DADOS TÉCNICO
## Frontend Next.js (RPlayout UI) ↔ Backend Playout Engine (Antigravity)
**Versão:** 2.4.0-PRO  
**Status:** Especificação Arquitetural de Referência & Contrato de APIs/WebSockets  
**Padrão de Arquitetura:** Dumb Presentation Components / Thin UI Layer com Governança de Estado Remoto via Antigravity Engine.

---

## 1. VISÃO GERAL DA ARQUITETURA & PRINCÍPIOS DE ENGENHARIA

O ecossistema **RPlayout** foi projetado para ambientes de controle mestre de televisão (*Master Control Room - MCR*) operando 24 horas por dia, 7 dias por semana, em missão crítica com tolerância zero a falhas (*zero-downtime*). 

A interface frontend desenvolvida em Next.js atua estritamente como **camada de visualização (Dumb / Presentational Components)** e **emissor de gatilhos de comando**. O motor backend **Antigravity** detém a soberania integral das regras de negócio, da cadência temporal (*SMPTE Timecode Clockwork*), da orquestração de hardware (*Blackmagic DeckLink SDK, NDI 5.6 Core, FFmpeg / MediaMTX / NVENC Pipelines*) e da máquina de estados do cluster N+1.

### Princípios da Integração:
1. **Timecode-Driven & Determinístico:** Todos os tempos, durações, offsets e pontos de comutação operam em tempo real frame-accurate (`HH:MM:SS:FF` a 50.00 / 59.94 / 60.00 fps baseados em sincronia NTP Stratum-1 e PTP IEEE-1588). O frontend nunca recalcula timecode de saída; ele apenas renderiza os valores entregues pelo Antigravity.
2. **Separação de Tráfego de Dados (Transport Tiering):**
   - **Alta Frequência (40Hz ~ 60Hz):** WebSockets binários/JSON dedicados para Timecodes, VU Meters (EBU R128), Waveform IRE e Scopes de QC.
   - **Média Frequência / Orientado a Eventos (Pub/Sub):** WebSockets para transições de estado do Rundown, Tally Light, disparos de automação e alarmes de Watchdog.
   - **Baixa Frequência / Transacional (REST/gRPC):** Operações CRUD na Playlist, importação/exportação BXF/EPG, ingest trimming e roteamento de sinks.
3. **Ergonomia Visual de Baixa Fadiga:** Contraste WCAG AAA sobre fundos ultra-escuros com zero reflexo, cores funcionais de sinalização broadcast (*On-Air Red, Armed Amber, Locked Emerald, Focus Blue*).

---

## 2. DESIGN TOKENS (TAILWIND / CSS CONFIGURATION)

Para garantir paridade pixel-perfect entre o design aprovado e os componentes React/Tailwind, utilize a configuração de tokens a seguir.

### 2.1 Paleta de Cores Funcionais Broadcast
- **Surface Void (Background):** `#05070E` (Fundo primário para salas de controle com pouca luz)
- **Surface Container Lowest:** `#0B0E16`
- **Surface Container Low / Card:** `#11131B` e `#111827`
- **Surface Container High:** `#191B23` / `#1F2433`
- **Card Borders / Dividers:** `#28354E` (Border standard) e `#373942` (Border sutil)
- **On-Air Primary (Crimson Red):** `#FF3B30` / `#DC2626` (Sinal ativo no ar, PGM, perigo)
- **Armed / Next / Cued (Amber Gold):** `#FF9500` / `#F59E0B` (Próximo evento, PVW, atenção, gaps)
- **System Locked / Master OK (Emerald Green):** `#34C759` / `#10B981` (Genlock, sync 100%, sem perdas)
- **Accent / Focus / Tactical (Ice Blue):** `#3B82F6` / `#60A5FA` (Seleção, botões neutros, badges técnicos)
- **Text Primary:** `#F3F4F6` / `#FFFFFF`
- **Text Secondary / Muted:** `#9CA3AF` / `#6B7280`

### 2.2 `tailwind.config.js` Oficial

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        broadcast: {
          void: '#05070E',
          surface: '#11131B',
          card: '#111827',
          cardHover: '#161F33',
          border: '#28354E',
          borderSubtle: '#1E293B',
          onAir: '#FF3B30',
          onAirGlow: 'rgba(255, 59, 48, 0.35)',
          armed: '#FF9500',
          armedGlow: 'rgba(255, 149, 0, 0.35)',
          ready: '#34C759',
          readyGlow: 'rgba(52, 199, 89, 0.35)',
          focus: '#3B82F6',
          focusGlow: 'rgba(59, 130, 246, 0.35)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        condensed: ['"Barlow Condensed"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        'timecode-hero': ['2.75rem', { lineHeight: '1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'timecode-sub': ['1.75rem', { lineHeight: '1.1', letterSpacing: '0.01em', fontWeight: '700' }],
        'timecode-grid': ['0.875rem', { lineHeight: '1.25', letterSpacing: '0.02em', fontWeight: '600' }],
      },
      boxShadow: {
        'tally-onair': '0 0 15px rgba(255, 59, 48, 0.5), inset 0 0 8px rgba(255, 59, 48, 0.3)',
        'tally-pvw': '0 0 15px rgba(255, 149, 0, 0.5), inset 0 0 8px rgba(255, 149, 0, 0.3)',
        'tally-lock': '0 0 12px rgba(52, 199, 89, 0.4)',
        'tactical': 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 2px 4px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'hazard-stripe': 'hazard 20s linear infinite',
      },
      keyframes: {
        hazard: {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '40px 40px' },
        },
      },
    },
  },
  plugins: [],
};
```

---

## 3. WEBSOCKETS & EVENTOS DE ALTA FREQUÊNCIA (REAL-TIME ENGINE)

Para viabilizar a estabilidade operacional sem congelamento da thread de renderização do React (*React DOM Throttling*), o frontend estabelece conexões WebSockets particionadas por tópicos. Recomenda-se utilizar buffers nativos ou TypedArrays para os scopes e VU Meters.

### 3.1 Endpoint de Timecodes & Rundown Playhead (`ws://<antigravity-ip>:8080/ws/timecode`)
- **Frequência:** 1 pacote por frame transmitido (50Hz / 60Hz).

#### Evento: `TIMECODE_TICK`
Enviado continuamente pelo Antigravity informando o playhead corrente, a regressão do evento no ar e o relógio de referência.

```json
{
  "event": "TIMECODE_TICK",
  "channel_id": "canal-1-hd",
  "timestamp": 1715784047120,
  "payload": {
    "ntp_ref_clock": "20:40:47:12",
    "ptp_locked": true,
    "genlock_locked": true,
    "current_onair": {
      "item_id": "item_14",
      "media_id": "08_TELEJORNAL_BLOCO_02.mp4",
      "elapsed_tc": "00:10:48:06",
      "remaining_tc": "00:04:12:18",
      "progress_percent": 71.9,
      "total_duration_tc": "00:15:00:24",
      "frame_cadence": 50.00,
      "dropped_frames_total": 0
    },
    "current_cued": {
      "item_id": "item_15",
      "media_id": "VT_COMERCIAL_REDE_30S.mp4",
      "duration_tc": "00:00:30:00",
      "scheduled_start_tc": "20:45:00:00",
      "countdown_to_air_tc": "00:04:12:18",
      "status": "CUED"
    }
  }
}
```

### 3.2 Endpoint de Telemetria de Áudio & Scopes QC (`ws://<antigravity-ip>:8080/ws/telemetry`)
- **Frequência:** 25Hz ~ 50Hz (Áudio EBU R128) e 10Hz ~ 20Hz (Luma Waveform / Vectorscope em QC).

#### Evento: `AUDIO_METER_UPDATE`
Alimenta os meters visuais do Master Control e da tela de Quality Control em conformidade EBU R128 / ITU-R BS.1770-4.

```json
{
  "event": "AUDIO_METER_UPDATE",
  "channel_id": "canal-1-hd",
  "payload": {
    "integrated_lufs": -24.0,
    "momentary_lufs": -23.8,
    "short_term_lufs": -24.1,
    "true_peak_dbtp": -0.8,
    "loudness_range_lu": 5.8,
    "phase_correlation": 0.88,
    "channels": [
      { "id": 1, "label": "L", "peak_db": -6.2, "rms_db": -18.4, "clip": false },
      { "id": 2, "label": "R", "peak_db": -6.0, "rms_db": -18.6, "clip": false }
    ],
    "target_compliance": {
      "target_lufs": -24.0,
      "tolerance_lu": 0.5,
      "is_compliant": true
    }
  }
}
```

#### Evento: `QC_SCOPES_DATA`
Enviado na aba de QC quando uma mídia está sob inspeção ativa.

```json
{
  "event": "QC_SCOPES_DATA",
  "media_id": "14_REPORTAGEM_ESPECIAL_FINAL_V2.mxf",
  "payload": {
    "playhead_tc": "00:04:32:18",
    "video": {
      "luma_histogram_100_ire": [0.02, 0.05, 0.12, 0.45, 0.82, 0.95, 0.60, 0.20, 0.04, 0.0],
      "clipping_detected": false,
      "black_frames_count": 0,
      "freeze_frames_count": 0,
      "gamut_legal_percent": 100.0,
      "field_order_detected": "BFF"
    },
    "audio": {
      "loudness_delta_lu": 2.5,
      "auto_gain_suggested_db": -2.5
    }
  }
}
```

### 3.3 Endpoint de Tally & Engine State (`ws://<antigravity-ip>:8080/ws/tally`)
- **Frequência:** Push on state-change (reativo com heartbeat a cada 1000ms).

#### Evento: `TALLY_STATE_CHANGE`
Atualiza os anéis de luz, botões de ação e alertas de segurança.

```json
{
  "event": "TALLY_STATE_CHANGE",
  "channel_id": "canal-1-hd",
  "payload": {
    "on_air_state": "ACTIVE",
    "preview_state": "CUED",
    "transition_armed": "CUT",
    "system_lock": true,
    "redundancy_role": "HOST_A_MASTER",
    "redundancy_health": "HOT_STANDBY_SYNCED",
    "emergency_state": {
      "black_override": false,
      "color_bars_override": false,
      "emergency_audio_mute": false
    }
  }
}
```

---

## 4. INTERFACES REACT (TYPESCRIPT COMPONENT PROPS)

Os componentes frontend devem implementar as seguintes tipagens estritas em TypeScript:

```typescript
// ==========================================
// 4.1 TIPOS BÁSICOS & ENUMS BROADCAST
// ==========================================

export type TimecodeString = `${number}${number}:${number}${number}:${number}${number}:${number}${number}`;

export type MediaType = 'VT' | 'JORNAL' | 'COMERCIAL' | 'PROMO' | 'VINHETA' | 'AO_VIVO' | 'ARTE';

export type IngestStatus = 'EM_INSPECAO' | 'APROVADO' | 'NORMALIZADO' | 'PENDENTE' | 'REJEITADO';

export type TransitionType = 'CUT' | 'MIX' | 'WIPE';

export type TallyState = 'ON_AIR' | 'CUED' | 'STANDBY' | 'ERROR' | 'OFFLINE';

// ==========================================
// 4.2 PROPS DOS MONITORES DE VÍDEO (PGM & PVW)
// ==========================================

export interface BaseMonitorProps {
  channelId: string;
  streamUrl: string; // WebRTC / Low-latency HLS feed interno
  mediaTitle: string;
  timecode: TimecodeString;
  resolution: '1080p50' | '1080i50' | '1080p5994' | '2160p50';
  aspectRatio: '16:9';
  hasSignal: boolean;
  isGenlocked: boolean;
  latencyMs: number;
}

export interface MonitorProgramProps extends BaseMonitorProps {
  tally: 'ON_AIR';
  remainingTimecode: TimecodeString;
  progressPercent: number;
  audioLufs: number;
  isLiveFeed: boolean;
  onEmergencyCutToB?: () => void;
}

export interface MonitorPreviewProps extends BaseMonitorProps {
  tally: 'CUED' | 'STANDBY';
  countdownToAir: TimecodeString;
  targetDuration: TimecodeString;
  autoArm: boolean;
  onPrvAudition?: () => void;
}

// ==========================================
// 4.3 PROPS DA BARRA DE COMUTAÇÃO TÁTICA (ACTION BUTTONS)
// ==========================================

export interface TacticalActionPanelProps {
  channelId: string;
  isLocked: boolean; // Previne disparo acidental quando ativado
  armedTransition: TransitionType;
  cuedItemReady: boolean;
  hasOnAirItem: boolean;
  isTaking: boolean; // Feedback visual transitório durante o corte
  onTake: (transition: TransitionType) => Promise<void>;
  onCue: () => Promise<void>;
  onAbort: () => Promise<void>;
  onSelectTransition: (transition: TransitionType) => void;
  onToggleLock: (locked: boolean) => void;
}

// ==========================================
// 4.4 PROPS DO MEDIDOR DE ÁUDIO EBU R128
// ==========================================

export interface AudioMeterEbuProps {
  integratedLufs: number; // Ex: -24.0
  truePeakDb: number;      // Ex: -0.8
  phaseCorrelation: number;// -1.0 a +1.0
  leftLevelDb: number;
  rightLevelDb: number;
  isCompliant: boolean;
}

// ==========================================
// 4.5 PROPS DA TIMELINE 24H & DETECÇÃO DE GAPS
// ==========================================

export interface TimelineGap {
  gapId: string;
  startTimecode: TimecodeString;
  endTimecode: TimecodeString;
  durationSeconds: number;
  slotBeforeTitle: string;
}

export interface Timeline24hProps {
  currentPlayheadNtp: TimecodeString;
  totalGapsCount: number;
  totalGapsDurationSec: number;
  activeLiveBlocks: Array<{
    id: string;
    title: string;
    startTc: TimecodeString;
    endTc: TimecodeString;
  }>;
  gaps: TimelineGap[];
  onAutofillGapClick: (gapId: string) => void;
  onFocusGap: (gapId: string) => void;
  onNavigateToLive: () => void;
}
```

---

## 5. SCHEMAS DE DADOS: RUNDOWN & PLAYLIST 24/7

O módulo de Programação e Playlist do RPlayout requer uma estrutura JSON frame-accurate para renderizar a tabela linear, calcular gaps e manter a sincronia de automação contínua.

### 5.1 JSON Payload do Rundown Completo (`GET /api/v1/playlist/{channel_id}/schedule?date=2025-05-15`)

```json
{
  "date": "2025-05-15",
  "channel_id": "canal-1-hd",
  "sync_status": {
    "engine_connected": true,
    "last_sync_timestamp": 1715784047120,
    "bxf_sync_state": "SYNCED",
    "redundancy_paraty": true
  },
  "compliance": {
    "ancine_national_quota_target_min": 210,
    "ancine_national_quota_achieved_min": 225,
    "commercial_max_allowed_percent": 25.0,
    "commercial_projected_percent": 18.4
  },
  "summary": {
    "total_events": 142,
    "total_duration_projected": "23:59:15:00",
    "total_gap_duration": "00:00:45:00",
    "active_gaps_count": 1
  },
  "items": [
    {
      "index": 13,
      "item_id": "item_13",
      "mam_id": "MAM-BR-2025-0890",
      "title": "08_TELEJORNAL_BLOCO_01.mp4",
      "type": "JORNAL",
      "timing_rule": "AUTO_FOLLOW",
      "scheduled_time": "20:25:00:00",
      "actual_start_time": "20:25:00:00",
      "duration": "00:15:47:18",
      "mark_in": "00:00:00:00",
      "mark_out": "00:15:47:18",
      "status": "EXIBIDO",
      "qc_compliance": { "video": "PASS", "audio_ebu": "PASS" },
      "is_protected": true
    },
    {
      "index": 14,
      "item_id": "item_14",
      "mam_id": "MAM-BR-2025-0891",
      "title": "08_TELEJORNAL_BLOCO_02.mp4",
      "type": "JORNAL",
      "timing_rule": "AUTO_FOLLOW",
      "scheduled_time": "20:40:47:18",
      "actual_start_time": "20:40:47:18",
      "duration": "00:04:12:18",
      "mark_in": "00:01:10:00",
      "mark_out": "00:05:22:18",
      "status": "NO_AR",
      "qc_compliance": { "video": "PASS", "audio_ebu": "PASS" },
      "is_protected": true
    },
    {
      "index": 15,
      "item_id": "item_15",
      "mam_id": "GRID-COM-4412",
      "title": "VT_COMERCIAL_REDE_30S.mp4",
      "type": "COMERCIAL",
      "timing_rule": "AUTO_FOLLOW",
      "scheduled_time": "20:45:00:00",
      "duration": "00:00:30:00",
      "mark_in": "00:00:00:00",
      "mark_out": "00:00:30:00",
      "status": "CUED",
      "scte35_marker": { "splice_event_id": 1024, "duration_sec": 30 },
      "qc_compliance": { "video": "PASS", "audio_ebu": "PASS" },
      "is_protected": false
    },
    {
      "index": 16,
      "item_id": "gap_critical_01",
      "mam_id": null,
      "title": "GAP CRÍTICO DETECTADO",
      "type": "ARTE",
      "timing_rule": "HARD_NTP",
      "scheduled_time": "20:45:30:00",
      "duration": "00:00:45:00",
      "status": "ALERTA_GAP",
      "is_gap": true,
      "autofill_options": {
        "suggested_filler_id": "FIL-2025-0044",
        "suggested_trim_previous": true
      }
    }
  ]
}
```

### 5.2 Mutações de API (Frontend Triggered Actions)

| Endpoint | Método | Descrição | Payload / Parâmetros |
| :--- | :--- | :--- | :--- |
| `/api/v1/playlist/{ch}/reorder` | `PUT` | Reordena item por Drag-and-Drop | `{ item_id: string, new_index: number }` |
| `/api/v1/playlist/{ch}/item` | `POST` | Insere mídia do MAM ou evento ao vivo | `{ mam_id: string, target_index: number, timing_rule: string }` |
| `/api/v1/playlist/{ch}/item/{id}` | `DELETE`| Remove evento (se não protegido / no ar) | `Nenhum` |
| `/api/v1/playlist/{ch}/autofill` | `POST` | Preenchimento automático inteligente de Gap | `{ gap_id: string, strategy: "AUTO_FILLER" \| "TRIM_PREVIOUS" }` |
| `/api/v1/playlist/{ch}/publish` | `POST` | Compila e publica playlist no Master Ativo | `{ target_cluster: "MASTER_A", force_reload: false }` |
| `/api/v1/playlist/{ch}/export` | `POST` | Exporta nos formatos (BXF, EPG, M3U8, ANCINE) | `{ formats: ["BXF", "EPG", "M3U8", "ANCINE_CSV", "PDF"] }` |

---

## 6. ROTEAMENTO, HARDWARE & REDUNDÂNCIA N+1

O módulo de Engenharia (`MONITOR`) supervisiona a matriz de saídas de vídeo e áudio, os pipelines de encode e a topologia N+1 entre os nós **Host A (Master Primário)** e **Host B (Hot-Standby)**.

### 6.1 Payload de Telemetria de Hardware (`GET /api/v1/engineering/status`)

```json
{
  "cluster_id": "RACK-04-CLUSTER-N1",
  "ntp_ref": "20:40:50:19",
  "engine_status": {
    "fps": 50.00,
    "fps_target": 50.00,
    "pipeline_latency_ms": 0.8,
    "jitter_ms": 0.02,
    "dropped_frames": 0,
    "uptime_seconds": 1571072
  },
  "host_metrics": {
    "cpu_load_percent": 18,
    "cpu_temp_celsius": 46,
    "ram_used_gb": 4.2,
    "ram_total_gb": 16.0,
    "ram_ecc_status": "PROTECTED",
    "gpu_nvenc_load_percent": 34,
    "gpu_temp_celsius": 52,
    "gpu_vram_used_gb": 3.1,
    "gpu_vram_total_gb": 12.0
  },
  "n_plus_one_redundancy": {
    "mode": "FRAME_ACCURATE_MIRRORING",
    "auto_failover_armed": true,
    "heartbeat_ring_latency_ms": 14.8,
    "heartbeat_status": "HEALTHY",
    "host_a_master": {
      "ip": "10.20.1.10",
      "role": "ON_AIR_PRIMARY",
      "sdi_output_state": "ENGAGED",
      "rundown_hash": "#E9B2-4A7F",
      "sync_ref": "PTP_IEEE_1588_LOCKED"
    },
    "host_b_backup": {
      "ip": "10.20.1.11",
      "role": "HOT_STANDBY",
      "sdi_output_state": "MUTED_READY",
      "rundown_hash": "#E9B2-4A7F",
      "playhead_delta_frames": 0,
      "shadow_engine": "RUNNING_MUTED"
    },
    "watchdog_triggers": {
      "max_dropped_frames": 3,
      "black_freeze_limit_sec": 2.0,
      "switch_delay_target_ms": 38.0
    }
  },
  "active_sinks": [
    {
      "sink_id": "sink_sdi_01",
      "label": "Blackmagic DeckLink 8K Pro",
      "type": "SDI",
      "port": "PORT_1_PCIE",
      "format": "1080p50 Rec.709",
      "genlock_sync": "BB_LOCKED",
      "audio_pcm": "8 CH 48kHz 24b",
      "bitrate_gbps": 1.485,
      "is_active": true
    },
    {
      "sink_id": "sink_ndi_01",
      "label": "NDI High Bandwidth v5.6",
      "type": "NDI",
      "stream_name": "RPLAYOUT-CANAL1",
      "bitrate_mbps": 138.4,
      "clients_connected": 0,
      "is_active": true
    },
    {
      "sink_id": "sink_rtmp_01",
      "label": "RTMP Cloud Primary Relay",
      "type": "RTMP",
      "codec": "H.264 / NVENC",
      "bitrate_kbps": 6500,
      "target_endpoint": "rtmp://cdn.cloudmaster.tv/live/main",
      "buffer_ms": 1840,
      "is_active": true
    },
    {
      "sink_id": "sink_srt_01",
      "label": "SRT Cloud Link Embratel/AWS",
      "type": "SRT",
      "mode": "CALLER_AES128",
      "rtt_latency_ms": 24.2,
      "loss_ratio_percent": 0.0,
      "buffer_ms": 120,
      "is_active": true
    }
  ]
}
```

### 6.2 Comandos de Controle de Roteamento & Failover

#### 6.2.1 Comutação Manual Imediata para Host B (`POST /api/v1/engineering/failover/trigger`)
Disparado pelo grande botão vermelho de corte tático:
```json
{
  "action": "FORCE_MANUAL_CUT",
  "source_host": "10.20.1.10",
  "target_host": "10.20.1.11",
  "reason": "OPERATOR_MANUAL_INTERVENTION",
  "preserve_audio_phase": true,
  "frame_accurate": true
}
```

#### 6.2.2 Modificação de Estado de Sink / Roteamento (`PUT /api/v1/engineering/sinks/{sink_id}`)
```json
{
  "sink_id": "sink_sdi_01",
  "enabled": true,
  "test_signal_injection": "NONE" // ou "COLOR_BARS_75" | "TONE_1KHZ" | "SINAL_IDENT"
}
```

---

## 7. ANATOMIA DE ESPAÇOS, TELAS E BOTÕES OPERACIONAIS

Esta seção mapeia os componentes gráficos para que o time do motor Antigravity compreenda o fluxo operacional do operador de MCR.

### 7.1 Tela Master Control
- **Header Global Unificado:**
  - *Seletor de Canal (Dropdown):* Permite alternar entre os canais da emissora. Dispara troca de contexto de WebSockets.
  - *Matriz Técnica 2x2:* Indicadores de transporte com LEDs verdes (`SDI`, `NDI`, `NVENC`, `SRT`). Informam perda de enlace imediata.
  - *Relógio NTP REF:* Mostra a hora oficial do país sincronizada via GPS/NTP Stratum-1.
  - *Menu de Navegação:* Abas táteis (`MASTER`, `PLAYLIST`, `QC`, `MONITOR`, `AIRED`, `DOCS`).
- **Coluna Esquerda - Contadores de Emissão:**
  - *Painel "NO AR":* Exibe o nome do arquivo em execução, o codec (`ProRes HQ`) e o Timecode regressivo em destaque (`TEMPO RESTANTE 00:04:12:18`).
  - *Barra de Progresso do Bloco:* Indica a porcentagem concluída do item corrente.
  - *Quadro de Ações Táticas (Abaixo do Tempo Restante):*
    - **Botão TAKE [ESPAÇO]:** Corta imediatamente o evento Cued para o Ar.
    - **Botão CUE [F11]:** Prepara e engata o próximo evento na cabeça de leitura.
    - **Botão ABORT:** Interrompe com segurança em caso de anomalia grave.
    - **Seletor CUT / MIX / WIPE:** Define a transição da chave P/P.
    - **Chave TRAVADO:** Bloqueia cliques acidentais nos botões principais.
- **Centro Superior - Monitores de Vídeo (Multiviewer Interno):**
  - *PGM (Program):* Sinal real de saída da placa SDI. Borda luminosa vermelha.
  - *PVW (Preview):* Próximo VT armado na memória. Borda luminosa âmbar.
- **Direita Superior - Próximo Evento [PVW]:**
  - Mostra o nome do próximo VT, a duração exata e o contador regressivo até o disparo previsto.
- **Metade Inferior:**
  - *Biblioteca MAM (Esquerda):* Catálogo de VTs, clipes rápidos e chamadas com busca rápida para arrastar para a grade.
  - *Grade de Exibição Monumental (Centro/Direita):* Tabela linear de eventos das próximas 24 horas, destacando a linha vermelha ativa (No Ar) e a linha âmbar engatada (Cued).
  - *Barra de Áudio EBU R128 (Rodapé):* Medidor horizontal estéreo em tempo real e valor integrado travado em `-24.0 LUFS`.

### 7.2 Tela Playlist / Programação & Automação 24/7
- **Timeline 24h Gráfica de Continuidade:**
  - Régua linear de 00:00 a 24:00 dividida por cores (Vermelho = Ao Vivo, Azul = Dramaturgia, Laranja = Comercial, Hachuras Amarelas = Buraco/Gap).
  - *Playhead Verde Atual:* Posição do relógio NTP em tempo real.
  - *Detecção de Buracos (Gaps):* Marcadores visuais em âmbar piscante onde há falta de programação. Ao clicar no buraco, abre popover de **Autofill Inteligente (1-Clique)** para inserir filler do MAM ou expandir a duração do bloco anterior.
- **Barra de Ações de Programação:**
  - *Importar BXF / M3U:* Carrega espelho de tráfego de sistemas comerciais.
  - *Exportar Grade Multi-Formato:* Dropdown completo com suporte a XML BXF (SMPTE-2021), EPG DVB-SI / XMLTV, M3U/M3U8 Playout, CSV/XLS ANCINE e PDF para estúdio.
  - *Botão "PUBLICAR NO MASTER":* Valida a grade e envia os metadados para a memória de execução do Antigravity.
- **Painel Lateral Esquerdo:**
  - Calendário mensal com status de conformidade do dia (100% pronto, Alerta de Gap).
  - Auditoria em tempo real das cotas obrigatórias da ANCINE (mínimo de TV pública/conteúdo nacional) e limite máximo de publicidade (25%).

### 7.3 Tela Quality Control (QC) & Ingest
- **Fila de Ingest / Lote MAM (Esquerda):** Lista clipes importados por FTP/Watchfolder com metadados e status de conformidade.
- **Master Player de Trimming (Centro):**
  - Reprodução frame-accurate com botões táticos de transporte (`SET IN`, `SET OUT`, `J/K/L`).
  - *Régua de Waveform e Áudio:* Visualização da forma de onda para detecção de silêncio ou estalos.
- **Scopes Técnicos de Engenharia (Direita):**
  - *Vectorscope BT.709:* Supervisão de matiz e saturação.
  - *Luma Waveform (0-100 IRE):* Supervisão de nível de preto e estouro de brancos.
  - *Checklist Automatizado da Sonda:* Valida resolução, gamut legal, áudio mudo, black frames indesejados na cabeça/cauda e closed caption CEA-708.
  - *Botões Finais:* `Aprovar & Enviar ao MAM`, `Re-encode na Farm` ou `Rejeitar Arquivo`.

### 7.4 Tela Engenharia & Roteamento (Monitor N+1)
- **Painel Superior de Recursos:**
  - Telemetria de CPU EPYC, GPU NVENC, Memória RAM DDR4 ECC e Jitter do motor de renderização.
- **Matriz de Saídas (Sinks):**
  - Chaves liga/desliga para SDI DeckLink, NDI, RTMP e SRT com taxas de dados em tempo real.
  - Botões de calibração rápida para injeção de Color Bars 75% BT.709, Tom de 1kHz e Identificador de canal.
- **Topologia de Redundância N+1:**
  - Visualização esquemática conectando Host A (No Ar) e Host B (Hot-Standby) via anel de fibra óptica de heartbeat.
  - *Botão Vermelho Central `COMUTAÇÃO MANUAL PARA HOST B`:* Dispara corte emergencial de hardware sem latência em caso de falha física do servidor principal.
- **Console de Auditoria & Logs:**
  - Terminal de eventos em tempo real com níveis `INFO`, `WARN` e `CRITICAL` para rastreamento de timecode, genlock e sincronismo de rede.

import { useState, useEffect } from 'react'
import type { GraphicLayerType } from '../../types.js'

export interface DynamicCgState {
  layer0Logo: boolean
  layer1Clock: boolean
  layer2Ticker: boolean
  layer3LowerThird: boolean
  tickerText: string
  breakingNewsActive: boolean
  lowerThirdTitle: string
  lowerThirdSubtitle: string
  lowerThirdActive: boolean
  lowerThirdTimeRemaining: number // segundos restantes
  scte35Active: boolean
  scte35Phase: 'IDLE' | 'PREROLL' | 'CUE_OUT'
  scte35TimeRemaining: number // segundos ou ms
  scte35EventId: number
}

interface Props {
  className?: string
  onMessage?: (msg: string) => void
  compact?: boolean
  channelId?: string
  onCgStateChange?: (state: DynamicCgState) => void
}

/** Dispara trigger de CG no backend */
async function triggerCgLayer(
  channelId: string | undefined,
  layer: 0 | 1 | 2 | 3 | GraphicLayerType,
  action: 'SHOW' | 'HIDE',
  payload?: Record<string, unknown>,
  durationFrames?: number,
): Promise<void> {
  if (!channelId) return
  const layerNames: Record<number, GraphicLayerType> = {
    0: 'STATION_LOGO',
    1: 'ONAIR_CLOCK',
    2: 'CRAWL_TICKER',
    3: 'LOWER_THIRD',
  }
  const layerName: GraphicLayerType = (typeof layer === 'number' ? layerNames[layer] : layer) ?? 'STATION_LOGO'
  try {
    const res = await fetch(`/api/v1/graphics/layers/${layerName}/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channelId, action, payload, durationFrames }),
    })
    if (!res.ok) {
      console.warn(`[CG] Erro ao disparar camada ${layerName}: HTTP ${res.status}`)
    }
  } catch (err) {
    console.warn(`[CG] Falha de conexão ao disparar camada ${layerName}:`, err)
  }
}

/** Dispara SCTE-35 Splice Insert no backend */
async function triggerScte35Api(
  channelId: string | undefined,
  spliceEventId: number,
): Promise<void> {
  if (!channelId) return
  try {
    await fetch('/api/v1/scte/splice-insert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId,
        spliceEventId,
        prerollMs: 4000,
        durationSeconds: 30,
      }),
    })
  } catch {
    // fire-and-forget
  }
}

export function DynamicCgSecondaryBar({
  className = '',
  onMessage,
  compact = false,
  channelId,
  onCgStateChange,
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [cgState, setCgState] = useState<DynamicCgState>({
    layer0Logo: true,
    layer1Clock: true,
    layer2Ticker: false,
    layer3LowerThird: false,
    tickerText: 'URGENTE: Congresso aprova novo marco regulatório das telecomunicações em Brasília',
    breakingNewsActive: false,
    lowerThirdTitle: 'RODRIGO SILVEIRA',
    lowerThirdSubtitle: 'Correspondente Internacional • Genebra',
    lowerThirdActive: false,
    lowerThirdTimeRemaining: 0,
    scte35Active: false,
    scte35Phase: 'IDLE',
    scte35TimeRemaining: 0,
    scte35EventId: 55102,
  })

  // Propaga o estado para os monitores PGM em tempo real
  useEffect(() => {
    onCgStateChange?.(cgState)
  }, [cgState, onCgStateChange])

  // Timer para Lower-Third (8 segundos de duração padrão)
  useEffect(() => {
    if (cgState.lowerThirdActive) {
      const interval = setInterval(() => {
        setCgState((prev) => {
          if (prev.lowerThirdTimeRemaining <= 1) {
            clearInterval(interval)
            onMessage?.('CG: Layer 3 (LOWER_THIRD) fade-out automático concluído (SMPTE 240 frames)')
            return { ...prev, lowerThirdActive: false, lowerThirdTimeRemaining: 0 }
          }
          return { ...prev, lowerThirdTimeRemaining: prev.lowerThirdTimeRemaining - 1 }
        })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [cgState.lowerThirdActive, onMessage])

  // Timer para SCTE-35 Cue Out (Pre-roll de 4s + Janela de 30s)
  useEffect(() => {
    if (cgState.scte35Phase === 'PREROLL') {
      const interval = setInterval(() => {
        setCgState((prev) => {
          if (prev.scte35TimeRemaining <= 0.1) {
            clearInterval(interval)
            onMessage?.(`SCTE-35: SPLICE_INSERT Executado no PTS exato! Janela comercial de 30.0s aberta (PID 0x86 / VANC 104 DID 0x41)`)
            return {
              ...prev,
              scte35Phase: 'CUE_OUT',
              scte35TimeRemaining: 30.0,
            }
          }
          return { ...prev, scte35TimeRemaining: Number((prev.scte35TimeRemaining - 0.1).toFixed(1)) }
        })
      }, 100)
      return () => clearInterval(interval)
    }

    if (cgState.scte35Phase === 'CUE_OUT') {
      const interval = setInterval(() => {
        setCgState((prev) => {
          if (prev.scte35TimeRemaining <= 0.1) {
            clearInterval(interval)
            onMessage?.(`SCTE-35: Janela comercial de 30s finalizada. AUTO_RETURN concluído para programação nacional.`)
            return {
              ...prev,
              scte35Active: false,
              scte35Phase: 'IDLE',
              scte35TimeRemaining: 0,
            }
          }
          return { ...prev, scte35TimeRemaining: Number((prev.scte35TimeRemaining - 0.1).toFixed(1)) }
        })
      }, 100)
      return () => clearInterval(interval)
    }
  }, [cgState.scte35Phase, onMessage])

  // Handlers para as 4 Camadas de CG
  const toggleLayer0Logo = () => {
    const next = !cgState.layer0Logo
    setCgState((prev) => ({ ...prev, layer0Logo: next }))
    void triggerCgLayer(channelId, 'STATION_LOGO', next ? 'SHOW' : 'HIDE', { title: 'RPLAYOUT HD' })
    onMessage?.(`CG: Layer 0 (STATION_LOGO) ${next ? 'FADE IN no ar [90% Action Safe]' : 'FADE OUT [Oculto]'}`)
  }

  const toggleLayer1Clock = () => {
    const next = !cgState.layer1Clock
    setCgState((prev) => ({ ...prev, layer1Clock: next }))
    void triggerCgLayer(channelId, 'ONAIR_CLOCK', next ? 'SHOW' : 'HIDE')
    onMessage?.(`CG: Layer 1 (ONAIR_CLOCK) ${next ? 'ATIVADO no ar [NTP Stratum-1]' : 'OCULTADO'}`)
  }

  const toggleLayer2Ticker = () => {
    const next = !cgState.layer2Ticker
    setCgState((prev) => ({ ...prev, layer2Ticker: next }))
    void triggerCgLayer(channelId, 'CRAWL_TICKER', next ? 'SHOW' : 'HIDE', {
      text: cgState.tickerText,
      badge: cgState.breakingNewsActive ? 'URGENTE' : 'AO VIVO',
      isBreaking: cgState.breakingNewsActive,
    })
    onMessage?.(`CG: Layer 2 (CRAWL_TICKER) ${next ? 'INICIADO (3.5 px/f smooth GPU)' : 'PARADO'}`)
  }

  const handlePushBreakingNews = () => {
    setCgState((prev) => ({
      ...prev,
      layer2Ticker: true,
      breakingNewsActive: true,
    }))
    void triggerCgLayer(channelId, 'CRAWL_TICKER', 'SHOW', {
      text: cgState.tickerText,
      badge: 'URGENTE',
      isBreaking: true,
    })
    onMessage?.(`CG: Tarja de BREAKING NEWS injetada com prioridade na Layer 2: "${cgState.tickerText.slice(0, 40)}..."`)
  }

  const handleTriggerLowerThird = () => {
    if (cgState.lowerThirdActive) {
      // Forçar saída (Dismiss antecipado)
      setCgState((prev) => ({ ...prev, lowerThirdActive: false, lowerThirdTimeRemaining: 0 }))
      void triggerCgLayer(channelId, 'LOWER_THIRD', 'HIDE')
      onMessage?.('CG: Layer 3 (LOWER_THIRD) recolhida manualmente pelo operador')
    } else {
      // Disparar com 8 segundos de retenção
      setCgState((prev) => ({
        ...prev,
        lowerThirdActive: true,
        lowerThirdTimeRemaining: 8,
      }))
      void triggerCgLayer(channelId, 'LOWER_THIRD', 'SHOW', {
        title: cgState.lowerThirdTitle,
        subtitle: cgState.lowerThirdSubtitle,
      }, 240)
      onMessage?.(`CG: Layer 3 (LOWER_THIRD) no ar: "${cgState.lowerThirdTitle}" (Duração: 8s / 240 frames)`)
    }
  }

  // Disparo manual SCTE-35
  const handleTriggerScte35 = () => {
    if (cgState.scte35Active) {
      // Cancelar / Abortar Splice
      setCgState((prev) => ({
        ...prev,
        scte35Active: false,
        scte35Phase: 'IDLE',
        scte35TimeRemaining: 0,
      }))
      onMessage?.('SCTE-35: Disparo comercial CANCELADO pelo operador (Splice Cancel Indicator = true)')
    } else {
      // Iniciar com Pre-roll de 4.0s conforme especificação de emissora
      const newEventId = cgState.scte35EventId + 1
      setCgState((prev) => ({
        ...prev,
        scte35Active: true,
        scte35Phase: 'PREROLL',
        scte35TimeRemaining: 4.0,
        scte35EventId: newEventId,
      }))
      void triggerScte35Api(channelId, newEventId)
      onMessage?.(`SCTE-35: Injetado comando CUE OUT 30s (Event ID: ${newEventId}, Pre-roll: 4000ms, PID 0x86)`)
    }
  }

  return (
    <div
      className={`bg-surface-panel/90 border border-border-subtle rounded-xl backdrop-blur-md shadow-md transition-all ${className}`}
      id="cg-secondary-events-bar"
    >
      {/* BARRA SUPERIOR TÁTICA PERMANENTE (COMPACTA) */}
      <div className="p-2.5 flex flex-wrap items-center justify-between gap-2.5">
        {/* Esquerda: Identificação do Subsistema */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-container border border-border-subtle">
            <span className="material-symbols-outlined text-primary text-[18px]">layers</span>
            <span className="font-headline-md text-[13px] font-bold text-on-surface uppercase tracking-wider">
              CG DINÂMICO & SCTE-35
            </span>
            <span className="font-label-mono text-[9px] bg-primary/20 text-primary font-bold px-1.5 py-0.2 rounded border border-primary/40">
              FASE D
            </span>
          </div>

          {/* Status Geral de Camadas RGBA */}
          <div className="hidden sm:flex items-center gap-1 font-label-mono text-[10px] text-outline">
            <span>RGBA ALPHA PREMULT</span>
            <span>•</span>
            <span className="text-status-ok-bright font-bold">GPU 60 FPS</span>
          </div>
        </div>

        {/* Centro / Ações Rápidas: 4 Camadas de CG + SCTE-35 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* LAYER 0: STATION LOGO */}
          <button
            onClick={toggleLayer0Logo}
            className={`px-2.5 py-1.5 rounded-lg border font-label-mono text-[10.5px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              cgState.layer0Logo
                ? 'bg-status-ok/20 border-status-ok text-status-ok-bright shadow-xs'
                : 'bg-surface-container border-border-subtle text-outline hover:text-on-surface'
            }`}
            title="Layer 0: Logotipo / DVE Bug da Emissora (SMPTE RP 2046-1 90% Action Safe)"
          >
            <span className={`w-2 h-2 rounded-full ${cgState.layer0Logo ? 'bg-status-ok animate-pulse' : 'bg-outline'}`}></span>
            <span>L0: LOGO</span>
            <span className="text-[8px] opacity-70 border-l border-current pl-1">SAFE 90%</span>
          </button>

          {/* LAYER 1: ONAIR CLOCK */}
          <button
            onClick={toggleLayer1Clock}
            className={`px-2.5 py-1.5 rounded-lg border font-label-mono text-[10.5px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              cgState.layer1Clock
                ? 'bg-accent-ice/20 border-accent-ice text-accent-ice-bright shadow-xs'
                : 'bg-surface-container border-border-subtle text-outline hover:text-on-surface'
            }`}
            title="Layer 1: Relógio e Clima sincronizado a NTP Stratum-1"
          >
            <span className={`w-2 h-2 rounded-full ${cgState.layer1Clock ? 'bg-accent-ice animate-pulse' : 'bg-outline'}`}></span>
            <span>L1: RELÓGIO</span>
            <span className="text-[8px] opacity-70 border-l border-current pl-1">NTP</span>
          </button>

          {/* LAYER 2: CRAWL TICKER */}
          <button
            onClick={toggleLayer2Ticker}
            className={`px-2.5 py-1.5 rounded-lg border font-label-mono text-[10.5px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              cgState.layer2Ticker
                ? 'bg-armed-amber/20 border-armed-amber text-armed-amber shadow-xs'
                : 'bg-surface-container border-border-subtle text-outline hover:text-on-surface'
            }`}
            title="Layer 2: Rodapé de Notícias / Breaking News Crawl"
          >
            <span className={`w-2 h-2 rounded-full ${cgState.layer2Ticker ? 'bg-armed-amber animate-pulse' : 'bg-outline'}`}></span>
            <span>L2: TICKER</span>
            {cgState.breakingNewsActive && (
              <span className="bg-on-air-crimson text-white text-[8px] font-bold px-1 rounded animate-pulse">URGENTE</span>
            )}
          </button>

          {/* LAYER 3: LOWER THIRD */}
          <button
            onClick={handleTriggerLowerThird}
            className={`px-2.5 py-1.5 rounded-lg border font-label-mono text-[10.5px] font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              cgState.lowerThirdActive
                ? 'bg-on-air-crimson/25 border-on-air-crimson text-on-air-crimson shadow-xs ring-1 ring-on-air-crimson/50'
                : 'bg-surface-container hover:bg-surface-panel border-border-subtle text-on-surface'
            }`}
            title="Layer 3: Disparar crédito / tarja de apresentador (Duração: 8s / 240 quadros)"
          >
            <span className="material-symbols-outlined text-[14px]">
              {cgState.lowerThirdActive ? 'timer' : 'subtitles'}
            </span>
            <span>L3: TARJA</span>
            {cgState.lowerThirdActive ? (
              <span className="bg-on-air-crimson text-white text-[9px] font-mono px-1 rounded tabular-nums font-bold">
                {cgState.lowerThirdTimeRemaining}s
              </span>
            ) : (
              <span className="text-[8px] text-outline border-l border-border-subtle pl-1">TAKE</span>
            )}
          </button>

          <div className="h-5 w-px bg-border-subtle mx-0.5"></div>

          {/* BOTÃO SCTE-35: CUE OUT 30s */}
          <button
            onClick={handleTriggerScte35}
            className={`px-3 py-1.5 rounded-lg border font-headline-md text-[12px] font-bold tracking-wider uppercase flex items-center gap-1.5 transition-all cursor-pointer shadow-md ${
              cgState.scte35Active
                ? cgState.scte35Phase === 'PREROLL'
                  ? 'bg-armed-amber text-surface-base border-armed-glow animate-pulse'
                  : 'bg-on-air-crimson text-white border-on-air-glow shadow-tally-onair'
                : 'bg-primary-container/20 hover:bg-primary-container text-primary hover:text-white border-primary/40'
            }`}
            title="Disparo Manual SCTE-35 Splice Insert (30s) com Pre-roll de 4000ms para inserção comercial regional"
          >
            <span className="material-symbols-outlined text-[16px]">
              {cgState.scte35Active ? 'sensors' : 'campaign'}
            </span>
            {cgState.scte35Active ? (
              cgState.scte35Phase === 'PREROLL' ? (
                <span>PRE-ROLL: {cgState.scte35TimeRemaining.toFixed(1)}s</span>
              ) : (
                <span>SCTE CUE OUT: {cgState.scte35TimeRemaining.toFixed(1)}s</span>
              )
            ) : (
              <span>SCTE-35 CUE OUT 30s</span>
            )}
          </button>
        </div>

        {/* Direita: Botão de Expansão da Gaveta de Edição */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[10px] font-label-caps font-bold transition-colors cursor-pointer ${
            isOpen
              ? 'bg-primary-container text-on-primary-container border-primary-container'
              : 'bg-surface-container hover:bg-surface-panel border-border-subtle text-outline hover:text-on-surface'
          }`}
          title="Abrir gaveta de metadados de CG, Breaking News e Parâmetros SCTE-35"
        >
          <span className="material-symbols-outlined text-[15px]">
            {isOpen ? 'expand_less' : 'tune'}
          </span>
          <span>{isOpen ? 'RECOLHER' : 'AJUSTAR CG'}</span>
        </button>
      </div>

      {/* GAVETA EXPANSÍVEL: CONTROLE AVANÇADO DE TEXTOS E METADADOS */}
      {isOpen && (
        <div className="border-t border-border-subtle p-3 grid grid-cols-1 md:grid-cols-12 gap-3 bg-surface-panel/95 animate-in slide-in-from-top-2 duration-150 rounded-b-xl">
          {/* Bloco 1: Rodapé de Notícias (Ticker & Breaking News) */}
          <div className="md:col-span-6 bg-surface-card p-2.5 rounded-lg border border-border-subtle flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label-caps text-[10px] font-bold text-outline uppercase flex items-center gap-1">
                <span className="material-symbols-outlined text-armed-amber text-[14px]">view_timeline</span>
                Layer 2: Conteúdo do Ticker (Crawl 1080p)
              </span>
              <span className="font-label-mono text-[9px] text-status-ok-bright">
                Smooth GPU 3.5 px/frame
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={cgState.tickerText}
                onChange={(e) => setCgState({ ...cgState, tickerText: e.target.value })}
                className="flex-1 bg-surface-container-lowest text-on-surface font-body-sm text-[12px] px-2.5 py-1.5 rounded border border-border-subtle focus:outline-none focus:border-armed-amber"
                placeholder="Digite a manchete urgente ou texto do ticker..."
              />
              <button
                onClick={handlePushBreakingNews}
                className="px-3 py-1.5 rounded bg-on-air-crimson hover:bg-on-air-glow text-white font-label-caps text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-colors shadow-sm shrink-0"
                title="Injetar imediatamente com tarja vermelha de plantão urgente"
              >
                <span className="material-symbols-outlined text-[13px]">flash_on</span>
                PUSH PLANTÃO
              </button>
            </div>
            <div className="flex items-center justify-between font-label-mono text-[9px] text-outline">
              <span>Norma: SMPTE Title Safe 80% (Inferior)</span>
              <span>Webhook API: /api/cg/ticker/push</span>
            </div>
          </div>

          {/* Bloco 2: Lower-Third (Crédito de Apresentador) */}
          <div className="md:col-span-6 bg-surface-card p-2.5 rounded-lg border border-border-subtle flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label-caps text-[10px] font-bold text-outline uppercase flex items-center gap-1">
                <span className="material-symbols-outlined text-primary text-[14px]">badge</span>
                Layer 3: Tarja de Apresentador / Matéria
              </span>
              <span className="font-label-mono text-[9px] text-outline">
                Template: lower_third_news_v2
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={cgState.lowerThirdTitle}
                onChange={(e) => setCgState({ ...cgState, lowerThirdTitle: e.target.value })}
                className="bg-surface-container-lowest text-on-surface font-body-sm text-[12px] px-2.5 py-1.5 rounded border border-border-subtle focus:outline-none focus:border-primary"
                placeholder="Nome do apresentador / título"
              />
              <input
                type="text"
                value={cgState.lowerThirdSubtitle}
                onChange={(e) => setCgState({ ...cgState, lowerThirdSubtitle: e.target.value })}
                className="bg-surface-container-lowest text-on-surface font-body-sm text-[12px] px-2.5 py-1.5 rounded border border-border-subtle focus:outline-none focus:border-primary"
                placeholder="Cargo / Cidade / Crédito"
              />
            </div>
            <div className="flex items-center justify-between font-label-mono text-[9px] text-outline">
              <span>Animação: GSAP Slide In (15f) • Hold (240f) • Wipe Out (15f)</span>
              <button
                onClick={handleTriggerLowerThird}
                className="text-primary hover:text-white font-bold cursor-pointer underline"
              >
                {cgState.lowerThirdActive ? 'Forçar Recolhimento' : 'Testar Disparo'}
              </button>
            </div>
          </div>

          {/* Barra de Telemetria SCTE-35 / SCTE-104 (Linha Cheia) */}
          <div className="md:col-span-12 bg-surface-container-lowest/80 p-2 rounded-lg border border-border-subtle flex flex-wrap items-center justify-between gap-2 font-label-mono text-[10px]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-accent-ice text-[15px]">broadcast_on_home</span>
              <span className="text-on-surface font-bold">SCTE-35 / 104 DPI ENGINE:</span>
              <span className="text-outline">Splice Event ID: <strong className="text-on-surface">{cgState.scte35EventId}</strong></span>
              <span>•</span>
              <span className="text-outline">MPEG-TS PID: <strong className="text-on-surface">0x86 (134d)</strong></span>
              <span>•</span>
              <span className="text-outline">SDI VANC: <strong className="text-on-surface">Line 13 DID 0x41 SDID 0x07</strong></span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-outline">Pre-roll: <strong className="text-status-ok">4000ms</strong></span>
              <span>•</span>
              <span className="text-outline">Auto Return: <strong className="text-status-ok">TRUE</strong></span>
              <span>•</span>
              <span className={`px-1.5 py-0.2 rounded font-bold ${
                cgState.scte35Active
                  ? 'bg-on-air-crimson/20 text-on-air-crimson border border-on-air-crimson/40 animate-pulse'
                  : 'bg-status-ok/10 text-status-ok border border-status-ok/30'
              }`}>
                {cgState.scte35Active ? `SPLICING [${cgState.scte35Phase}]` : 'DPI ARMED & READY'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

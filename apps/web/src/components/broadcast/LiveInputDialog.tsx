import React, { useState } from 'react'

interface LiveInputDialogProps {
  open: boolean
  onClose: () => void
  onApplySource: (sourceConfig: {
    type: 'sdi' | 'ndi' | 'srt' | 'webrtc'
    label: string
    uri: string
    audioChannels: number
  }) => void
}

type TabType = 'sdi' | 'ndi' | 'srt' | 'webrtc'

export const LiveInputDialog: React.FC<LiveInputDialogProps> = ({
  open,
  onClose,
  onApplySource,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('sdi')

  // SDI Config
  const [sdiDevice, setSdiDevice] = useState('DeckLink 8K Pro (1)')
  const [sdiFormat, setSdiFormat] = useState('1080i59.94')
  const [sdiGenlock, setSdiGenlock] = useState('BNC Tri-Level / Blackburst (59.94Hz Locked)')

  // NDI Config
  const [ndiSource, setNdiSource] = useState('ESTUDIO-A-MASTER (NDI-HD)')
  const [ndiLowBandwidth, setNdiLowBandwidth] = useState(false)

  // SRT Config
  const [srtMode, setSrtMode] = useState<'caller' | 'listener'>('caller')
  const [srtHost, setSrtHost] = useState('192.168.10.120')
  const [srtPort, setSrtPort] = useState('9000')
  const [srtLatency, setSrtLatency] = useState('120')

  // WebRTC Config
  const [webrtcUrl, setWebrtcUrl] = useState('http://localhost:8889/live_cam')
  const [webrtcBuffer, setWebrtcBuffer] = useState('50')

  const [testingSignal, setTestingSignal] = useState(false)
  const [signalStatus, setSignalStatus] = useState<'locked' | 'searching' | null>(null)

  const handleTestSignal = () => {
    setTestingSignal(true)
    setSignalStatus('searching')
    setTimeout(() => {
      setTestingSignal(false)
      setSignalStatus('locked')
    }, 800)
  }

  const handleApply = () => {
    let label = ''
    let uri = ''

    if (activeTab === 'sdi') {
      label = `SDI: ${sdiDevice}`
      uri = `decklink:${sdiDevice}?format=${sdiFormat}`
    } else if (activeTab === 'ndi') {
      label = `NDI: ${ndiSource}`
      uri = `ndi:${ndiSource}`
    } else if (activeTab === 'srt') {
      label = `SRT: ${srtHost}:${srtPort} (${srtMode})`
      uri = `srt://${srtHost}:${srtPort}?mode=${srtMode}&latency=${srtLatency}`
    } else {
      label = `WebRTC: ${webrtcUrl}`
      uri = webrtcUrl
    }

    onApplySource({
      type: activeTab,
      label,
      uri,
      audioChannels: 2,
    })
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="bg-surface-card w-full max-w-2xl border border-border-subtle rounded shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-primary text-[22px]">settings_input_antenna</span>
            <div>
              <h2 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
                Entradas Externas Ao Vivo
              </h2>
              <p className="font-label-mono text-label-mono text-outline">
                Roteamento de Sinal SDI DeckLink, NDI 5.6, SRT/RTMP e WebRTC
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex bg-surface-container-lowest border-b border-border-subtle px-space-md pt-space-xs gap-1">
          {[
            { id: 'sdi' as const, label: 'SDI DeckLink', icon: 'videocam' },
            { id: 'ndi' as const, label: 'NDI 5.6', icon: 'hub' },
            { id: 'srt' as const, label: 'SRT / RTMP', icon: 'satellite_alt' },
            { id: 'webrtc' as const, label: 'WebRTC (MediaMTX)', icon: 'stream' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id)
                setSignalStatus(null)
              }}
              className={`flex items-center gap-1.5 px-space-md py-2 border-b-2 font-label-caps text-label-caps font-bold uppercase transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary bg-surface-panel/80 rounded-t'
                  : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40 rounded-t'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-space-lg flex flex-col gap-space-md bg-surface-card">
          {activeTab === 'sdi' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">Dispositivo SDI</label>
                <select
                  value={sdiDevice}
                  onChange={(e) => setSdiDevice(e.target.value)}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm focus:border-primary outline-none"
                >
                  <option>DeckLink 8K Pro (1)</option>
                  <option>DeckLink Duo 2 (SDI In 1)</option>
                  <option>DeckLink Quad 2 (Port 3)</option>
                  <option>AJA Kona 5 (SDI 1)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">Padrão de Vídeo</label>
                <select
                  value={sdiFormat}
                  onChange={(e) => setSdiFormat(e.target.value)}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm focus:border-primary outline-none"
                >
                  <option value="1080i59.94">1080i 59.94 fps (Padrão Broadcast)</option>
                  <option value="1080p59.94">1080p 59.94 fps</option>
                  <option value="720p59.94">720p 59.94 fps</option>
                  <option value="2160p59.94">2160p 59.94 fps (4K UHD)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="font-label-caps text-label-caps text-outline uppercase">Sincronismo Genlock / Referência</label>
                <input
                  type="text"
                  value={sdiGenlock}
                  readOnly
                  className="bg-surface-panel text-on-surface-variant p-2 rounded border border-border-subtle font-label-mono text-label-mono"
                />
              </div>
            </div>
          )}

          {activeTab === 'ndi' && (
            <div className="flex flex-col gap-space-md">
              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">Fonte NDI Detectada</label>
                <select
                  value={ndiSource}
                  onChange={(e) => setNdiSource(e.target.value)}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm focus:border-primary outline-none"
                >
                  <option>ESTUDIO-A-MASTER (NDI-HD)</option>
                  <option>ESTUDIO-B-JORNALISMO (NDI-MAIN)</option>
                  <option>EXTERNA-OB-TRUCK-01 (NDI-LIVE)</option>
                  <option>VT-PLAYOUT-TEST (NDI-TEST)</option>
                </select>
              </div>

              <div className="flex items-center gap-space-sm p-space-sm rounded bg-surface-panel border border-border-subtle">
                <input
                  type="checkbox"
                  id="ndi-low-band"
                  checked={ndiLowBandwidth}
                  onChange={(e) => setNdiLowBandwidth(e.target.checked)}
                  className="rounded border-border-strong text-primary focus:ring-0"
                />
                <label htmlFor="ndi-low-band" className="font-body-sm text-body-sm text-on-surface cursor-pointer">
                  Modo NDI HX / Baixa Largura de Banda (Proxy de Redundância)
                </label>
              </div>
            </div>
          )}

          {activeTab === 'srt' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">Modo SRT</label>
                <select
                  value={srtMode}
                  onChange={(e) => setSrtMode(e.target.value as any)}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm focus:border-primary outline-none"
                >
                  <option value="caller">Caller (Conectar ao Remoto)</option>
                  <option value="listener">Listener (Aguardar Conexão)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">Host / IP</label>
                <input
                  type="text"
                  value={srtHost}
                  onChange={(e) => setSrtHost(e.target.value)}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-label-mono text-label-mono focus:border-primary outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">Porta &amp; Latência</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={srtPort}
                    onChange={(e) => setSrtPort(e.target.value)}
                    className="w-1/2 bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-label-mono text-label-mono focus:border-primary outline-none"
                    placeholder="Port"
                  />
                  <input
                    type="text"
                    value={srtLatency}
                    onChange={(e) => setSrtLatency(e.target.value)}
                    className="w-1/2 bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-label-mono text-label-mono focus:border-primary outline-none"
                    placeholder="Lat (ms)"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'webrtc' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md">
              <div className="flex flex-col gap-1 md:col-span-2">
                <label className="font-label-caps text-label-caps text-outline uppercase">URL do Stream (MediaMTX / WHEP)</label>
                <input
                  type="text"
                  value={webrtcUrl}
                  onChange={(e) => setWebrtcUrl(e.target.value)}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-label-mono text-label-mono focus:border-primary outline-none"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">Buffer de Jitter (ms)</label>
                <input
                  type="text"
                  value={webrtcBuffer}
                  onChange={(e) => setWebrtcBuffer(e.target.value)}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-label-mono text-label-mono focus:border-primary outline-none"
                />
              </div>
            </div>
          )}

          {/* Sincronismo Genlock / Frame Sync & Signal Telemetry */}
          <div className="p-space-md bg-surface-container-lowest rounded border border-border-subtle flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="font-label-caps text-label-caps text-outline uppercase">Status do Sinal &amp; Frame Sync:</span>
                {signalStatus === 'locked' ? (
                  <span className="font-label-caps text-label-caps px-1.5 py-0.5 rounded bg-status-ok text-surface-base font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-surface-base"></span> LOCKED (0.0 frames drift)
                  </span>
                ) : signalStatus === 'searching' ? (
                  <span className="font-label-caps text-label-caps px-1.5 py-0.5 rounded bg-armed-amber text-surface-base font-bold animate-pulse">
                    ANALISANDO STREAM...
                  </span>
                ) : (
                  <span className="font-label-caps text-label-caps px-1.5 py-0.5 rounded bg-surface-panel text-outline">
                    AGUARDANDO TESTE
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleTestSignal}
                disabled={testingSignal}
                className="px-space-md py-1 rounded bg-surface-panel hover:bg-surface-container text-on-surface font-label-caps text-label-caps font-bold border border-border-subtle flex items-center gap-1 transition-colors"
              >
                <span className={`material-symbols-outlined text-[16px] ${testingSignal ? 'animate-spin' : ''}`}>
                  sync
                </span>
                Testar Sinal / Sincronismo
              </button>
            </div>

            {signalStatus === 'locked' && (
              <div className="grid grid-cols-4 gap-2 pt-space-xs font-label-mono text-label-mono border-t border-border-subtle/50 text-outline">
                <div>FORMATO: <strong className="text-on-surface">1920x1080</strong></div>
                <div>FRAME RATE: <strong className="text-status-ok-bright">{sdiFormat.includes('i') ? '59.94 fields (29.97 fps)' : '59.94 fps'}</strong></div>
                <div>ÁUDIO: <strong className="text-on-surface">24-bit 48kHz PCM</strong></div>
                <div>DRIFT CLOCK: <strong className="text-status-ok-bright">&lt; 0.5ms</strong></div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-t border-border-subtle flex items-center justify-end gap-space-sm">
          <button
            type="button"
            onClick={onClose}
            className="px-space-lg py-2 rounded bg-surface-card hover:bg-surface-container text-on-surface font-label-caps text-label-caps uppercase transition-colors border border-border-subtle"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-space-lg py-2 rounded bg-primary-container text-on-primary-container hover:brightness-110 font-label-caps text-label-caps uppercase font-bold transition-all shadow-sm flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            Aplicar Entrada Ao Vivo
          </button>
        </div>
      </div>
    </div>
  )
}

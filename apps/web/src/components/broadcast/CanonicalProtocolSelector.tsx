import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../../api.js'
import type { SourceList, LiveSource } from '../../types.js'

export type ProtocolKind = 'NDI' | 'SDI' | 'SRT' | 'RTMP' | 'FILE' | 'OMT'

export interface ProtocolResult {
  kind: ProtocolKind
  targetUri: string
  nameRecommendation?: string
  isHardwareValid: boolean
}

interface Props {
  mode: 'INPUT' | 'OUTPUT'
  defaultKind?: ProtocolKind
  initialUri?: string
  onChange: (result: ProtocolResult) => void
  className?: string
}

export function CanonicalProtocolSelector({
  mode,
  defaultKind,
  initialUri = '',
  onChange,
  className = '',
}: Props) {
  // Protocolo selecionado
  const [kind, setKind] = useState<ProtocolKind>(() => {
    if (defaultKind) return defaultKind
    if (mode === 'INPUT') return 'SDI'
    return 'RTMP'
  })

  // Hardware e fontes de rede detectadas
  const [sources, setSources] = useState<SourceList | null>(null)
  const [isLoadingSources, setIsLoadingSources] = useState(false)
  const [sourcesError, setSourcesError] = useState<string | null>(null)

  // Campos específicos de cada protocolo
  // SDI (DeckLink)
  const [selectedSdiDevice, setSelectedSdiDevice] = useState<string>('0')
  const [manualSdiDevice, setManualSdiDevice] = useState<string>('')
  const [useManualSdi, setUseManualSdi] = useState(false)

  // NDI
  const [selectedNdiSource, setSelectedNdiSource] = useState<string>('')
  const [manualNdiSource, setManualNdiSource] = useState<string>('RPLAYOUT_PGM_MASTER')
  const [useManualNdi, setUseManualNdi] = useState(false)

  // SRT
  const [srtHost, setSrtHost] = useState('127.0.0.1')
  const [srtPort, setSrtPort] = useState(9000)
  const [srtMode, setSrtMode] = useState<'caller' | 'listener' | 'rendezvous'>(
    mode === 'INPUT' ? 'listener' : 'caller',
  )
  const [srtPassphrase, setSrtPassphrase] = useState('')
  const [srtLatency, setSrtLatency] = useState(800)
  const [srtStreamId, setSrtStreamId] = useState('')
  const [showSrtPassphrase, setShowSrtPassphrase] = useState(false)

  // RTMP
  const [rtmpAddress, setRtmpAddress] = useState(
    mode === 'INPUT' ? 'rtmp://127.0.0.1/live' : 'rtmp://a.rtmp.youtube.com/live2',
  )
  const [rtmpPort, setRtmpPort] = useState(1935)
  const [rtmpStreamKey, setRtmpStreamKey] = useState('')
  const [rtmpLatency, setRtmpLatency] = useState(2000)
  const [showRtmpKey, setShowRtmpKey] = useState(false)

  // FILE (Apenas Output)
  const [filePath, setFilePath] = useState('gravações/canal-master.mp4')

  // OMT/SMPTE-2110: anúncios NMOS identificam o serviço, mas o fluxo precisa
  // de URI RTP/SDP explícita para ser aberto.
  const [omtAddress, setOmtAddress] = useState('omt://239.255.0.1:5004')

  // Busca fontes físicas e de rede
  const fetchSources = useCallback(async (refresh = false) => {
    setIsLoadingSources(true)
    setSourcesError(null)
    try {
      const data = await api.sources(refresh)
      setSources(data)

      // Atualiza seleção inicial se houver dispositivos detectados
      if (data.sdi.sources.length > 0 && !selectedSdiDevice) {
        const first = data.sdi.sources[0]?.reference.replace(/^sdi:/, '') ?? '0'
        setSelectedSdiDevice(first)
      }
      if (data.ndi.sources.length > 0 && !selectedNdiSource) {
        setSelectedNdiSource(data.ndi.sources[0]?.reference ?? '')
      }
    } catch (err: any) {
      console.warn('Não foi possível consultar fontes de hardware:', err)
      setSourcesError('Driver de hardware ou serviço de descoberta indisponível.')
    } finally {
      setIsLoadingSources(false)
    }
  }, [selectedSdiDevice, selectedNdiSource])

  useEffect(() => {
    void fetchSources()
  }, [fetchSources])

  // Lista de protocolos disponíveis
  const availableProtocols: ProtocolKind[] = useMemo(() => {
    if (mode === 'INPUT') {
      return ['SDI', 'NDI', 'SRT', 'RTMP', 'OMT']
    }
    return ['RTMP', 'SRT', 'SDI', 'NDI', 'OMT', 'FILE']
  }, [mode])

  // Montagem do URI canônico e validação
  const computedResult = useMemo<ProtocolResult>(() => {
    let uri = ''
    let nameRec = ''
    let isValid = true

    switch (kind) {
      case 'SDI': {
        const hasHardware = (sources?.sdi.sources.length ?? 0) > 0
        if (!hasHardware && !useManualSdi) {
          isValid = false
        }
        const dev = useManualSdi ? manualSdiDevice.trim().replace(/^sdi:/, '') : selectedSdiDevice
        uri = `sdi:${dev || '0'}`
        nameRec = `DeckLink SDI Porta ${dev || '0'}`
        break
      }

      case 'NDI': {
        if (mode === 'INPUT') {
          const hasSources = (sources?.ndi.sources.length ?? 0) > 0
          if (!hasSources || useManualNdi) {
            const cleanName = manualNdiSource.trim().replace(/^ndi:(\/\/)?/, '')
            uri = cleanName ? `ndi:${cleanName}` : ''
            nameRec = `NDI ${cleanName || 'Fonte Externa'}`
          } else {
            const raw = selectedNdiSource || sources?.ndi.sources[0]?.reference || ''
            const cleanRaw = raw.replace(/^ndi:(\/\/)?/, '')
            uri = cleanRaw ? `ndi:${cleanRaw}` : ''
            nameRec = `NDI ${cleanRaw}`
          }
        } else {
          const cleanName = manualNdiSource.trim().replace(/^ndi:(\/\/)?/, '')
          uri = cleanName ? `ndi:${cleanName}` : 'ndi:RPLAYOUT_PGM_MASTER'
          nameRec = `NDI Saída ${cleanName || 'PGM'}`
        }
        break
      }

      case 'SRT': {
        const cleanHost = srtHost.trim() || '127.0.0.1'
        const cleanPort = Number(srtPort) || 9000
        const query = new URLSearchParams()
        query.set('mode', srtMode)
        if (srtLatency) query.set('latency', String(srtLatency))
        if (srtPassphrase.trim()) query.set('passphrase', srtPassphrase.trim())
        if (srtStreamId.trim()) query.set('streamid', srtStreamId.trim())

        uri = `srt://${cleanHost}:${cleanPort}?${query.toString()}`
        nameRec = `SRT ${srtMode.toUpperCase()} :${cleanPort}`
        break
      }

      case 'RTMP': {
        let base = rtmpAddress.trim()
        if (!base.startsWith('rtmp://') && !base.startsWith('rtmps://')) {
          base = `rtmp://${base}`
        }
        if (rtmpStreamKey.trim()) {
          base = `${base.replace(/\/+$/, '')}/${rtmpStreamKey.trim()}`
        }
        uri = base
        nameRec = `RTMP Stream`
        break
      }

      case 'FILE': {
        uri = filePath.trim()
        nameRec = `Gravação Arquivo Local`
        break
      }

      case 'OMT': {
        uri = omtAddress.trim()
        nameRec = `OMT / SMPTE-2110`
        break
      }
    }

    return {
      kind,
      targetUri: uri,
      nameRecommendation: nameRec,
      isHardwareValid: isValid,
    }
  }, [
    kind,
    mode,
    sources,
    selectedSdiDevice,
    manualSdiDevice,
    useManualSdi,
    selectedNdiSource,
    manualNdiSource,
    useManualNdi,
    srtHost,
    srtPort,
    srtMode,
    srtPassphrase,
    srtLatency,
    srtStreamId,
    rtmpAddress,
    rtmpStreamKey,
    filePath,
    omtAddress,
  ])

  // Propaga alterações para o componente pai
  useEffect(() => {
    onChange(computedResult)
  }, [computedResult, onChange])

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Seletor de Protocolo (Abas Táticas) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-label-caps text-outline uppercase font-bold flex items-center justify-between">
          <span>Protocolo de {mode === 'INPUT' ? 'Entrada Ao Vivo' : 'Saída de Transmissão'}</span>
          <button
            type="button"
            onClick={() => void fetchSources(true)}
            disabled={isLoadingSources}
            className="text-primary hover:text-accent-ice text-[9px] lowercase flex items-center gap-1 cursor-pointer transition-colors"
            title="Escanear rede e placas novamente"
          >
            <span className={`material-symbols-outlined text-[12px] ${isLoadingSources ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>{isLoadingSources ? 'varrendo hardware...' : 'escanear dispositivos'}</span>
          </button>
        </label>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-surface-base rounded-lg border border-border-subtle">
          {availableProtocols.map((p) => {
            const isSelected = kind === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => setKind(p)}
                className={`py-1.5 px-2 rounded text-center font-label-caps text-[10.5px] font-bold transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-primary text-surface-base border-primary shadow-xs'
                    : 'bg-surface-panel/40 border-transparent text-outline hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                {p === 'SDI' && 'DeckLink SDI'}
                {p === 'NDI' && 'NDI Broadcast'}
                {p === 'SRT' && 'SRT Stream'}
                {p === 'RTMP' && 'RTMP / CDN'}
                {p === 'FILE' && 'Gravação Local'}
                {p === 'OMT' && 'OMT IP'}
              </button>
            )
          })}
        </div>
      </div>

      {/* PAINEL DEDICADO POR PROTOCOLO */}

      {/* 1. PROTOCOLO DECKLINK / SDI */}
      {kind === 'SDI' && (
        <div className="p-3 bg-surface-panel/60 rounded-lg border border-border-subtle flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-label-caps text-on-surface font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[15px]">developer_board</span>
              Blackmagic DeckLink • Portas Físicas de Hardware
            </span>
            {sources?.sdi.available && (
              <span className="text-[9px] font-label-mono text-status-ok-bright font-bold px-1.5 py-0.2 rounded bg-status-ok/15 border border-status-ok/30">
                DRIVER DETECTADO
              </span>
            )}
          </div>

          {/* Verificação estrita de hardware: só lista se tiver placa instalada */}
          {!sources?.sdi.available || (sources.sdi.sources.length === 0 && !useManualSdi) ? (
            <div className="p-2.5 rounded bg-armed-amber/10 border border-armed-amber/30 text-armed-amber flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                <span>Nenhuma placa DeckLink detectada pelo driver</span>
              </div>
              <p className="text-[10px] text-on-surface-variant font-label-mono">
                {sources?.sdi.reason ||
                  'O driver Blackmagic Desktop Video não está instalado ou nenhuma porta física foi encontrada nesta máquina.'}
              </p>
              <button
                type="button"
                onClick={() => setUseManualSdi(true)}
                className="self-start text-[9.5px] font-bold text-accent-ice hover:underline mt-1 cursor-pointer"
              >
                + Informar conector manualmente (ex: sdi:0)
              </button>
            </div>
          ) : useManualSdi ? (
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Conector SDI Manual
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualSdiDevice}
                  onChange={(e) => setManualSdiDevice(e.target.value)}
                  placeholder="0 (para conector SDI 1)"
                  className="flex-1 bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setUseManualSdi(false)}
                  className="px-2 py-1 bg-surface-container rounded text-outline hover:text-on-surface text-[10px] font-label-caps cursor-pointer"
                >
                  Voltar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Porta Física Detectada pelo Driver
              </label>
              <select
                value={selectedSdiDevice}
                onChange={(e) => setSelectedSdiDevice(e.target.value)}
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary cursor-pointer"
              >
                {sources.sdi.sources.map((s) => {
                  const devIdx = s.reference.replace(/^sdi:/, '')
                  return (
                    <option key={s.reference} value={devIdx}>
                      {s.reference} — {s.label}
                    </option>
                  )
                })}
              </select>
            </div>
          )}
        </div>
      )}

      {/* 2. PROTOCOLO NDI */}
      {kind === 'NDI' && (
        <div className="p-3 bg-surface-panel/60 rounded-lg border border-border-subtle flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-label-caps text-on-surface font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-[15px]">sensors</span>
              NDI 5.6 • Fontes de Rede Local
            </span>
            <span className="text-[9px] font-label-mono text-accent-ice font-bold">
              mDNS / Discovery Server
            </span>
          </div>

          {mode === 'INPUT' ? (
            sources && sources.ndi.sources.length > 0 && !useManualNdi ? (
              <div className="flex flex-col gap-1">
                <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                  Fontes NDI Ativas Encontradas na Rede
                </label>
                <select
                  value={selectedNdiSource}
                  onChange={(e) => setSelectedNdiSource(e.target.value)}
                  className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary cursor-pointer"
                >
                  {sources.ndi.sources.map((s) => (
                    <option key={s.reference} value={s.reference}>
                      {s.label} ({s.reference})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setUseManualNdi(true)}
                  className="self-start text-[9.5px] font-bold text-accent-ice hover:underline mt-1 cursor-pointer"
                >
                  + Digitar nome de stream NDI personalizado
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="p-2 rounded bg-surface-base border border-border-subtle text-[10px] text-outline flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-armed-amber">info</span>
                  <span>
                    Nenhuma fonte NDI ativa transmitindo na rede local neste momento. Informe o nome da fonte:
                  </span>
                </div>
                <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                  Nome do Dispositivo / Stream NDI
                </label>
                <input
                  type="text"
                  value={manualNdiSource}
                  onChange={(e) => setManualNdiSource(e.target.value)}
                  placeholder="ex: ESTUDIO-MASTER/PGM ou TRICASTER-1"
                  className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
            )
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Nome da Fonte NDI Transmitida para a Rede
              </label>
              <input
                type="text"
                value={manualNdiSource}
                onChange={(e) => setManualNdiSource(e.target.value)}
                placeholder="RPLAYOUT_PGM_MASTER"
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
              <span className="text-[9px] text-outline">
                Será anunciada automaticamente como fonte NDI para outros switchers (TriCaster, vMix, OBS).
              </span>
            </div>
          )}
        </div>
      )}

      {/* 3. PROTOCOLO SRT */}
      {kind === 'SRT' && (
        <div className="p-3 bg-surface-panel/60 rounded-lg border border-border-subtle flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-label-caps text-on-surface font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-purple-400 text-[15px]">lock</span>
              Secure Reliable Transport (SRT) • Conexão Ponto a Ponto
            </span>
            <span className="text-[9px] font-label-mono text-purple-400 font-bold">
              ARQ + AES-256
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Host / Endereço */}
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Host / Endereço IP Remoto ou Local
              </label>
              <input
                type="text"
                value={srtHost}
                onChange={(e) => setSrtHost(e.target.value)}
                placeholder="127.0.0.1 ou srt.emissora.tv"
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            {/* Porta */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Porta UDP
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={srtPort}
                onChange={(e) => setSrtPort(Number(e.target.value) || 9000)}
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Modo de Conexão */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Modo SRT
              </label>
              <select
                value={srtMode}
                onChange={(e) => setSrtMode(e.target.value as any)}
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="caller">caller (conecta ao destino)</option>
                <option value="listener">listener (aguarda conexão)</option>
                <option value="rendezvous">rendezvous (peer-to-peer)</option>
              </select>
            </div>

            {/* Latência (Buffer) */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Latência de Buffer (ms)
              </label>
              <input
                type="number"
                min={20}
                max={8000}
                step={1}
                value={srtLatency}
                onChange={(e) => setSrtLatency(Number(e.target.value) || 800)}
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            {/* Senha / Passphrase */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold flex items-center justify-between">
                <span>Senha (Passphrase)</span>
                <button
                  type="button"
                  onClick={() => setShowSrtPassphrase(!showSrtPassphrase)}
                  className="text-outline hover:text-on-surface text-[9px] cursor-pointer"
                >
                  {showSrtPassphrase ? 'ocultar' : 'ver'}
                </button>
              </label>
              <input
                type={showSrtPassphrase ? 'text' : 'password'}
                value={srtPassphrase}
                onChange={(e) => setSrtPassphrase(e.target.value)}
                placeholder="Opcional (AES 128/256)"
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
      )}

      {/* 4. PROTOCOLO RTMP */}
      {kind === 'RTMP' && (
        <div className="p-3 bg-surface-panel/60 rounded-lg border border-border-subtle flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-label-caps text-on-surface font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-red-400 text-[15px]">live_tv</span>
              RTMP / CDN Ingest • YouTube, Twitch, Facebook Live
            </span>
            <span className="text-[9px] font-label-mono text-red-400 font-bold">
              Porta Padrão 1935
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Endereço do Servidor */}
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Endereço do Servidor / URL Base
              </label>
              <input
                type="text"
                value={rtmpAddress}
                onChange={(e) => setRtmpAddress(e.target.value)}
                placeholder="rtmp://a.rtmp.youtube.com/live2"
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            {/* Porta */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Porta TCP
              </label>
              <input
                type="number"
                min={1}
                max={65535}
                value={rtmpPort}
                onChange={(e) => setRtmpPort(Number(e.target.value) || 1935)}
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Chave de Transmissão / Senha */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold flex items-center justify-between">
                <span>Chave de Transmissão (Stream Key / Senha)</span>
                <button
                  type="button"
                  onClick={() => setShowRtmpKey(!showRtmpKey)}
                  className="text-outline hover:text-on-surface text-[9px] cursor-pointer"
                >
                  {showRtmpKey ? 'ocultar' : 'ver'}
                </button>
              </label>
              <input
                type={showRtmpKey ? 'text' : 'password'}
                value={rtmpStreamKey}
                onChange={(e) => setRtmpStreamKey(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            {/* Latência / Buffer */}
            <div className="flex flex-col gap-1">
              <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
                Latência / Buffer (ms)
              </label>
              <input
                type="number"
                min={100}
                max={10000}
                step={1}
                value={rtmpLatency}
                onChange={(e) => setRtmpLatency(Number(e.target.value) || 2000)}
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
      )}

      {/* 5. PROTOCOLO ARQUIVO (OUTPUT) */}
      {kind === 'FILE' && (
        <div className="p-3 bg-surface-panel/60 rounded-lg border border-border-subtle flex flex-col gap-2.5">
          <span className="text-[10px] font-label-caps text-on-surface font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-[15px]">save</span>
            Gravação Contínua em Disco (Arquivo MP4 / MKV)
          </span>
          <div className="flex flex-col gap-1">
            <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
              Caminho de Gravação
            </label>
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="C:/Gravacoes/canal-master.mp4"
              className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* 6. PROTOCOLO OMT / SMPTE-2110 */}
      {kind === 'OMT' && (
        <div className="p-3 bg-surface-panel/60 rounded-lg border border-border-subtle flex flex-col gap-2.5">
          <span className="text-[10px] font-label-caps text-on-surface font-bold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-accent-ice text-[15px]">lan</span>
            OMT • Open Media Transport (SMPTE-2110 IP)
          </span>
          <div className="flex flex-col gap-1">
            <label className="text-[9.5px] font-label-caps text-outline uppercase font-semibold">
              Endereço Multicast IP / Porta
            </label>
            <input
              type="text"
              value={omtAddress}
              onChange={(e) => setOmtAddress(e.target.value)}
              placeholder="omt://239.255.0.1:5004"
              className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
            />
            {mode === 'INPUT' && (
              <div className="rounded border border-border-subtle bg-surface-base p-2 text-[10px] text-outline leading-snug">
                {sources?.omt.sources.length
                  ? `Serviços NMOS/OMT encontrados: ${sources.omt.sources.map((source) => source.label).join(', ')}. Informe a URI RTP/SDP publicada pelo controlador para abrir o fluxo.`
                  : `A descoberta OMT procura anúncios NMOS/mDNS; ela não inventa uma URI RTP. ${sources?.omt.reason ?? 'Informe a URI/SDP do fluxo ou registre-o no controlador NMOS.'}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* URI Broadcast Canônico Calculado */}
      <div className="p-2 rounded bg-surface-base border border-border-subtle/80 flex items-center justify-between text-[10px] font-label-mono">
        <span className="text-outline">URI Canônico:</span>
        <span
          className="text-on-surface font-semibold truncate max-w-xs sm:max-w-md select-all text-right cursor-copy"
          title="Botão direito para copiar a URI canônica"
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (computedResult.targetUri) void navigator.clipboard.writeText(computedResult.targetUri)
          }}
        >
          {computedResult.targetUri || '<incompleto>'}
        </span>
      </div>
    </div>
  )
}

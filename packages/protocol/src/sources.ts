export type SrtMode = 'caller' | 'listener' | 'rendezvous'
export type SrtConnectionMode = SrtMode

export type SrtKeyLength = 16 | 24 | 32

export interface SrtConfig {
  mode: SrtMode
  host: string
  port: number
  latencyMs: number
  passphrase?: string
  pbkeylen?: SrtKeyLength
  streamId?: string
  pollTimeoutMs?: number
}

export type SrtConfiguration = SrtConfig

export type SrtLinkState = 'OPTIMAL' | 'DEGRADED' | 'CRITICAL' | 'DISCONNECTED'

export interface SrtTelemetry {
  timestamp?: string
  rttMs: number
  packetLossPercent: number
  bitrateKbps: number
  packetsDropped: number
  packetsRetransmitted: number
  linkBandwidthKbps?: number
  bufferMs?: number
  linkState: SrtLinkState
  reconnectCount: number
}

export type RedundancyRole = 'PRIMARY' | 'BACKUP'
export type StreamRole = RedundancyRole

export interface FailoverConfig {
  autoFailover: boolean
  maxLossPercent: number
  maxTimeoutMs: number
  maxRttMs: number
  switchDelayMs: number
}

export type MultiviewLayout = 'GRID_2X2' | 'GRID_1_PLUS_3' | 'COMPACT_LIST'
export type MultiviewTally = 'ON_AIR' | 'NEXT' | 'CUED' | 'OFFLINE'
export type MultiviewSyncState = 'LOCKED' | 'DRIFT' | 'LOST'

export interface MultiviewCell {
  id: string
  name: string
  sourceUrl: string
  tally: MultiviewTally
  audioPeakDb: [number, number]
  syncState: MultiviewSyncState
  srtTelemetry?: SrtTelemetry
}

export interface StreamEndpointConfig {
  readonly id: string
  readonly label: string
  readonly kind: 'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT'
  readonly uri: string
  readonly srtConfig?: SrtConfig
  readonly priority: 1 | 2
  readonly enabled: boolean
}

export interface FailoverPolicy {
  readonly signalLossTimeoutMs: number
  readonly packetLossThresholdPercent: number
  readonly rttMultiplierThreshold: number
  readonly qualificationTimeMs: number
  readonly autoRevertToPrimary: boolean
  readonly primaryHysteresisStabilizationMs: number
  readonly transitionStrategy: 'FREEZE_FRAME_HOLD' | 'BLACK_BURST_CROSSFADE'
}

export interface RedundantPairState {
  readonly activeStream: 'PRIMARY' | 'BACKUP'
  readonly primaryHealth: SrtTelemetry | null
  readonly backupHealth: SrtTelemetry | null
  readonly lastSwitchTimestamp: string | null
  readonly lastSwitchReason: string | null
  readonly switchCount: number
}

export interface RedundantStreamPair {
  readonly id: string
  readonly name: string
  readonly role: 'INGEST' | 'DISTRIBUTION'
  readonly primary: StreamEndpointConfig
  readonly backup: StreamEndpointConfig
  readonly policy: FailoverPolicy
  readonly runtimeState: RedundantPairState
}

export interface ManagedLiveSource {
  readonly id: string
  readonly channelId: string
  readonly name: string
  readonly kind: 'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT'
  readonly targetUrl: string
  /** Opaque server reference for control; targetUrl is display-only when protected. */
  readonly controlRef?: string
  readonly credentialProtected?: boolean
  readonly srt?: SrtConfig
  readonly role: RedundancyRole
  readonly pairedSourceId?: string
  readonly autoFailoverEnabled: boolean
  readonly failoverThresholds: {
    readonly signalLossTimeoutMs: number
    readonly maxPacketLossPercent: number
    readonly maxRttMultiplier: number
  }
  readonly enabled: boolean
  readonly createdAt?: string
}

/**
 * Classifica a qualidade e integridade do link SRT de acordo com o benchmark broadcast:
 * - OPTIMAL: perda < 1%, RTT <= 1.5x da latência configurada, zero pacotes perdidos em descarte.
 * - DEGRADED: perda entre 1% e 8%, ou RTT entre 1.5x e 2.5x da latência.
 * - CRITICAL: perda >= 8% (ou >= 15%) ou descarte contínuo de pacotes.
 * - DISCONNECTED: sem conectividade ou perda total prolongada.
 */
export function classifySrtLinkState(
  metrics: {
    packetLossPercent: number
    rttMs: number
    packetsDropped?: number
    connected?: boolean
  },
  configuredLatencyMs = 800,
): SrtLinkState {
  if (metrics.connected === false) {
    return 'DISCONNECTED'
  }
  const { packetLossPercent, rttMs, packetsDropped = 0 } = metrics
  if (packetLossPercent >= 8.0 || packetsDropped > 50 || rttMs > configuredLatencyMs * 2.5) {
    return 'CRITICAL'
  }
  if (packetLossPercent >= 1.0 || rttMs > configuredLatencyMs * 1.5 || packetsDropped > 0) {
    return 'DEGRADED'
  }
  return 'OPTIMAL'
}

/**
 * Monta URI padronizada para SRT:
 * srt://<host>:<port>?mode=<mode>&latency=<latencyMs>&passphrase=<passphrase>&pbkeylen=<pbkeylen>&streamid=<streamid>
 */
export function buildSrtUri(config: SrtConfig): string {
  const host = config.host || (config.mode === 'listener' ? '0.0.0.0' : '127.0.0.1')
  const port = config.port || 9000
  const params = new URLSearchParams()
  params.set('mode', config.mode)
  params.set('latency', String(config.latencyMs ?? 800))

  if (config.passphrase && config.passphrase.trim().length > 0) {
    params.set('passphrase', config.passphrase.trim())
    if (config.pbkeylen) {
      params.set('pbkeylen', String(config.pbkeylen))
    }
  }

  if (config.streamId && config.streamId.trim().length > 0) {
    params.set('streamid', config.streamId.trim())
  }

  if (config.pollTimeoutMs) {
    params.set('poll_timeout', String(config.pollTimeoutMs))
  }

  return `srt://${host}:${port}?${params.toString()}`
}

/**
 * Faz parse de uma URI SRT e extrai as configurações canônicas de transporte.
 */
export function parseSrtUri(uri: string): SrtConfig | null {
  try {
    const trimmed = uri.trim()
    if (!trimmed.startsWith('srt://')) return null
    // URL parser requires a valid protocol, so replace srt:// with http:// temporarily for parsing
    const parsed = new URL(trimmed.replace(/^srt:\/\//, 'http://'))
    const host = parsed.hostname || '0.0.0.0'
    const port = parsed.port ? parseInt(parsed.port, 10) : 9000
    const modeParam = parsed.searchParams.get('mode')?.toLowerCase()
    const mode: SrtMode =
      modeParam === 'listener' || modeParam === 'rendezvous' ? modeParam : 'caller'
    const latencyMs = parsed.searchParams.get('latency')
      ? parseInt(parsed.searchParams.get('latency')!, 10)
      : 800
    const passphrase = parsed.searchParams.get('passphrase') ?? undefined
    const pbkeylenRaw = parsed.searchParams.get('pbkeylen')
    const pbkeylen = pbkeylenRaw ? (parseInt(pbkeylenRaw, 10) as SrtKeyLength) : undefined
    const streamId = parsed.searchParams.get('streamid') ?? undefined
    const pollTimeoutMs = parsed.searchParams.get('poll_timeout')
      ? parseInt(parsed.searchParams.get('poll_timeout')!, 10)
      : undefined

    return {
      mode,
      host,
      port,
      latencyMs,
      passphrase,
      pbkeylen,
      streamId,
      pollTimeoutMs,
    }
  } catch {
    return null
  }
}

/**
 * Mascara passphrase de conexões SRT para segurança em logs e payloads públicos.
 */
export function maskPassphrase(passphrase?: string): string | undefined {
  if (!passphrase) return undefined
  return '•'.repeat(Math.min(32, Math.max(8, passphrase.length)))
}

/**
 * Sanitiza objeto de configuração SRT substituindo o segredo passphrase por máscara de segurança.
 */
export function sanitizeSrtConfig<T extends { passphrase?: string }>(config: T): T {
  if (!config) return config
  if (!config.passphrase) return { ...config }
  return {
    ...config,
    passphrase: maskPassphrase(config.passphrase),
  }
}

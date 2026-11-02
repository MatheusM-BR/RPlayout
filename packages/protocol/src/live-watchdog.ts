import { z } from 'zod'

/**
 * Watchdog das entradas ao vivo (SRT, RTMP, NDI, OMT, SDI/DeckLink).
 *
 * As medições vêm do engine, no pad DECODIFICADO da entrada -- o mesmo ponto
 * para todo tipo de fonte. Este módulo é só o contrato: detecções, estados,
 * política configurável (com padrões e validação) e rótulos em português.
 */
export const WATCHDOG_DETECTIONS = ['SIGNAL_LOSS', 'LOW_FPS', 'BLACK', 'FREEZE', 'SILENCE', 'AUDIO_STALL', 'AUDIO_MISSING', 'LOW_BITRATE'] as const
export type WatchdogDetection = typeof WATCHDOG_DETECTIONS[number]
/** OFF = ignorar; ALERT = só alerta/incidente; ACT = dispara espera e contingência. */
export type WatchdogDetectionAction = 'OFF' | 'ALERT' | 'ACT'
export const WATCHDOG_STATES = ['OK', 'SUSPEITA', 'ESPERA', 'CONTINGENCIA', 'RETORNO'] as const
export type WatchdogState = typeof WATCHDOG_STATES[number]
/** OFF = não observa; ALERT_ONLY = observa e alerta, nunca mexe no PGM; AUTOMATIC = age. */
export type WatchdogMode = 'OFF' | 'ALERT_ONLY' | 'AUTOMATIC'

const action = z.enum(['OFF', 'ALERT', 'ACT'])
const threshold = z.number().int().min(100).max(120_000)
const detection = <T extends z.ZodRawShape>(extra: T) => z.object({ action, thresholdMs: threshold, ...extra }).strict()

export const WatchdogDetectionsSchema = z.object({
  /** Nenhum quadro de vídeo por mais de `thresholdMs` (queda, EOS, timeout). */
  SIGNAL_LOSS: detection({}),
  /** Taxa efetiva abaixo de `minPercent` % da referência por `thresholdMs`. */
  LOW_FPS: detection({ minPercent: z.number().min(5).max(95) }),
  /** Preto / sem informação: luma média ≤ `lumaMaxPercent` e desvio ≤ `stdMaxPercent`.
   * `anyFlat` também conta imagem chapada de qualquer cor (tela azul do encoder). */
  BLACK: detection({ lumaMaxPercent: z.number().min(0).max(50), stdMaxPercent: z.number().min(0).max(30), anyFlat: z.boolean() }),
  /** Mesmo conteúdo amostrado (quadro repetido) por `thresholdMs`. */
  FREEZE: detection({}),
  /** RMS máximo do último segundo abaixo de `dbfs` por `thresholdMs`. */
  SILENCE: detection({ dbfs: z.number().min(-120).max(-20) }),
  /** Áudio travado: amostras sem avanço, carimbo parado ou bloco repetido, com o vídeo andando. */
  AUDIO_STALL: detection({}),
  /** Entrada que deveria ter áudio e não entrega nenhum. */
  AUDIO_MISSING: detection({}),
  /** Taxa de dados de rede (SRT/RTMP) abaixo de `minKbps`; NDI/SDI não informam. */
  LOW_BITRATE: detection({ minKbps: z.number().int().min(16).max(200_000) }),
}).strict()
export type WatchdogDetections = z.infer<typeof WatchdogDetectionsSchema>

export const WatchdogWaitArtSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SLATE') }).strict(),
  z.object({ kind: z.literal('GRAPHIC'), templateId: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('HOLD_LAST_FRAME') }).strict(),
])
export type WatchdogWaitArt = z.infer<typeof WatchdogWaitArtSchema>

export const WatchdogOverrideSchema = z.object({
  mode: z.enum(['OFF', 'ALERT_ONLY', 'AUTOMATIC']).nullable().optional(),
  /** false = entrada sem áudio por natureza (câmera NDI muda): SILÊNCIO/ÁUDIO desligados. */
  audioExpected: z.boolean().optional(),
  actions: z.object(Object.fromEntries(WATCHDOG_DETECTIONS.map(name => [name, action.optional()])) as Record<WatchdogDetection, z.ZodOptional<typeof action>>).strict().optional(),
}).strict()
export type WatchdogOverride = z.infer<typeof WatchdogOverrideSchema>

export const LiveWatchdogPolicySchema = z.object({
  version: z.literal(1),
  mode: z.enum(['OFF', 'ALERT_ONLY', 'AUTOMATIC']),
  /** T1: tempo máximo da arte de espera antes da contingência. */
  waitMs: z.number().int().min(0).max(60_000),
  /** T2: sinal íntegro e estável por este tempo antes do retorno. */
  returnStableMs: z.number().int().min(1000).max(300_000),
  returnMode: z.enum(['AUTO', 'MANUAL']),
  /** Histerese: condição só é dada como encerrada depois deste tempo limpa. */
  clearHoldMs: z.number().int().min(0).max(10_000),
  /** Referência da taxa: cadência do canal ou a declarada pela entrada. */
  fpsReference: z.enum(['CHANNEL', 'SOURCE']),
  /** Também medir a entrada que está no PVW (só alerta, nunca age). */
  monitorPreview: z.boolean(),
  waitArt: WatchdogWaitArtSchema,
  /** Playlist publicada de reserva (vinheta + vídeos aprovados no QC), em loop. */
  contingencyRevisionId: z.string().min(1).max(200).nullable(),
  detections: WatchdogDetectionsSchema,
  /** Ajuste por entrada cadastrada (id do catálogo de entradas ao vivo). */
  overrides: z.record(z.string().min(1).max(200), WatchdogOverrideSchema).refine(value => Object.keys(value).length <= 200, 'Até 200 entradas com ajuste próprio.'),
}).strict().superRefine((policy, context) => {
  if (policy.detections.SIGNAL_LOSS.action === 'OFF' && policy.mode === 'AUTOMATIC') context.addIssue({ code: z.ZodIssueCode.custom, path: ['detections', 'SIGNAL_LOSS', 'action'], message: 'Perda de sinal não pode ficar desligada no modo automático.' })
  if (policy.detections.BLACK.action !== 'OFF' && policy.detections.BLACK.lumaMaxPercent >= 50 && !policy.detections.BLACK.anyFlat) context.addIssue({ code: z.ZodIssueCode.custom, path: ['detections', 'BLACK', 'lumaMaxPercent'], message: 'Limite de luma alto demais para "preto".' })
})
export type LiveWatchdogPolicy = z.infer<typeof LiveWatchdogPolicySchema>

/** Padrões: tolera fade-to-black de até 3 s + 5 s de espera antes da contingência. */
export const DEFAULT_LIVE_WATCHDOG_POLICY: Readonly<LiveWatchdogPolicy> = Object.freeze({
  version: 1,
  mode: 'ALERT_ONLY',
  waitMs: 5000,
  returnStableMs: 5000,
  returnMode: 'AUTO',
  clearHoldMs: 1500,
  fpsReference: 'CHANNEL',
  monitorPreview: true,
  waitArt: { kind: 'SLATE' },
  contingencyRevisionId: null,
  detections: {
    SIGNAL_LOSS: { action: 'ACT', thresholdMs: 1000 },
    LOW_FPS: { action: 'ACT', thresholdMs: 3000, minPercent: 50 },
    BLACK: { action: 'ACT', thresholdMs: 3000, lumaMaxPercent: 6, stdMaxPercent: 3, anyFlat: false },
    FREEZE: { action: 'ACT', thresholdMs: 5000 },
    SILENCE: { action: 'ALERT', thresholdMs: 10_000, dbfs: -60 },
    AUDIO_STALL: { action: 'ACT', thresholdMs: 1500 },
    AUDIO_MISSING: { action: 'ALERT', thresholdMs: 3000 },
    LOW_BITRATE: { action: 'ALERT', thresholdMs: 3000, minKbps: 300 },
  },
  overrides: {},
}) as LiveWatchdogPolicy

/** Lê o que está gravado; o que faltar (versões antigas) vem do padrão. */
export function normalizeLiveWatchdogPolicy(input: unknown): LiveWatchdogPolicy {
  const base = structuredClone(DEFAULT_LIVE_WATCHDOG_POLICY) as LiveWatchdogPolicy
  if (!input || typeof input !== 'object') return base
  const raw = input as Partial<LiveWatchdogPolicy>
  const merged = { ...base, ...raw, detections: { ...base.detections } as WatchdogDetections, overrides: raw.overrides ?? {} }
  for (const name of WATCHDOG_DETECTIONS) merged.detections[name] = { ...base.detections[name], ...(raw.detections?.[name] ?? {}) } as never
  const parsed = LiveWatchdogPolicySchema.safeParse(merged)
  return parsed.success ? parsed.data : base
}

/** Política efetiva de uma entrada, com o ajuste próprio dela aplicado. */
export function effectiveWatchdogPolicy(policy: LiveWatchdogPolicy, sourceId: string | null | undefined): LiveWatchdogPolicy {
  const override = sourceId ? policy.overrides[sourceId] : undefined
  if (!override) return policy
  const detections = structuredClone(policy.detections)
  for (const name of WATCHDOG_DETECTIONS) {
    const forced = override.actions?.[name]
    if (forced) detections[name].action = forced
  }
  if (override.audioExpected === false) for (const name of ['SILENCE', 'AUDIO_STALL', 'AUDIO_MISSING'] as const) detections[name].action = 'OFF'
  return { ...policy, mode: override.mode ?? policy.mode, detections }
}

export const WATCHDOG_DETECTION_LABELS: Record<WatchdogDetection, string> = {
  SIGNAL_LOSS: 'Perda de sinal',
  LOW_FPS: 'Taxa de quadros baixa',
  BLACK: 'Preto / sem informação',
  FREEZE: 'Vídeo congelado',
  SILENCE: 'Silêncio',
  AUDIO_STALL: 'Áudio travado',
  AUDIO_MISSING: 'Sem áudio',
  LOW_BITRATE: 'Taxa de dados baixa',
}
export const WATCHDOG_STATE_LABELS: Record<WatchdogState, string> = {
  OK: 'OK', SUSPEITA: 'SUSPEITA', ESPERA: 'ESPERA', CONTINGENCIA: 'CONTINGÊNCIA', RETORNO: 'RETORNO',
}

/** Medições do engine usadas pelo watchdog (todas opcionais: engine antigo não as manda). */
export interface WatchdogSample {
  sampledAt: string
  videoAgeMs: number | null
  audioAgeMs: number | null
  videoPresent: boolean
  audioPresent: boolean
  rateNum?: number | null
  rateDen?: number | null
  audioChannels?: number | null
  receivedFrames?: number
  sampledContentUnchangedMs?: number | null
  contentSampleAgeMs?: number | null
  arrivalFps?: number | null
  distinctFps?: number | null
  lumaMeanPercent?: number | null
  lumaStdPercent?: number | null
  lumaSampleAgeMs?: number | null
  lumaUnsupportedFormat?: string | null
  lumaDeltaPercent?: number | null
  lumaStaticMs?: number | null
  audioRmsDbfs?: number | null
  audioSampleRatio?: number | null
  audioStalledMs?: number | null
  inputKbps?: number | null
}

export interface WatchdogMetrics {
  videoAgeMs: number | null
  effectiveFps: number | null
  referenceFps: number | null
  lumaPercent: number | null
  lumaStdPercent: number | null
  audioDbfs: number | null
  audioStalledMs: number | null
  inputKbps: number | null
}

export interface WatchdogConditionView {
  detection: WatchdogDetection
  action: WatchdogDetectionAction
  durationMs: number
  thresholdMs: number
  confirmed: boolean
}

export interface WatchdogInputStatus {
  sourceKey: string
  sourceId: string | null
  name: string
  kind: string | null
  bus: 'pgm' | 'pvw'
  itemId: string | null
  state: WatchdogState
  stateSince: string
  mode: WatchdogMode
  /** ESPERA: segundos que faltam para a contingência. */
  waitRemainingMs: number | null
  /** RETORNO: tempo de sinal estável acumulado / exigido. */
  stableMs: number | null
  awaitingOperator: boolean
  holdContingency: boolean
  waitArtOnAir: boolean
  contingencyOnAir: boolean
  /** Sem PVW no canal: o retorno é tentativa de TAKE (corta só com quadro real). */
  blindReturn: boolean
  pendingAction: string | null
  lastError: string | null
  conditions: WatchdogConditionView[]
  metrics: WatchdogMetrics
}

export interface LiveWatchdogStatus {
  channelId: string
  policy: LiveWatchdogPolicy
  nativeEngine: boolean
  inputs: WatchdogInputStatus[]
  events: Array<{ at: string; sourceName: string; kind: string; message: string }>
}

import type {LoudnessMeasurement, QcProfile} from '@rplayout/protocol'
import {TONE_CLASS, formatFileIntegrated, formatLoudness, formatPeak, loudnessTone, truePeakTone} from '../../domain/qc-loudness.js'

export interface QcListeningMeter {
  active: boolean
  momentary: number | null
  shortTerm: number | null
  peakL: number
  peakR: number
  phase: number | null
  muted: 'L' | 'R' | 'LR' | null
}

interface Props {
  loudness: LoudnessMeasurement | null | undefined
  hasAudio: boolean | null
  profile: Pick<QcProfile, 'minLufs' | 'maxLufs' | 'maxTruePeakDbtp'>
  targetLufs: number
  meter: QcListeningMeter
  /** O que está sendo escutado: "proxy AAC", "original", "inspeção ao vivo" ou null (sem escuta). */
  listening: string | null
}

/** Barra horizontal de pico, −60..0 dBFS. */
function PeakBar({label, value}: {label: string; value: number}) {
  const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, (value + 60) / 60)) : 0
  const color = value > -1 ? 'bg-on-air-crimson' : value > -9 ? 'bg-armed-amber' : 'bg-status-ok'
  return <div className="flex items-center gap-1.5 min-w-0">
    <span className="w-3 text-outline">{label}</span>
    <div className="relative flex-1 h-2 rounded-sm bg-surface-container-lowest overflow-hidden min-w-[60px]" aria-hidden="true">
      <div className={`absolute inset-y-0 left-0 ${color}`} style={{width: `${fraction * 100}%`}}/>
    </div>
    <span className="w-[76px] text-right text-on-surface">{formatPeak(value, 'dBFS')}</span>
  </div>
}

/** Áudio do QC: números do ARQUIVO (servidor, EBU R128) e da ESCUTA (navegador). */
export function QcAudioStrip({loudness, hasAudio, profile, targetLufs, meter, listening}: Props) {
  const integrated = loudness?.integratedLufs, truePeak = loudness?.truePeakDbtp
  const iTone = loudnessTone(integrated, profile), tpTone = truePeakTone(truePeak, profile)
  const correlation = !meter.active ? '—'
    : meter.muted === 'LR' ? 'N/D · L e R mudos'
    : meter.muted ? `N/D · canal ${meter.muted} mudo`
    : meter.phase === null ? 'N/D'
    : `${meter.phase >= 0 ? '+' : '−'}${Math.abs(meter.phase).toFixed(2)}${meter.phase < -0.2 ? ' · ANTIFASE' : ''}`
  const correlationTone = !meter.active || meter.phase === null ? (meter.muted && meter.active ? 'text-armed-amber' : 'text-outline') : meter.phase < 0 ? 'text-on-air-crimson' : meter.phase < 0.3 ? 'text-armed-amber' : 'text-status-ok-bright'
  return <section aria-label="Áudio do QC" className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 font-label-mono text-[12px]">
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center justify-between gap-2 font-label-caps text-[11px]">
        <span className="text-armed-amber font-bold">ARQUIVO · ORIGINAL (servidor, EBU R128)</span>
        <span className="text-outline" title="Faixa do perfil de QC do canal">alvo {targetLufs} · faixa {profile.minLufs}…{profile.maxLufs} · TP ≤ {profile.maxTruePeakDbtp}</span>
      </div>
      {hasAudio === false ? <span className="text-outline">Arquivo sem áudio.</span> : <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <span><span className="text-outline">I </span><strong className={TONE_CLASS[iTone]} title={iTone === 'warn' ? 'Fora da faixa do perfil do canal' : undefined}>{loudness ? formatFileIntegrated(integrated) : 'não medido'}</strong></span>
        <span><span className="text-outline">TP </span><strong className={TONE_CLASS[tpTone]}>{loudness ? formatPeak(truePeak, 'dBTP') : '—'}</strong></span>
        <span><span className="text-outline">LRA </span><strong className="text-on-surface">{loudness && Number.isFinite(loudness.lra) ? `${loudness.lra.toFixed(1)} LU` : '—'}</strong></span>
      </div>}
    </div>
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center justify-between gap-2 font-label-caps text-[11px]">
        <span className="text-accent-ice font-bold">ESCUTA · {listening ? listening.toUpperCase() : 'SEM ESCUTA'}</span>
        <span className="text-outline">{listening ? 'M/S/picos aproximados do que o navegador toca' : 'sem escuta neste modo'}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <span><span className="text-outline">M </span><strong className="text-on-surface">{meter.active ? formatLoudness(meter.momentary) : '—'}</strong></span>
        <span><span className="text-outline">S </span><strong className="text-on-surface">{meter.active ? formatLoudness(meter.shortTerm) : '—'}</strong></span>
        <span><span className="text-outline">Correlação </span><strong className={correlationTone}>{correlation}</strong></span>
      </div>
      <div className="grid grid-cols-2 gap-x-3">
        <PeakBar label="L" value={meter.active ? meter.peakL : -Infinity}/>
        <PeakBar label="R" value={meter.active ? meter.peakR : -Infinity}/>
      </div>
    </div>
  </section>
}

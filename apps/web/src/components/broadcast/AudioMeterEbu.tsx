import React from 'react'
import type { MeterReading } from '../../types.js'
import { loudnessTone, loudnessToneClass } from '../../domain/loudness-tone.js'

interface Props {
  meter: MeterReading
  targetLufs?: number
  ceilingDbtp?: number
  className?: string
  showCompact?: boolean
}

export const AudioMeterEbu = React.memo(function AudioMeterEbu({
  meter,
  targetLufs = -24,
  ceilingDbtp = -1,
  className = '',
  showCompact = false,
}: Props) {
  const leftPeakDbfs = meter?.peakDbfs?.[0] ?? -60
  const rightPeakDbfs = meter?.peakDbfs?.[1] ?? -60
  const leftPercent = Math.max(0, Math.min(100, Math.round(((leftPeakDbfs + 60) / 60) * 100)))
  const rightPercent = Math.max(0, Math.min(100, Math.round(((rightPeakDbfs + 60) / 60) * 100)))
  const correlation = meter?.correlation ?? 1
  const phasePercent = Math.max(0, Math.min(100, Math.round(((correlation + 1) / 2) * 100)))
  const integrated = meter?.integratedLufs ?? -24
  const truePeak = meter?.truePeakDbtp ?? -60
  const momentary = meter?.momentaryLufs ?? -24
  const rangeLu = meter?.rangeLu ?? 0
  const limiterActive = (meter?.gainReductionDb ?? 0) > 0.5

  if (showCompact) {
    return (
      <div className={`flex items-center gap-2 font-label-mono text-label-mono ${className}`}>
        <div className="flex flex-col gap-0.5 w-16">
          <div className="h-1.5 w-full bg-surface-container-lowest rounded-xs overflow-hidden flex">
            <div
              className={`h-full transition-all duration-75 ${leftPeakDbfs > -3 ? 'bg-on-air-crimson' : leftPeakDbfs > -12 ? 'bg-armed-amber' : 'bg-status-ok'}`}
              style={{ width: `${leftPercent}%` }}
            />
          </div>
          <div className="h-1.5 w-full bg-surface-container-lowest rounded-xs overflow-hidden flex">
            <div
              className={`h-full transition-all duration-75 ${rightPeakDbfs > -3 ? 'bg-on-air-crimson' : rightPeakDbfs > -12 ? 'bg-armed-amber' : 'bg-status-ok'}`}
              style={{ width: `${rightPercent}%` }}
            />
          </div>
        </div>
        <span className={`font-semibold ${loudnessToneClass[loudnessTone(integrated, targetLufs)]}`}>{integrated.toFixed(1)} LUFS</span>
      </div>
    )
  }

  return (
    <div className={`bg-surface-card p-space-md rounded shadow-md flex flex-col gap-space-sm border border-border-subtle ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-space-xs">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-status-ok-bright text-[18px]">equalizer</span>
          <span className="font-headline-md text-headline-md uppercase text-on-surface tracking-wide font-bold">
            ÁUDIO MASTER EBU R128
          </span>
        </div>
        <span className="font-label-mono text-label-mono bg-surface-container text-outline px-1.5 py-0.5 rounded">
          ALVO: {targetLufs} LUFS
        </span>
      </div>

      {/* Dual VU Ladder Bars (L / R) */}
      <div className="bg-surface-container-lowest p-space-sm rounded flex items-center justify-between gap-space-sm border border-border-subtle">
        {/* Left Channel */}
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex justify-between font-label-mono text-label-mono text-outline">
            <span>CH 1 (L)</span>
            <span className="text-on-surface font-semibold">{leftPeakDbfs.toFixed(1)} dB</span>
          </div>
          <div className="h-3 w-full bg-surface-panel rounded-sm overflow-hidden flex gap-0.5 p-0.5">
            <div
              className={`h-full rounded-xs transition-all duration-75 ${leftPeakDbfs > -3 ? 'bg-on-air-crimson' : leftPeakDbfs > -12 ? 'bg-armed-amber' : 'bg-status-ok'}`}
              style={{ width: `${leftPercent}%` }}
            />
          </div>
        </div>

        {/* Right Channel */}
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex justify-between font-label-mono text-label-mono text-outline">
            <span>CH 2 (R)</span>
            <span className="text-on-surface font-semibold">{rightPeakDbfs.toFixed(1)} dB</span>
          </div>
          <div className="h-3 w-full bg-surface-panel rounded-sm overflow-hidden flex gap-0.5 p-0.5">
            <div
              className={`h-full rounded-xs transition-all duration-75 ${rightPeakDbfs > -3 ? 'bg-on-air-crimson' : rightPeakDbfs > -12 ? 'bg-armed-amber' : 'bg-status-ok'}`}
              style={{ width: `${rightPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Correlação de Fase */}
      <div className="bg-surface-container-lowest p-space-sm rounded flex flex-col gap-1 border border-border-subtle">
        <div className="flex justify-between font-label-mono text-label-mono text-outline">
          <span>CORRELAÇÃO DE FASE</span>
          <span className="text-status-ok font-bold">
            {correlation >= 0 ? `+${correlation.toFixed(2)} (EM FASE)` : `${correlation.toFixed(2)} (OPOSIÇÃO)`}
          </span>
        </div>
        <div className="w-full h-2 bg-surface-panel rounded-full relative overflow-hidden flex">
          <div className="w-1/2 h-full bg-error/20 flex justify-start items-center">
            <span className="font-label-mono text-[12px] text-error pl-1">-1</span>
          </div>
          <div className="w-1/2 h-full bg-status-ok/20 flex justify-end items-center">
            <span className="font-label-mono text-[12px] text-status-ok pr-1">+1</span>
          </div>
          <div
            className="absolute top-0 bottom-0 w-1.5 bg-status-ok-bright rounded shadow-[0_0_4px_#3DDBA0]"
            style={{ left: `${phasePercent}%` }}
          />
        </div>
      </div>

      {/* EBU R128 Numeric Badges */}
      <div className="grid grid-cols-2 gap-space-xs font-label-mono text-label-mono">
        <div className="bg-surface-panel p-space-sm rounded border border-border-subtle">
          <span className="text-outline block font-label-caps text-label-caps">INTEGRADO (I):</span>
          <span className={`font-headline-md text-headline-md font-bold tabular-nums ${loudnessToneClass[loudnessTone(integrated, targetLufs)]}`}>
            {integrated.toFixed(1)} LUFS{loudnessTone(integrated, targetLufs) === 'silence' ? ' · SILÊNCIO' : ''}
          </span>
          <span className="text-[11px] text-outline block">ALVO: {targetLufs} ±0.5</span>
        </div>

        <div className="bg-surface-panel p-space-sm rounded border border-border-subtle">
          <span className="text-outline block font-label-caps text-label-caps">TRUE PEAK:</span>
          <span className="font-headline-md text-headline-md text-on-surface font-bold tabular-nums">
            {truePeak.toFixed(1)} dBTP
          </span>
          <span className="text-[11px] text-outline block">TETO: {ceilingDbtp} dBTP</span>
        </div>

        <div className="bg-surface-panel p-space-sm rounded border border-border-subtle">
          <span className="text-outline block font-label-caps text-label-caps">MOMENTÂNEO (M):</span>
          <span className="font-body-lg text-body-lg text-on-surface font-bold tabular-nums">
            {momentary.toFixed(1)} LUFS
          </span>
          <span className="text-[11px] text-outline block">JANELA: 400ms</span>
        </div>

        <div className="bg-surface-panel p-space-sm rounded border border-border-subtle">
          <span className="text-outline block font-label-caps text-label-caps">LRA (RANGE):</span>
          <span className="font-body-lg text-body-lg text-primary font-bold tabular-nums">
            {rangeLu.toFixed(1)} LU
          </span>
          <span className="text-[11px] text-outline block">DINÂMICA PADRÃO</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-on-surface-variant font-label-mono text-label-mono pt-space-xs border-t border-border-subtle">
        <span>Limiter True Peak: {limiterActive ? 'ATIVO' : 'STANDBY'}</span>
        <span className="text-status-ok font-bold">CALIBRADO</span>
      </div>
    </div>
  )
})

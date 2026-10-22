import React from 'react'
import type { Rate } from '@rplayout/protocol'
import { clock, dur } from '../../format.js'
import type { ItemView, Live } from '../../types.js'
import type { TransitionType } from '../../stores/usePlayoutStore.js'

interface Props {
  onAirItem: ItemView | null
  armedItem: ItemView | null
  rate: Rate
  live: Live
  remainingFrames: number
  elapsedFrames: number
  progressPercent: number
  transitionMode: TransitionType
  setTransitionMode: (mode: TransitionType) => void
  followOnAir: boolean
  onToggleFollowOnAir: () => void
  onTake: () => void
  onStop: () => void
  onCueNext: () => void
  abortArmed: boolean
  abortCountdown: number
  onArmAbort: () => void
}

export const HeroTransportBar = React.memo(function HeroTransportBar({
  onAirItem,
  armedItem,
  rate,
  live,
  remainingFrames,
  elapsedFrames,
  progressPercent,
  transitionMode,
  setTransitionMode,
  followOnAir,
  onToggleFollowOnAir,
  onTake,
  onCueNext,
  abortArmed,
  abortCountdown,
  onArmAbort,
}: Props) {
  const meter = live?.meters?.program

  return (
    <section className="w-full bg-surface-card px-margin py-space-sm border-b border-border-subtle">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-stretch">
        {/* LEFT: ON AIR CARD (PGM Active Playout) */}
        <div className="lg:col-span-4 bg-surface-panel p-space-md rounded shadow-lg flex flex-col justify-between relative overflow-hidden border border-border-subtle">
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-on-air-crimson shadow-[0_0_10px_#FF3B30]"></div>
          <div className="flex items-center justify-between gap-space-sm pl-space-sm">
            <div className="flex items-center gap-space-sm">
              <span className="inline-flex items-center gap-space-xs bg-on-air-crimson text-surface-base font-label-caps text-label-caps px-space-sm py-0.5 rounded font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-surface-base animate-ping"></span>
                NO AR [PGM]
              </span>
              <span className="font-label-mono text-label-mono bg-surface-container px-space-xs py-0.5 rounded text-accent-ice font-semibold">
                {rate.num === 60000 && rate.den === 1001 ? '1080p59.94' : '1080i59.94'}
              </span>
              <span className="font-label-mono text-label-mono bg-surface-container px-space-xs py-0.5 rounded text-outline">
                {onAirItem?.asset?.kind ?? 'VT'}
              </span>
            </div>
            <span className="font-label-mono text-label-mono text-on-surface-variant flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px] text-status-ok">volume_up</span>
              Ch 1-2 • {(meter?.integratedLufs ?? -24).toFixed(1)} LUFS
            </span>
          </div>

          <div className="pl-space-sm my-space-xs">
            <div className="font-headline-md text-headline-md text-on-surface truncate tracking-wide font-bold">
              {onAirItem ? onAirItem.item.title : 'NADA NO AR (BLACK/SLATE)'}
            </div>
            <div className="flex items-baseline justify-between mt-space-xs">
              <div className="flex items-baseline gap-space-xs">
                <span className="font-label-caps text-label-caps text-on-air-crimson font-bold uppercase">RESTA:</span>
                <span className="font-timecode-display text-timecode-display text-on-air-crimson font-bold tabular-nums">
                  {clock(remainingFrames, rate)}
                </span>
              </div>
              <span className="font-label-mono text-label-mono text-outline">
                DECORRIDO: {clock(elapsedFrames, rate)}
              </span>
            </div>
          </div>

          {/* Barra de Progresso */}
          <div className="pl-space-sm flex items-center gap-space-sm">
            <div className="w-full bg-surface-container-lowest h-2 rounded overflow-hidden flex">
              <div
                className="bg-on-air-crimson h-full rounded transition-all duration-300 shadow-[0_0_8px_#FF3B30]"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
            <span className="font-label-mono text-label-mono text-on-surface-variant tabular-nums font-bold">
              {progressPercent}%
            </span>
          </div>
        </div>

        {/* CENTER: MASTER HARDWARE TRANSPORT & SAFE DISPATCH BANK */}
        <div className="lg:col-span-4 bg-surface-panel p-space-sm rounded shadow-lg flex flex-col justify-between border border-border-subtle">
          {/* Top Controls: Transition Mode + Follow Lock */}
          <div className="flex items-center justify-between pb-space-xs">
            <div className="flex items-center gap-space-sm">
              <span className="font-label-caps text-label-caps text-outline uppercase tracking-wider">
                TRANSIÇÃO:
              </span>
              <div className="inline-flex rounded bg-surface-container-lowest p-0.5">
                {(['CUT', 'MIX', 'WIPE'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setTransitionMode(mode)}
                    className={`px-space-sm py-0.5 rounded font-label-mono text-label-mono font-bold transition-colors ${
                      transitionMode === mode
                        ? 'bg-primary-container text-on-primary-container'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* PGM FIXADO Toggle */}
            <button
              onClick={onToggleFollowOnAir}
              title="Trava o scroll da grade mantendo o item no ar fixado na terceira linha"
              className={`flex items-center gap-space-xs px-space-sm py-0.5 rounded font-label-caps text-label-caps font-bold transition-all border ${
                followOnAir
                  ? 'bg-primary-container text-on-primary-container border-primary shadow-[0_0_8px_rgba(77,142,255,0.4)]'
                  : 'bg-surface-container text-outline border-border-subtle hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {followOnAir ? 'lock' : 'lock_open'}
              </span>
              PGM FIXADO
            </button>
          </div>

          {/* Core Broadcast Take Buttons */}
          <div className="grid grid-cols-12 gap-space-sm my-auto py-space-xs">
            {/* TAKE Primário */}
            <button
              onClick={onTake}
              disabled={!armedItem}
              className={`col-span-6 py-3 px-space-md rounded font-headline-xl text-headline-xl font-bold uppercase tracking-wider flex items-center justify-center gap-space-sm transition-all shadow-lg select-none ${
                armedItem
                  ? 'bg-on-air-crimson hover:bg-red-600 text-white shadow-[0_0_16px_rgba(255,59,48,0.5)] active:scale-[0.98]'
                  : 'bg-surface-container text-outline cursor-not-allowed opacity-40'
              }`}
            >
              <span className="material-symbols-outlined text-[26px]">play_arrow</span>
              TAKE
            </button>

            {/* Trava de Emergência ABORT / PARAR */}
            <button
              onClick={onArmAbort}
              className={`col-span-3 py-2 px-space-xs rounded font-headline-md text-headline-md font-bold uppercase transition-all flex flex-col items-center justify-center border select-none ${
                abortArmed
                  ? 'bg-on-air-crimson text-white border-white animate-pulse shadow-[0_0_14px_#FF3B30]'
                  : 'bg-surface-container hover:bg-surface-container-high text-on-air-crimson border-on-air-crimson/40'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">emergency_home</span>
              <span className="text-[11px] leading-tight">
                {abortArmed ? `CONFIRMAR (${abortCountdown}s)` : 'PARAR'}
              </span>
            </button>

            {/* CUE / PREPARAR */}
            <button
              onClick={onCueNext}
              className="col-span-3 py-2 px-space-xs rounded font-headline-md text-headline-md font-bold uppercase bg-surface-container hover:bg-surface-container-high text-armed-amber border border-armed-amber/40 transition-colors flex flex-col items-center justify-center select-none"
            >
              <span className="material-symbols-outlined text-[18px]">skip_next</span>
              <span className="text-[11px] leading-tight">PREPARAR</span>
            </button>
          </div>

          <div className="flex items-center justify-between text-outline font-label-mono text-label-mono pt-space-xs border-t border-border-subtle">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-status-ok"></span>
              HEAD ENGINE: READY
            </span>
            <span>SEGURANÇA 24/7 ATIVA</span>
          </div>
        </div>

        {/* RIGHT: ARMED CARD (PVW Cued Playout) */}
        <div className="lg:col-span-4 bg-surface-panel p-space-md rounded shadow-lg flex flex-col justify-between relative overflow-hidden border border-border-subtle">
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-armed-amber shadow-[0_0_10px_#FF9500]"></div>
          <div className="flex items-center justify-between gap-space-sm pl-space-sm">
            <div className="flex items-center gap-space-sm">
              <span className="inline-flex items-center gap-space-xs bg-armed-amber text-surface-base font-label-caps text-label-caps px-space-sm py-0.5 rounded font-bold uppercase tracking-wider">
                PRÓXIMO [PVW]
              </span>
              <span className="font-label-mono text-label-mono bg-surface-container px-space-xs py-0.5 rounded text-outline">
                {armedItem?.asset?.kind ?? 'VT'}
              </span>
            </div>
            <span className="font-label-mono text-label-mono text-armed-amber font-semibold">
              CUED
            </span>
          </div>

          <div className="pl-space-sm my-space-xs">
            <div className="font-headline-md text-headline-md text-on-surface truncate tracking-wide font-bold">
              {armedItem ? armedItem.item.title : 'FIM DA GRADE'}
            </div>
            <div className="flex items-baseline justify-between mt-space-xs">
              <div className="flex items-baseline gap-space-xs">
                <span className="font-label-caps text-label-caps text-armed-amber uppercase font-semibold">
                  DURAÇÃO:
                </span>
                <span className="font-timecode-display text-timecode-display text-armed-amber font-bold tabular-nums">
                  {armedItem ? dur(armedItem.trim ? Math.max(0, armedItem.trim.out - armedItem.trim.in) : armedItem.item.durationOverride ?? 0, rate) : '00:00:00:00'}
                </span>
              </div>
              <div className="text-right">
                <span className="font-label-caps text-label-caps text-outline block">ENTRADA PREVISTA</span>
                <span className="font-label-mono text-label-mono text-on-surface font-semibold tabular-nums">
                  {clock(live?.transport?.onAir?.startedAt ?? 0, rate)}
                </span>
              </div>
            </div>
          </div>

          <div className="pl-space-sm flex items-center justify-between text-on-surface-variant font-label-mono text-label-mono">
            <span>{armedItem?.asset?.probe ? `${armedItem.asset.probe.width}x${armedItem.asset.probe.height}` : '1920x1080'}</span>
            <span className="text-armed-amber font-semibold">
              DISPARO EM {clock(remainingFrames, rate)}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
})

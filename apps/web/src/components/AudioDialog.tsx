import { useState } from 'react'
import {
  computeAutoGain,
  effectiveGainDb,
  type AudioLevel,
  type AudioMode,
  type Channel,
  type EditScope,
} from '@rplayout/protocol'
import type { ItemView } from '../types.js'
import { db, lufs } from '../format.js'
import { ScopePicker } from './ScopePicker.js'

interface Props {
  view: ItemView
  channel: Channel
  onCancel: () => void
  onApply: (audio: AudioLevel, scope: EditScope) => void
  onSetTrack: (index: number) => void
}

const SOURCE_LABEL: Record<string, string> = {
  ITEM: 'Nível próprio deste item',
  ASSET: 'Herdado do padrão do acervo',
  FILE: 'Sem nivelamento (arquivo bruto)',
  NONE: 'Sem medição EBU R128',
}

type ChannelRoutingMode = 'STEREO_1_2' | 'DOWNMIX_MONO' | 'STEREO_3_4' | 'LEFT_ONLY' | 'RIGHT_ONLY'

export function AudioDialog({ view, channel, onCancel, onApply, onSetTrack }: Props) {
  const [scope, setScope] = useState<EditScope>('ITEM')
  const [mode, setMode] = useState<AudioMode>(view.audio.mode)
  const [gain, setGain] = useState(view.gainDb)
  const [routingMode, setRoutingMode] = useState<ChannelRoutingMode>('STEREO_1_2')
  const [sdiPair, setSdiPair] = useState('SDI 1-2 (Master PGM)')

  const tracks = view.asset?.probe?.audioTracks ?? []
  const track = view.item.audioTrack ?? 0

  const measured = view.audio.measured ?? view.asset?.loudnessFile ?? null
  const auto = computeAutoGain(measured, channel.targetLufs, channel.ceilingDbtp)

  const next: AudioLevel = {
    mode,
    gainDb: mode === 'MANUAL' ? gain : mode === 'AUTO' ? auto.gainDb : 0,
    measured,
  }
  const applied = effectiveGainDb(next, channel.targetLufs, channel.ceilingDbtp)
  const projectedLufs = measured ? measured.integratedLufs + applied : null
  const projectedPeak = measured ? measured.truePeakDbtp + applied : null
  const overCeiling = projectedPeak !== null && projectedPeak > channel.ceilingDbtp

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface-card w-full max-w-3xl border border-border-subtle rounded shadow-2xl flex flex-col overflow-hidden max-h-[95vh]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-primary text-[22px]">tune</span>
            <div>
              <h2 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
                Nivelamento de Áudio EBU R128 &amp; Roteamento SDI
              </h2>
              <p className="font-label-mono text-label-mono text-outline">
                {view.item.title} · Alvo {channel.targetLufs} LUFS · Teto {channel.ceilingDbtp} dBTP · {SOURCE_LABEL[view.audioSource]}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-space-lg flex flex-col gap-space-md overflow-y-auto scrollbar-thin">
          {/* Telemetria de Loudness (Readouts) */}
          {measured ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-space-sm">
              <div className="bg-surface-container-lowest p-space-sm rounded border border-border-subtle font-label-mono text-label-mono">
                <span className="text-outline block font-label-caps text-label-caps">MEDIDO (I):</span>
                <span className="font-headline-md text-headline-md text-on-surface font-bold tabular-nums">
                  {lufs(measured.integratedLufs)}
                </span>
                <span className="text-[10px] text-outline block">ARQUIVO BRUTO</span>
              </div>

              <div className="bg-surface-container-lowest p-space-sm rounded border border-border-subtle font-label-mono text-label-mono">
                <span className="text-outline block font-label-caps text-label-caps">TRUE PEAK:</span>
                <span className="font-headline-md text-headline-md text-on-surface font-bold tabular-nums">
                  {db(measured.truePeakDbtp)}
                </span>
                <span className="text-[10px] text-outline block">PICO MÁXIMO</span>
              </div>

              <div className="bg-surface-container-lowest p-space-sm rounded border border-border-subtle font-label-mono text-label-mono">
                <span className="text-outline block font-label-caps text-label-caps">PROJETADO (NO AR):</span>
                <span
                  className={`font-headline-md text-headline-md font-bold tabular-nums ${
                    projectedLufs !== null && Math.abs(projectedLufs - channel.targetLufs) <= 1
                      ? 'text-status-ok-bright'
                      : 'text-armed-amber'
                  }`}
                >
                  {projectedLufs === null ? '—' : lufs(projectedLufs)}
                </span>
                <span className="text-[10px] text-outline block">ALVO: {channel.targetLufs} LUFS</span>
              </div>

              <div className="bg-surface-container-lowest p-space-sm rounded border border-border-subtle font-label-mono text-label-mono">
                <span className="text-outline block font-label-caps text-label-caps">PICO ESTIMADO:</span>
                <span
                  className={`font-headline-md text-headline-md font-bold tabular-nums ${
                    overCeiling ? 'text-on-air-crimson' : 'text-on-surface'
                  }`}
                >
                  {projectedPeak === null ? '—' : db(projectedPeak)}
                </span>
                <span className="text-[10px] text-outline block">TETO: {channel.ceilingDbtp} dBTP</span>
              </div>
            </div>
          ) : (
            <div className="p-space-sm bg-armed-amber/10 border border-armed-amber/40 rounded flex items-center gap-space-sm text-armed-amber font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[20px]">warning</span>
              <span>Este arquivo ainda não foi medido pelo probe QC. O ganho automático requer medição prévia.</span>
            </div>
          )}

          {/* Seleção de Trilha do Arquivo */}
          {tracks.length > 1 && (
            <div className="flex flex-col gap-1 p-space-sm bg-surface-panel rounded border border-border-subtle">
              <label className="font-label-caps text-label-caps text-outline uppercase">Trilha de Áudio do Arquivo</label>
              <select
                value={track}
                onChange={(event) => onSetTrack(Number(event.target.value))}
                className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm outline-none"
              >
                {tracks.map((option) => (
                  <option key={option.index} value={option.index}>
                    Trilha {option.index + 1} ({option.channels === 1 ? 'Mono' : `${option.channels} Canais`})
                    {option.language ? ` · ${option.language.toUpperCase()}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Modo de Nivelamento */}
          <div className="flex flex-col gap-space-xs">
            <label className="font-label-caps text-label-caps text-outline uppercase">Modo de Normalização</label>
            <div className="grid grid-cols-3 gap-space-xs">
              {(['AUTO', 'MANUAL', 'OFF'] as const).map((option) => (
                <button
                  key={option}
                  disabled={option === 'AUTO' && !measured}
                  onClick={() => {
                    setMode(option)
                    if (option === 'AUTO') setGain(auto.gainDb)
                  }}
                  className={`py-2 px-space-md rounded font-label-caps text-label-caps font-bold transition-all border ${
                    mode === option
                      ? 'bg-primary-container text-on-primary-container border-border-strong shadow-sm'
                      : 'bg-surface-panel text-outline hover:text-on-surface border-border-subtle'
                  }`}
                >
                  {option === 'AUTO' ? 'EBU R128 AUTO' : option === 'MANUAL' ? 'GANHO MANUAL' : 'SEM GANHO (OFF)'}
                </button>
              ))}
            </div>
          </div>

          {/* FADER VERTICAL TÁTIL (-24dB a +12dB) E CHAVEAMENTO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md p-space-md bg-surface-container-lowest rounded border border-border-subtle">
            {/* Coluna do Fader de Ganho */}
            <div className="flex flex-col gap-space-sm items-center">
              <span className="font-label-caps text-label-caps text-outline uppercase">Fader de Ganho Linear (-24dB a +12dB)</span>

              <div className="flex items-center gap-space-md w-full justify-center">
                {/* Régua de dB */}
                <div className="flex flex-col justify-between h-48 font-label-mono text-[10px] text-outline text-right py-1">
                  <span>+12 dB</span>
                  <span>+6 dB</span>
                  <span>0 dB (REF)</span>
                  <span>-6 dB</span>
                  <span>-12 dB</span>
                  <span>-24 dB</span>
                </div>

                {/* Slider / Fader Vertical */}
                <div className="relative h-48 w-12 bg-surface-panel rounded-full border border-border-subtle flex items-center justify-center p-1 overflow-hidden shadow-inner">
                  {/* Trilha central do fader */}
                  <div className="absolute top-3 bottom-3 w-1 bg-surface-container-lowest rounded-full pointer-events-none"></div>
                  <input
                    type="range"
                    min="-24"
                    max="12"
                    step="0.5"
                    disabled={mode !== 'MANUAL'}
                    value={mode === 'MANUAL' ? gain : applied}
                    onChange={(e) => setGain(Number(e.target.value))}
                    className="w-44 h-8 -rotate-90 origin-center cursor-pointer accent-primary disabled:opacity-50 relative z-10"
                    aria-label="Fader de ganho"
                  />
                </div>

                {/* Readout e Input Numérico */}
                <div className="flex flex-col gap-2">
                  <div className="bg-surface-card p-space-sm rounded border border-border-subtle text-center min-w-[100px]">
                    <span className="font-label-caps text-[10px] text-outline block">GANHO APLICADO</span>
                    <span className="font-headline-md text-headline-md font-bold text-status-ok-bright tabular-nums">
                      {applied >= 0 ? `+${applied.toFixed(1)}` : applied.toFixed(1)} dB
                    </span>
                  </div>

                  {mode === 'MANUAL' && (
                    <div className="flex flex-col gap-1">
                      <span className="font-label-caps text-[10px] text-outline">Ajuste Fino</span>
                      <input
                        type="number"
                        step="0.1"
                        min="-24"
                        max="12"
                        value={gain}
                        onChange={(e) => setGain(Number(e.target.value))}
                        className="bg-surface-card text-on-surface px-2 py-1 rounded border border-border-subtle font-label-mono text-label-mono text-center outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Coluna de Chaveamento de Canais & Roteamento SDI */}
            <div className="flex flex-col gap-space-md">
              {/* Chaveamento de Canais */}
              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">
                  Chaveamento de Canais
                </label>
                <div className="grid grid-cols-2 gap-1 font-label-caps text-[11px]">
                  {[
                    { id: 'STEREO_1_2', label: 'Stereo (Ch 1-2)' },
                    { id: 'DOWNMIX_MONO', label: 'Downmix Mono (L+R)' },
                    { id: 'STEREO_3_4', label: 'Stereo Secundário (3-4)' },
                    { id: 'LEFT_ONLY', label: 'Apenas Canal L (Esq)' },
                    { id: 'RIGHT_ONLY', label: 'Apenas Canal R (Dir)' },
                  ].map((route) => (
                    <button
                      key={route.id}
                      onClick={() => setRoutingMode(route.id as ChannelRoutingMode)}
                      className={`py-1.5 px-2 rounded font-bold transition-colors border text-left truncate ${
                        routingMode === route.id
                          ? 'bg-primary-container text-on-primary-container border-border-strong'
                          : 'bg-surface-panel text-outline hover:text-on-surface border-border-subtle'
                      }`}
                    >
                      {route.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Roteamento SDI Integrado */}
              <div className="flex flex-col gap-1">
                <label className="font-label-caps text-label-caps text-outline uppercase">
                  Roteamento SDI Integrado (DeckLink Embedded)
                </label>
                <select
                  value={sdiPair}
                  onChange={(e) => setSdiPair(e.target.value)}
                  className="bg-surface-panel text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm outline-none"
                >
                  <option>SDI 1-2 (Master PGM Principal)</option>
                  <option>SDI 3-4 (Clean Feed / SAP)</option>
                  <option>SDI 5-6 (Áudio Descrição / Acessibilidade)</option>
                  <option>SDI 7-8 (Intercom / Monitor)</option>
                </select>
                <span className="font-label-mono text-[10px] text-outline">
                  Os canais selecionados serão multiplexados no stream SDI sem latência de resample.
                </span>
              </div>
            </div>
          </div>

          {overCeiling && (
            <div className="p-space-sm bg-on-air-crimson/15 border border-on-air-crimson/40 rounded flex items-center gap-space-sm text-on-air-crimson font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <span>
                Atenção: Com este ganho o pico True Peak excederá o teto regulamentar ({channel.ceilingDbtp} dBTP). O limiter atuará com compressão dinâmica.
              </span>
            </div>
          )}

          <ScopePicker
            value={scope}
            onChange={setScope}
            siblingCount={view.siblingCount}
            hasAsset={view.asset !== null}
            what="nível"
          />
        </div>

        {/* Footer Actions */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-t border-border-subtle flex items-center justify-end gap-space-sm">
          <button
            type="button"
            onClick={onCancel}
            className="px-space-lg py-2 rounded bg-surface-card hover:bg-surface-container text-on-surface font-label-caps text-label-caps uppercase transition-colors border border-border-subtle"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onApply(next, scope)}
            className="px-space-lg py-2 rounded bg-primary-container text-on-primary-container hover:brightness-110 font-label-caps text-label-caps uppercase font-bold transition-all shadow-sm flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            Aplicar Nível de Áudio
          </button>
        </div>
      </div>
    </div>
  )
}

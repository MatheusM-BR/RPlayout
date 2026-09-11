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
  /** Trocar de trilha vale na hora: não é nível, e não tem escopo. */
  onSetTrack: (index: number) => void
}

const SOURCE_LABEL: Record<string, string> = {
  ITEM: 'nível próprio deste item',
  ASSET: 'herdado do padrão do acervo',
  FILE: 'sem nivelamento',
  NONE: 'sem medição',
}

export function AudioDialog({ view, channel, onCancel, onApply, onSetTrack }: Props) {
  const [scope, setScope] = useState<EditScope>('ITEM')
  const [mode, setMode] = useState<AudioMode>(view.audio.mode)
  const [gain, setGain] = useState(view.gainDb)

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
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Nivelamento de áudio</h2>
          <div className="sub">
            {view.item.title} · alvo {channel.targetLufs} LUFS · teto {channel.ceilingDbtp} dBTP ·{' '}
            {SOURCE_LABEL[view.audioSource]}
          </div>
        </header>

        <div className="body">
          {measured ? (
            <div className="readouts">
              <div className="ro">
                <b>MEDIDO</b>
                <span>{lufs(measured.integratedLufs)}</span>
              </div>
              <div className="ro">
                <b>PICO</b>
                <span>{db(measured.truePeakDbtp)}</span>
              </div>
              <div className="ro">
                <b>FICA EM</b>
                <span className={projectedLufs !== null && Math.abs(projectedLufs - channel.targetLufs) <= 1 ? 'ok' : 'warn'}>
                  {projectedLufs === null ? '—' : lufs(projectedLufs)}
                </span>
              </div>
              <div className="ro">
                <b>PICO FICA</b>
                <span className={overCeiling ? 'bad' : ''}>
                  {projectedPeak === null ? '—' : db(projectedPeak)}
                </span>
              </div>
            </div>
          ) : (
            <div className="note warn">
              Este arquivo ainda não foi medido. Sem medição, o modo automático não tem de onde
              tirar o ganho.
            </div>
          )}

          {/* Dublagem, original e trilha internacional no mesmo arquivo é
              corriqueiro. Só aparece quando há o que escolher. */}
          {tracks.length > 1 && (
            <div className="field">
              <label>Trilha de áudio</label>
              <select
                value={track}
                onChange={(event) => onSetTrack(Number(event.target.value))}
              >
                {tracks.map((option) => (
                  <option key={option.index} value={option.index}>
                    {option.index + 1}ª · {option.channels === 1 ? 'mono' : `${option.channels} canais`}
                    {option.language ? ` · ${option.language}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tracks.length > 1 && (
            <div className="note">
              A medição de loudness é da primeira trilha. Trocando de trilha, o modo automático
              pode errar o ganho até a próxima varredura do acervo.
            </div>
          )}

          <div className="field">
            <label>Modo</label>
            <div className="seg-group">
              {(['AUTO', 'MANUAL', 'OFF'] as const).map((option) => (
                <button
                  key={option}
                  className={mode === option ? 'on' : ''}
                  disabled={option === 'AUTO' && !measured}
                  onClick={() => {
                    setMode(option)
                    if (option === 'AUTO') setGain(auto.gainDb)
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {mode === 'MANUAL' && (
            <div className="field">
              <label>Ganho (dB)</label>
              <input
                type="number"
                step="0.1"
                min="-40"
                max="20"
                value={gain}
                onChange={(event) => setGain(Number(event.target.value))}
              />
            </div>
          )}

          {mode === 'AUTO' && auto.reason && <div className="note warn">{auto.reason}</div>}
          {mode === 'AUTO' && !auto.reason && (
            <div className="note">
              Ganho calculado: <b>{db(auto.gainDb)} dB</b>. Recalcula sozinho se a medição mudar —
              trocar o corte, por exemplo, remede o trecho.
            </div>
          )}
          {mode === 'OFF' && (
            <div className="note">O arquivo vai ao ar como está, sem ganho aplicado.</div>
          )}
          {overCeiling && (
            <div className="note warn">
              Com este ganho o pico passa do teto e o limiter vai trabalhar. Limiter trabalhando o
              tempo todo é sinal de gain staging errado, não de proteção.
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

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button className="btn take" onClick={() => onApply(next, scope)}>
            aplicar
          </button>
        </footer>
      </div>
    </div>
  )
}

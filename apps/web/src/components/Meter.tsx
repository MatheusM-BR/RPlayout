import type { Channel } from '@rplayout/protocol'
import type { MeterReading } from '../types.js'
import { db, lufs } from '../format.js'

const SEGMENTS = 28
const FLOOR_DBFS = -60

/** Posição do valor na escala do medidor, de 0 a 1. */
const position = (dbfs: number): number =>
  Math.max(0, Math.min(1, (dbfs - FLOOR_DBFS) / (0 - FLOOR_DBFS)))

function Bar({ dbfs }: { dbfs: number }) {
  const lit = Math.round(position(dbfs) * SEGMENTS)
  return (
    <div className="track">
      {Array.from({ length: SEGMENTS }, (_, index) => {
        if (index >= lit) return <i key={index} className="seg" />
        const zone = index <= SEGMENTS - 7 ? 'g' : index <= SEGMENTS - 3 ? 'a' : 'r'
        return <i key={index} className={`seg ${zone}`} />
      })}
    </div>
  )
}

/**
 * Medidor de PGM e de preview. Não é VU: é pico verdadeiro somado a loudness em
 * três janelas e à faixa de loudness, tudo medido pela BS.1770-4 no engine.
 *
 * A integrada é a do item no ar, não a do canal desde que ligou: reinicia a
 * cada take. É a leitura que responde "este VT saiu no alvo?", que é a pergunta
 * que o operador faz — e por isso o alvo do canal fica ao lado dela.
 *
 * A redução de ganho não é decoração: o limiter é rede de proteção, então GR
 * acesa o tempo todo quer dizer que o nivelamento é que está errado.
 */
export function Meter({ reading, channel }: { reading: MeterReading; channel: Channel }) {
  const onTarget = Math.abs(reading.integratedLufs - channel.targetLufs) <= 1
  // Acima do teto de pico verdadeiro é o que o destino vai distorcer.
  const clipping = reading.truePeakDbtp > channel.ceilingDbtp
  // Meio dB já é o limiter fazendo trabalho que era do nivelamento.
  const working = reading.gainReductionDb > 0.5

  return (
    <div className="meter">
      <div className="mtr-row">
        <b>L</b>
        <Bar dbfs={reading.peakDbfs[0] ?? FLOOR_DBFS} />
      </div>
      <div className="mtr-row">
        <b>R</b>
        <Bar dbfs={reading.peakDbfs[1] ?? FLOOR_DBFS} />
      </div>
      <div className="readout">
        <div className="ro">
          <b>MOMENT.</b>
          <span>{lufs(reading.momentaryLufs)}</span>
        </div>
        <div className="ro">
          <b>SHORT</b>
          <span>{lufs(reading.shortTermLufs)}</span>
        </div>
        <div className="ro">
          <b>INTEGR.</b>
          <span className={onTarget ? 'ok' : 'warn'}>{lufs(reading.integratedLufs)}</span>
        </div>
        <div className="ro">
          <b>ALVO</b>
          <span className="dim">{lufs(channel.targetLufs)}</span>
        </div>
        <div className="ro">
          <b>PICO</b>
          <span className={clipping ? 'bad' : ''}>{db(reading.truePeakDbtp)}</span>
        </div>
        <div className="ro">
          <b>GR</b>
          <span className={working ? 'bad' : 'ok'}>{reading.gainReductionDb.toFixed(1)}</span>
        </div>
        <div className="ro">
          <b>FAIXA</b>
          <span>{reading.rangeLu.toFixed(1)}</span>
        </div>
        <div className="ro">
          <b>FASE</b>
          <span className={reading.correlation < 0 ? 'bad' : ''}>
            {reading.correlation.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

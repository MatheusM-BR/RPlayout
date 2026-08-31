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
 * três janelas, mais a redução de ganho do limiter — que é a leitura que diz se
 * o nivelamento está fazendo o trabalho ou se o limiter está tapando buraco.
 */
export function Meter({ reading, channel }: { reading: MeterReading; channel: Channel }) {
  const onTarget = Math.abs(reading.integratedLufs - channel.targetLufs) <= 1
  const working = reading.gainReductionDb > 0.2

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
          <b>INTEGR.</b>
          <span className={onTarget ? 'ok' : 'warn'}>{lufs(reading.integratedLufs)}</span>
        </div>
        <div className="ro">
          <b>PICO</b>
          <span>{db(reading.truePeakDbtp)}</span>
        </div>
        <div className="ro">
          <b>SHORT</b>
          <span>{lufs(reading.shortTermLufs)}</span>
        </div>
        <div className="ro">
          <b>GR</b>
          <span className={working ? 'bad' : 'ok'}>{reading.gainReductionDb.toFixed(1)}</span>
        </div>
        <div className="ro">
          <b>FASE</b>
          <span className={reading.correlation < 0 ? 'bad' : ''}>
            {db(reading.correlation, 2)}
          </span>
        </div>
      </div>
    </div>
  )
}

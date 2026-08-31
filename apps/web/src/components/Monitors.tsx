import type { Channel } from '@rplayout/protocol'
import type { ItemView, Live } from '../types.js'
import { Meter } from './Meter.js'
import { dur } from '../format.js'

interface Props {
  channel: Channel
  live: Live
  onAirItem: ItemView | null
  onAirRemaining: number
  previewItem: ItemView | null
}

/**
 * PGM e preview lado a lado. O preview abre qualquer item sem encostar no que
 * está no ar — na F2 quem alimenta os dois são pipelines separados; aqui o
 * layout e o contrato já são os definitivos.
 */
export function Monitors({ channel, live, onAirItem, onAirRemaining, previewItem }: Props) {
  const ending = onAirRemaining > 0 && onAirRemaining <= 10 * (channel.rate.num / channel.rate.den)

  return (
    <>
      <div className="monitor">
        <div className="monitor-head">
          <span className="tag pgm">PGM</span>
          <span>no ar</span>
        </div>
        <div className="screen">
          {onAirItem ? (
            <>
              <div className="what">{onAirItem.item.title}</div>
              <div className={`tc${ending ? ' warn' : ''}`}>
                {dur(Math.max(0, onAirRemaining), channel.rate)}
              </div>
            </>
          ) : (
            <div className="idle">SEM SINAL</div>
          )}
        </div>
        <Meter reading={live.meters.program} channel={channel} />
      </div>

      <div className="monitor">
        <div className="monitor-head">
          <span className="tag pvw">PVW</span>
          <span>preview</span>
        </div>
        <div className="screen">
          {previewItem ? (
            <>
              <div className="what">{previewItem.item.title}</div>
              <div className="tc">
                {dur(previewItem.trim.out - previewItem.trim.in, channel.rate)}
              </div>
            </>
          ) : (
            <div className="idle">NADA ARMADO</div>
          )}
        </div>
        <Meter reading={live.meters.preview} channel={channel} />
      </div>
    </>
  )
}

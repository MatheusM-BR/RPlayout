import type { Channel } from '@rplayout/protocol'
import type { ItemView, Live, Monitors as MonitorFeeds } from '../types.js'
import { Meter } from './Meter.js'
import { Whep } from './Whep.js'
import { dur } from '../format.js'

interface Props {
  channel: Channel
  live: Live
  onAirItem: ItemView | null
  onAirRemaining: number
  /** O que está no preview: título e duração, venha de item ou de arquivo. */
  preview: { title: string; duration: number; fromExplorer: boolean } | null
  /** De onde vem a imagem. Nulo mantém os monitores no modo texto. */
  monitors: MonitorFeeds | null
}

/**
 * PGM e preview lado a lado. O preview abre qualquer item sem encostar no que
 * está no ar — na F2 quem alimenta os dois são pipelines separados; aqui o
 * layout e o contrato já são os definitivos.
 */
export function Monitors({
  channel,
  live,
  onAirItem,
  onAirRemaining,
  preview,
  monitors,
}: Props) {
  const ending = onAirRemaining > 0 && onAirRemaining <= 10 * (channel.rate.num / channel.rate.den)

  return (
    <>
      <div className="monitor">
        <div className="monitor-head">
          <span className="tag pgm">PGM</span>
          <span>no ar</span>
        </div>
        {/* A imagem e a legenda dividem a mesma célula. O centro é do vídeo e
            do que o impede de aparecer; a tarja de baixo diz o que está no ar.
            Um texto de cada, senão os dois se escrevem por cima. */}
        <div className="screen">
          {monitors && <Whep path={monitors.program} port={monitors.port} />}
          {onAirItem ? (
            <div className="over">
              <div className="what">{onAirItem.item.title}</div>
              <div className={`tc${ending ? ' warn' : ''}`}>
                {dur(Math.max(0, onAirRemaining), channel.rate)}
              </div>
            </div>
          ) : monitors ? (
            <div className="over">
              <div className="what dim">nada no ar</div>
            </div>
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
          {monitors?.preview && <Whep path={monitors.preview} port={monitors.port} />}
          {preview ? (
            <div className="over">
              <div className="what">{preview.title}</div>
              <div className="tc">{dur(preview.duration, channel.rate)}</div>
              {preview.fromExplorer && <div className="tag-note">arquivo · fora da grade</div>}
            </div>
          ) : monitors?.preview ? (
            <div className="over">
              <div className="what dim">nada preparado</div>
            </div>
          ) : (
            <div className="idle">NADA PREPARADO</div>
          )}
        </div>
        <Meter reading={live.meters.preview} channel={channel} />
      </div>
    </>
  )
}

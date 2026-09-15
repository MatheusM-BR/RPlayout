import { useCallback, useMemo } from 'react'
import type { Channel } from '@rplayout/protocol'
import { api } from '../api.js'
import type { ItemView, Live, Monitors as MonitorFeeds } from '../types.js'
import { Meter } from './Meter.js'
import { Whep } from './Whep.js'

interface Props {
  channel: Channel
  live: Live
  onAirItem: ItemView | null
  onAirRemaining: number
  /** O que está no preview: título e duração, venha de item ou de arquivo. */
  preview: { title: string; duration: number; fromExplorer: boolean; seekable: boolean } | null
  /** De onde vem a imagem. Nulo mantém os monitores no modo texto. */
  monitors: MonitorFeeds | null
  onSeek: (bus: 'pgm' | 'pvw', frames: number) => void
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
  onSeek,
}: Props) {
  const ending = onAirRemaining > 0 && onAirRemaining <= 10 * (channel.rate.num / channel.rate.den)

  // Bater o ponto por monitor. Falha aqui não faz nada visível de propósito: o
  // pior que acontece é o monitor apagar sozinho, e encher a tela de erro por
  // causa de um aviso perdido seria pior que a imagem sumir.
  const avisar = useCallback(
    (bus: 'pvw' | 'mon') => () => {
      void api.watching(channel.id, bus).catch(() => {})
    },
    [channel.id],
  )
  const avisarPgm = useMemo(() => avisar('mon'), [avisar])
  const avisarPvw = useMemo(() => avisar('pvw'), [avisar])

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
          {monitors && (
            <Whep path={monitors.program} port={monitors.port} frameRate={channel.rate.num / channel.rate.den} positionFrames={live.transport.onAir?.elapsed ?? 0} durationFrames={onAirItem && !onAirItem.item.sourceRef ? (live.transport.onAir?.elapsed ?? 0) + onAirRemaining : 0} onSeek={onAirItem?.item.sourceRef ? undefined : (frames) => onSeek('pgm', frames)} onWatching={avisarPgm} />
          )}
          {onAirItem ? (
            <div className="over">
              <div className={`tc${ending ? ' warn' : ''}`}>NO AR</div>
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
          {monitors?.preview && (
            <Whep path={monitors.preview} port={monitors.port} frameRate={channel.rate.num / channel.rate.den} positionFrames={live.transport.previewPosition?.frames ?? 0} durationFrames={preview?.seekable ? (live.transport.previewPosition?.duration ?? preview.duration) : 0} onSeek={preview?.seekable ? (frames) => onSeek('pvw', frames) : undefined} onWatching={avisarPvw} />
          )}
          {preview ? (
            <div className="over">
              <div className="tc">PREVIEW</div>
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

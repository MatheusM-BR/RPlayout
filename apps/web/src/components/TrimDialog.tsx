import { useEffect, useMemo, useRef, useState } from 'react'
import {
  durationIn,
  formatTimecode,
  fps,
  parseTimecode,
  type EditScope,
  type Rate,
  type Trim,
} from '@rplayout/protocol'
import type { ItemView } from '../types.js'
import { dur } from '../format.js'
import { ScopePicker } from './ScopePicker.js'

interface Props {
  view: ItemView
  rate: Rate
  onCancel: () => void
  onApply: (trim: Trim, scope: EditScope) => void
}

const SOURCE_LABEL: Record<string, string> = {
  ITEM: 'Corte próprio deste item',
  ASSET: 'Herdado do padrão do acervo',
  FILE: 'Arquivo inteiro, sem corte',
  NONE: 'Sem arquivo',
}

/** Quantos quadros formam a fita embaixo da régua. */
const FITA = 16

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
}

function podeTocar(path: string | undefined): boolean {
  if (path === undefined) return false
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const tipo = MIME[ext]
  if (tipo === undefined) return true
  return document.createElement('video').canPlayType(tipo) !== ''
}

function motivoDoErro(video: HTMLVideoElement | null): string {
  const erro = video?.error
  if (!erro) return 'O navegador não conseguiu abrir o arquivo'
  switch (erro.code) {
    case MediaError.MEDIA_ERR_DECODE:
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'O navegador não decodifica este formato de vídeo'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'A leitura do arquivo foi interrompida na rede'
    case MediaError.MEDIA_ERR_ABORTED:
      return 'A leitura do vídeo foi cancelada'
    default:
      return 'O navegador não conseguiu abrir o arquivo'
  }
}

const PARADOS = 64
type Alça = 'in' | 'out' | 'cabeça' | null

export function TrimDialog({ view, rate, onCancel, onApply }: Props) {
  const asset = view.asset
  const [scope, setScope] = useState<EditScope>('ITEM')
  const [inText, setInText] = useState(formatTimecode(view.trim.in, rate))
  const [outText, setOutText] = useState(formatTimecode(view.trim.out, rate))

  const inFrames = parseTimecode(inText, rate)
  const outFrames = parseTimecode(outText, rate)
  const total = asset ? durationIn(asset, rate) : 0

  const inBad = inFrames === null || inFrames < 0 || inFrames >= total
  const outBad = outFrames === null || outFrames > total || (inFrames !== null && outFrames <= inFrames)
  const valid = !inBad && !outBad && inFrames !== null && outFrames !== null

  /** Onde a cabeça de leitura está, em frames. */
  const [cabeça, setCabeça] = useState(view.trim.in)
  const [tocando, setTocando] = useState(false)
  const [tocável, setTocável] = useState(() => podeTocar(asset?.path))
  const [motivo, setMotivo] = useState<string | null>(null)
  const [pegando, setPegando] = useState<Alça>(null)

  const video = useRef<HTMLVideoElement | null>(null)
  const [mudo, setMudo] = useState(true)
  const [volume, setVolume] = useState(0.8)
  const régua = useRef<HTMLDivElement | null>(null)

  const segundoPorFrame = 1 / fps(rate)
  const emSegundos = (frames: number): number => frames * segundoPorFrame

  const fita = useMemo(() => {
    if (!asset) return []
    return Array.from({ length: FITA }, (_, i) => `/api/assets/${asset.id}/frame/${i}.jpg?total=${FITA}`)
  }, [asset])

  const [assentada, setAssentada] = useState(view.trim.in)
  useEffect(() => {
    const t = setTimeout(() => setAssentada(cabeça), 220)
    return () => clearTimeout(t)
  }, [cabeça])

  const parado = useMemo(() => {
    if (!asset || total <= 0) return null
    const fatia = Math.min(PARADOS - 1, Math.max(0, Math.floor((assentada / total) * PARADOS)))
    return `/api/assets/${asset.id}/frame/${fatia}.jpg?total=${PARADOS}`
  }, [asset, assentada, total])

  const frameNoPonto = (clientX: number): number => {
    const caixa = régua.current?.getBoundingClientRect()
    if (!caixa || caixa.width === 0 || total <= 0) return 0
    const razão = (clientX - caixa.left) / caixa.width
    return Math.round(Math.min(1, Math.max(0, razão)) * total)
  }

  const irPara = (frame: number): void => {
    const alvo = Math.min(total, Math.max(0, frame))
    setCabeça(alvo)
    const el = video.current
    if (el && tocável) el.currentTime = emSegundos(alvo)
  }

  useEffect(() => {
    if (pegando === null) return undefined

    const mover = (event: PointerEvent): void => {
      const frame = frameNoPonto(event.clientX)
      if (pegando === 'in') {
        const limite = outFrames === null ? total : outFrames - 1
        setInText(formatTimecode(Math.min(frame, Math.max(0, limite)), rate))
      } else if (pegando === 'out') {
        const limite = inFrames === null ? 0 : inFrames + 1
        setOutText(formatTimecode(Math.max(frame, Math.min(total, limite)), rate))
      }
      irPara(frame)
    }
    const soltar = (): void => setPegando(null)

    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar)
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
    }
  }, [pegando, inFrames, outFrames, total, rate, tocável])

  const pegar = (alça: Alça) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setPegando(alça)
    if (alça === 'cabeça') irPara(frameNoPonto(event.clientX))
  }

  useEffect(() => {
    const el = video.current
    if (!el || !tocável) return undefined
    const acompanhar = (): void => {
      const frame = Math.round(el.currentTime * fps(rate))
      setCabeça(frame)
      if (outFrames !== null && frame >= outFrames) {
        el.pause()
        setTocando(false)
      }
    }
    el.addEventListener('timeupdate', acompanhar)
    return () => el.removeEventListener('timeupdate', acompanhar)
  }, [tocável, outFrames, rate])

  const tocar = (): void => {
    const el = video.current
    if (!el || !tocável) return
    if (tocando) {
      el.pause()
      setTocando(false)
      return
    }
    if (outFrames !== null && cabeça >= outFrames) irPara(inFrames ?? 0)
    void el.play()
    setTocando(true)
  }

  const applySuggested = (): void => {
    if (!asset?.suggestedTrim) return
    setInText(formatTimecode(asset.suggestedTrim.in, rate))
    setOutText(formatTimecode(asset.suggestedTrim.out, rate))
  }

  const pct = (frames: number): string =>
    `${total > 0 ? Math.min(100, Math.max(0, (frames / total) * 100)) : 0}%`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface-card w-full max-w-4xl border border-border-subtle rounded shadow-2xl flex flex-col overflow-hidden max-h-[95vh]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-primary text-[22px]">content_cut</span>
            <div>
              <h2 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
                Marcação de Entrada e Saída (Trim In / Out)
              </h2>
              <p className="font-label-mono text-label-mono text-outline">
                {view.item.title} · Arquivo {dur(total, rate)} · {SOURCE_LABEL[view.trimSource]}
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
          {asset && (
            <div className="flex flex-col gap-space-sm">
              {/* CLEAN VIDEO PLAYER (Sem barras/elementos sobrepondo a imagem) */}
              <div className="relative w-full aspect-video bg-surface-container-lowest rounded border border-border-subtle overflow-hidden flex items-center justify-center shadow-inner">
                {tocável ? (
                  <video
                    ref={video}
                    src={`/api/assets/${asset.id}/media`}
                    poster={`/api/assets/${asset.id}/thumbnail.svg`}
                    preload="metadata"
                    className="w-full h-full object-contain"
                    onError={() => {
                      setMotivo(motivoDoErro(video.current))
                      setTocável(false)
                      setTocando(false)
                    }}
                    muted={mudo}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.volume = volume
                      irPara(view.trim.in)
                    }}
                  />
                ) : (
                  <img
                    src={parado ?? `/api/assets/${asset.id}/thumbnail.svg`}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                )}

                {/* Badge Discreta do Frame Atual */}
                <div className="absolute top-2 right-2 bg-surface-base/80 px-2 py-1 rounded font-timecode-display text-timecode-display text-on-surface border border-border-subtle pointer-events-none tabular-nums">
                  {formatTimecode(cabeça, rate)}
                </div>

                {!tocável && (
                  <div className="absolute bottom-2 inset-x-2 bg-surface-base/90 text-armed-amber p-1.5 rounded font-label-mono text-label-mono text-center border border-border-subtle">
                    {motivo ?? 'Formato decodificado via GStreamer'} · Arrastando a régua, a imagem exibe o quadro correspondente
                  </div>
                )}
              </div>

              {/* TIMELINE RULER NA PARTE INFERIOR COM MARCADORES I / O */}
              <div className="flex flex-col gap-1 pt-space-xs">
                <div
                  ref={régua}
                  onPointerDown={pegar('cabeça')}
                  className="relative h-14 w-full bg-surface-container-lowest rounded border border-border-subtle overflow-hidden cursor-pointer select-none"
                >
                  {/* Fita de Miniaturas */}
                  <div className="absolute inset-0 flex">
                    {fita.map((src) => (
                      <div key={src} className="flex-1 h-full border-r border-border-subtle/30 overflow-hidden">
                        <img src={src} alt="" draggable={false} className="w-full h-full object-cover opacity-60 pointer-events-none" />
                      </div>
                    ))}
                  </div>

                  {/* Sombreamento das Áreas Descartadas */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-black/70 pointer-events-none"
                    style={{ width: pct(inFrames ?? 0) }}
                  />
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-black/70 pointer-events-none"
                    style={{ left: pct(outFrames ?? total), width: 'auto' }}
                  />

                  {/* Marcador de Entrada (I) */}
                  <div
                    onPointerDown={pegar('in')}
                    className="absolute top-0 bottom-0 w-3 -ml-1.5 bg-on-air-crimson cursor-ew-resize z-20 flex items-center justify-center shadow-lg hover:brightness-125"
                    style={{ left: pct(inFrames ?? 0) }}
                    title="Arrastar Entrada (IN)"
                  >
                    <span className="text-[10px] text-surface-base font-bold">I</span>
                  </div>

                  {/* Marcador de Saída (O) */}
                  <div
                    onPointerDown={pegar('out')}
                    className="absolute top-0 bottom-0 w-3 -ml-1.5 bg-on-air-crimson cursor-ew-resize z-20 flex items-center justify-center shadow-lg hover:brightness-125"
                    style={{ left: pct(outFrames ?? total) }}
                    title="Arrastar Saída (OUT)"
                  >
                    <span className="text-[10px] text-surface-base font-bold">O</span>
                  </div>

                  {/* Agulha Playhead */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-white z-10 pointer-events-none shadow-[0_0_6px_#fff]"
                    style={{ left: pct(cabeça) }}
                  />
                </div>

                {/* Escala Graduada em Frames */}
                <div className="flex justify-between font-label-mono text-[10px] text-outline px-1">
                  <span>00:00:00:00</span>
                  <span>{formatTimecode(Math.round(total / 2), rate)}</span>
                  <span>{formatTimecode(total, rate)}</span>
                </div>
              </div>

              {/* BOTÕES TÁTEIS DE OPERAÇÃO */}
              <div className="flex flex-wrap items-center justify-between gap-space-sm p-space-xs bg-surface-panel rounded border border-border-subtle">
                <div className="flex items-center gap-1">
                  <button
                    onClick={tocar}
                    disabled={!tocável}
                    className="px-space-md py-1.5 rounded bg-surface-card hover:bg-surface-container text-on-surface font-label-caps text-label-caps font-bold border border-border-subtle flex items-center gap-1 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {tocando ? 'pause' : 'play_arrow'}
                    </span>
                    {tocando ? 'PAUSAR' : 'REPRODUZIR'}
                  </button>

                  <div className="h-5 w-px bg-border-subtle mx-1"></div>

                  <button
                    onClick={() => setInText(formatTimecode(cabeça, rate))}
                    className="px-space-md py-1.5 rounded bg-surface-card hover:bg-surface-container text-on-air-crimson font-label-caps text-label-caps font-bold border border-border-subtle transition-colors"
                  >
                    MARCAR ENTRADA (I)
                  </button>
                  <button
                    onClick={() => setOutText(formatTimecode(cabeça, rate))}
                    className="px-space-md py-1.5 rounded bg-surface-card hover:bg-surface-container text-on-air-crimson font-label-caps text-label-caps font-bold border border-border-subtle transition-colors"
                  >
                    MARCAR SAÍDA (O)
                  </button>
                  <button
                    onClick={() => irPara(inFrames ?? 0)}
                    className="px-space-md py-1.5 rounded bg-surface-card hover:bg-surface-container text-outline hover:text-on-surface font-label-caps text-label-caps font-bold border border-border-subtle transition-colors"
                  >
                    IR À ENTRADA
                  </button>
                  <button
                    onClick={() => irPara(outFrames ?? total)}
                    className="px-space-md py-1.5 rounded bg-surface-card hover:bg-surface-container text-outline hover:text-on-surface font-label-caps text-label-caps font-bold border border-border-subtle transition-colors"
                  >
                    IR À SAÍDA
                  </button>
                </div>

                {/* Controles de Áudio do Player */}
                {tocável && (
                  <div className="flex items-center gap-space-xs px-2">
                    <button
                      onClick={() => {
                        const el = video.current
                        setMudo((antes) => {
                          const agora = !antes
                          if (el) el.muted = agora
                          return agora
                        })
                      }}
                      className="p-1 rounded hover:bg-surface-container text-outline hover:text-on-surface"
                      title={mudo ? 'Desmutar' : 'Mutar'}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {mudo ? 'volume_off' : 'volume_up'}
                      </span>
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={volume}
                      aria-label="Volume"
                      className="w-20 accent-primary cursor-pointer"
                      onChange={(event) => {
                        const valor = Number(event.target.value)
                        setVolume(valor)
                        const el = video.current
                        if (el) {
                          el.volume = valor
                          if (valor > 0 && el.muted) {
                            el.muted = false
                            setMudo(false)
                          }
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timecode Inputs & Math */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md p-space-md bg-surface-container-lowest rounded border border-border-subtle">
            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-outline uppercase">Entrada (IN Timecode)</label>
              <input
                type="text"
                value={inText}
                onChange={(event) => setInText(event.target.value)}
                className={`bg-surface-card text-on-surface p-2 rounded border font-timecode-table text-timecode-table outline-none ${
                  inBad ? 'border-on-air-crimson text-on-air-crimson' : 'border-border-subtle focus:border-primary'
                }`}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-outline uppercase">Saída (OUT Timecode)</label>
              <input
                type="text"
                value={outText}
                onChange={(event) => setOutText(event.target.value)}
                className={`bg-surface-card text-on-surface p-2 rounded border font-timecode-table text-timecode-table outline-none ${
                  outBad ? 'border-on-air-crimson text-on-air-crimson' : 'border-border-subtle focus:border-primary'
                }`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-space-sm bg-surface-panel rounded border border-border-subtle font-label-mono text-label-mono">
            <div>
              DURAÇÃO RESULTANTE NO AR:{' '}
              <strong className="text-status-ok-bright text-body-lg">
                {valid ? dur(outFrames - inFrames, rate) : '—'}
              </strong>
              {valid && total > 0 && (
                <span className="text-outline ml-2">
                  (Descarta {dur(total - (outFrames - inFrames), rate)} de sobra)
                </span>
              )}
            </div>

            {asset?.suggestedTrim && (
              <button
                onClick={applySuggested}
                className="px-space-sm py-1 rounded bg-surface-card hover:bg-surface-container text-armed-amber font-label-caps text-label-caps font-bold border border-border-subtle transition-colors"
              >
                USAR PONTAS DETECTADAS ({dur(asset.suggestedTrim.in, rate)} PRETO INICIAL)
              </button>
            )}
          </div>

          <ScopePicker
            value={scope}
            onChange={setScope}
            siblingCount={view.siblingCount}
            hasAsset={asset !== null}
            what="corte"
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
            disabled={!valid}
            onClick={() => valid && onApply({ in: inFrames, out: outFrames }, scope)}
            className="px-space-lg py-2 rounded bg-primary-container text-on-primary-container hover:brightness-110 font-label-caps text-label-caps uppercase font-bold transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">check_circle</span>
            Aplicar Trim
          </button>
        </div>
      </div>
    </div>
  )
}

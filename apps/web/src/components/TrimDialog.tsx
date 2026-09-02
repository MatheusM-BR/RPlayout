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
  ITEM: 'corte próprio deste item',
  ASSET: 'herdado do padrão do acervo',
  FILE: 'arquivo inteiro, sem corte',
  NONE: 'sem arquivo',
}

/** Quantos quadros formam a fita embaixo da régua. */
const FITA = 16

/**
 * O que cada extensão é, para perguntar ao navegador se ele toca antes de
 * tentar. Perguntar sai de graça e é instantâneo; tentar custa abrir uma
 * conexão, baixar o cabeçalho de um arquivo grande e só então descobrir que
 * não dava -- com a tela preta esse tempo todo.
 */
const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
}

/**
 * Vale a pena tentar tocar este arquivo no navegador?
 *
 * Só responde "não" quando a resposta é sabida: extensão conhecida cujo tipo o
 * navegador recusa de saída, como Matroska. Extensão que não está na tabela
 * ganha o benefício da dúvida e vai para o `<video>` -- errar para o "não"
 * aqui custava caro: `.ts`, `.avi` e `.mxf` não estavam na lista, então o
 * player nem era montado e o operador via uma imagem parada sem entender por
 * quê. Tentar e falhar custa um erro imediato, e o `onError` já sabe cair na
 * imagem parada.
 */
function podeTocar(path: string | undefined): boolean {
  if (path === undefined) return false
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const tipo = MIME[ext]
  if (tipo === undefined) return true
  return document.createElement('video').canPlayType(tipo) !== ''
}

/** O que o navegador disse sobre o arquivo, quando ele desistiu. */
function motivoDoErro(video: HTMLVideoElement | null): string {
  const erro = video?.error
  if (!erro) return 'o navegador não conseguiu abrir o arquivo'
  switch (erro.code) {
    case MediaError.MEDIA_ERR_DECODE:
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'o navegador não decodifica este formato'
    case MediaError.MEDIA_ERR_NETWORK:
      return 'a leitura do arquivo foi interrompida'
    case MediaError.MEDIA_ERR_ABORTED:
      return 'a leitura foi cancelada'
    default:
      return 'o navegador não conseguiu abrir o arquivo'
  }
}

/**
 * Quadros disponíveis para a imagem parada quando o navegador não toca o
 * arquivo. Arrastar mostra o mais próximo destes: a imagem pula de fatia em
 * fatia, mas o ponto marcado é o exato de onde o dedo parou -- quem manda no
 * valor é o pixel, não a imagem que ilustra.
 */
const PARADOS = 64

/** O que o dedo está segurando. */
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
  /** O navegador aceitou decodificar este arquivo? */
  const [tocável, setTocável] = useState(() => podeTocar(asset?.path))
  /** O que ele disse quando recusou, para a tela não ficar só com um sumiço. */
  const [motivo, setMotivo] = useState<string | null>(null)

  /** O que o dedo está segurando agora. Nulo quando ninguém está arrastando. */
  const [pegando, setPegando] = useState<Alça>(null)

  const video = useRef<HTMLVideoElement | null>(null)
  const régua = useRef<HTMLDivElement | null>(null)

  const segundoPorFrame = 1 / fps(rate)
  const emSegundos = (frames: number): number => frames * segundoPorFrame

  const fita = useMemo(() => {
    if (!asset) return []
    return Array.from({ length: FITA }, (_, i) => `/api/assets/${asset.id}/frame/${i}.jpg?total=${FITA}`)
  }, [asset])

  /**
   * A cabeça de leitura depois que ela parou de andar.
   *
   * Cada quadro parado custa abrir o arquivo e posicionar. Pedir um a cada
   * pixel de arrasto poria dezenas de leituras na fila para mostrar só a
   * última; esperar a mão parar pede uma.
   */
  const [assentada, setAssentada] = useState(view.trim.in)
  useEffect(() => {
    const t = setTimeout(() => setAssentada(cabeça), 220)
    return () => clearTimeout(t)
  }, [cabeça])

  /**
   * A imagem parada para a posição da cabeça. Serve de espelho quando o
   * navegador não toca o arquivo -- e de nada quando toca, porque aí o
   * `<video>` já mostra o quadro certo.
   */
  const parado = useMemo(() => {
    if (!asset || total <= 0) return null
    const fatia = Math.min(PARADOS - 1, Math.max(0, Math.floor((assentada / total) * PARADOS)))
    return `/api/assets/${asset.id}/frame/${fatia}.jpg?total=${PARADOS}`
  }, [asset, assentada, total])

  /** Frame correspondente a uma posição de mouse dentro da régua. */
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

  /** Arrastar fora da régua ainda vale: o dedo sai da caixa e volta. */
  useEffect(() => {
    if (pegando === null) return undefined

    const mover = (event: PointerEvent): void => {
      const frame = frameNoPonto(event.clientX)
      if (pegando === 'in') {
        // A entrada nunca passa da saída: um corte invertido não existe.
        const limite = outFrames === null ? total : outFrames - 1
        setInText(formatTimecode(Math.min(frame, Math.max(0, limite)), rate))
      } else if (pegando === 'out') {
        const limite = inFrames === null ? 0 : inFrames + 1
        setOutText(formatTimecode(Math.max(frame, Math.min(total, limite)), rate))
      }
      // A imagem acompanha o dedo nas três alças: arrastar a saída sem ver o
      // quadro da saída seria marcar no escuro.
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
    // Clicar na régua já leva a cabeça para lá, sem precisar arrastar.
    if (alça === 'cabeça') irPara(frameNoPonto(event.clientX))
  }

  /** Tocar para conferir o corte: para sozinho na saída. */
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
    // Dar play parado depois do OUT não mostraria nada: volta para o IN.
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
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Marcação de entrada e saída</h2>
          <div className="sub">
            {view.item.title} · arquivo {dur(total, rate)} · {SOURCE_LABEL[view.trimSource]}
          </div>
        </header>

        <div className="body">
          {asset && (
            <div className="trim">
              <div className="tela">
                {/* O `<video>` é o caminho bom: dá movimento e quadro exato.
                    Formato que o navegador não decodifica cai no `onError` e a
                    imagem parada assume -- extraída pelo GStreamer, que abre
                    tudo que o canal abre. */}
                {tocável ? (
                  <video
                    ref={video}
                    src={`/api/assets/${asset.id}/media`}
                    preload="metadata"
                    onError={() => {
                      setMotivo(motivoDoErro(video.current))
                      setTocável(false)
                      setTocando(false)
                    }}
                    onLoadedMetadata={() => irPara(view.trim.in)}
                  />
                ) : (
                  parado && <img src={parado} alt="" />
                )}
                <div className="tc">{formatTimecode(cabeça, rate)}</div>
                {!tocável && (
                  <div className="aviso">
                    {motivo ?? 'o navegador não toca este formato'} · arrastando,
                    a imagem mostra o quadro mais próximo
                  </div>
                )}
              </div>

              <div className="régua" ref={régua} onPointerDown={pegar('cabeça')}>
                {/* Os dezesseis pedidos saem juntos de propósito: o servidor
                    extrai a fita inteira numa leitura só, e quem chega depois
                    espera a mesma. Pedir um de cada vez só faria a fita
                    aparecer devagar sem economizar nada. */}
                <div className="fita">
                  {fita.map((src) => (
                    <div className="quadro" key={src}>
                      <img src={src} alt="" draggable={false} />
                    </div>
                  ))}
                </div>

                {/* O que fica de fora do corte some por baixo de um véu: o
                    operador vê o programa, não o arquivo. */}
                <div className="fora" style={{ left: 0, width: pct(inFrames ?? 0) }} />
                <div
                  className="fora"
                  style={{ left: pct(outFrames ?? total), right: 0, width: 'auto' }}
                />

                <div
                  className={`alça in${pegando === 'in' ? ' pego' : ''}`}
                  style={{ left: pct(inFrames ?? 0) }}
                  onPointerDown={pegar('in')}
                  title="Arraste a entrada"
                />
                <div
                  className={`alça out${pegando === 'out' ? ' pego' : ''}`}
                  style={{ left: pct(outFrames ?? total) }}
                  onPointerDown={pegar('out')}
                  title="Arraste a saída"
                />
                <div className="cabeça" style={{ left: pct(cabeça) }} />
              </div>

              <div className="controles">
                <button className="btn small" onClick={tocar} disabled={!tocável}>
                  {tocando ? '■' : '▶'}
                </button>
                <button
                  className="btn small"
                  onClick={() => setInText(formatTimecode(cabeça, rate))}
                  title="Marca a entrada onde a cabeça está"
                >
                  marcar entrada
                </button>
                <button
                  className="btn small"
                  onClick={() => setOutText(formatTimecode(cabeça, rate))}
                  title="Marca a saída onde a cabeça está"
                >
                  marcar saída
                </button>
                <button className="btn small" onClick={() => irPara(inFrames ?? 0)}>
                  ir à entrada
                </button>
                <button className="btn small" onClick={() => irPara(outFrames ?? total)}>
                  ir à saída
                </button>
              </div>
            </div>
          )}

          <div className="row">
            <div className="field">
              <label>Entrada (I)</label>
              <input
                type="text"
                className={inBad ? 'bad' : ''}
                value={inText}
                onChange={(event) => setInText(event.target.value)}
              />
            </div>
            <div className="field">
              <label>Saída (O)</label>
              <input
                type="text"
                className={outBad ? 'bad' : ''}
                value={outText}
                onChange={(event) => setOutText(event.target.value)}
              />
            </div>
          </div>

          <div className="note">
            Duração no ar:{' '}
            <b>{valid ? dur(outFrames - inFrames, rate) : '—'}</b>
            {valid && total > 0 && (
              <> · descarta {dur(total - (outFrames - inFrames), rate)} do arquivo</>
            )}
          </div>

          {asset?.suggestedTrim && (
            <button className="btn small" onClick={applySuggested}>
              usar pontas detectadas ({dur(asset.suggestedTrim.in, rate)} de preto na cabeça)
            </button>
          )}

          <ScopePicker
            value={scope}
            onChange={setScope}
            siblingCount={view.siblingCount}
            hasAsset={asset !== null}
            what="corte"
          />
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button
            className="btn take"
            disabled={!valid}
            onClick={() => valid && onApply({ in: inFrames, out: outFrames }, scope)}
          >
            aplicar
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import {
  durationIn,
  formatTimecode,
  parseTimecode,
  secondsToFrames,
  type Anchor,
  type MediaAsset,
  type Rate,
} from '@rplayout/protocol'
import { api } from '../api.js'
import { dur } from '../format.js'
import type { LiveSource, SourceFamily, SourceList } from '../types.js'

type AnchorMode = 'FLOW' | 'FIXED' | 'SOFT'
type Kind = 'FILE' | 'LIVE'

/** O que o diálogo devolve: ou um arquivo do acervo, ou uma fonte ao vivo. */
export interface NewItem {
  mediaId: string | null
  sourceRef: string | null
  type: 'VT' | 'LIVE'
  title: string
  anchor: Anchor
  /** Só para ao vivo: quanto tempo a fonte ocupa na grade. */
  durationOverride: number | null
}

interface Props {
  assets: MediaAsset[]
  /** Arquivo já escolhido, quando a inserção começou por um clique no acervo. */
  initialAssetId?: string
  rate: Rate
  /** Hora sugerida para o campo, normalmente o fim da grade. */
  suggestedAt: number
  onCancel: () => void
  onAdd: (item: NewItem) => void
}

const FAMILY_LABEL: Record<LiveSource['family'], string> = {
  SDI: 'PLACA (SDI/HDMI)',
  NDI: 'NDI NA REDE',
  GUEST: 'CONVIDADOS NO SERVIDOR',
}

/**
 * Inserir item com hora de entrada. O servidor acha sozinho a posição na grade
 * e o scheduler reorganiza o resto — o operador só diz o que entra e quando.
 */
export function AddItemDialog({
  assets,
  initialAssetId,
  rate,
  suggestedAt,
  onCancel,
  onAdd,
}: Props) {
  const [kind, setKind] = useState<Kind>('FILE')
  const [assetId, setAssetId] = useState(initialAssetId ?? assets[0]?.id ?? '')
  const [mode, setMode] = useState<AnchorMode>('FLOW')
  const [atText, setAtText] = useState(formatTimecode(suggestedAt, rate))
  const [toleranceSeconds, setToleranceSeconds] = useState(90)

  const [sources, setSources] = useState<SourceList | null>(null)
  const [scanning, setScanning] = useState(false)
  const [sourceRef, setSourceRef] = useState('')
  const [liveMinutes, setLiveMinutes] = useState(15)

  // A descoberta só roda quando o operador pede o vivo: enumerar NDI vasculha
  // a rede, e quem só quer pôr um VT na grade não deve pagar por isso.
  useEffect(() => {
    if (kind !== 'LIVE' || sources !== null) return
    let alive = true
    setScanning(true)
    api
      .sources()
      .then((list) => {
        if (alive) setSources(list)
      })
      .catch(() => {
        if (alive) setSources({ sdi: FAILED, ndi: FAILED, guests: FAILED })
      })
      .finally(() => {
        if (alive) setScanning(false)
      })
    return () => {
      alive = false
    }
  }, [kind, sources])

  const rescan = (): void => {
    setScanning(true)
    api
      .sources(true)
      .then(setSources)
      .catch(() => setSources({ sdi: FAILED, ndi: FAILED, guests: FAILED }))
      .finally(() => setScanning(false))
  }

  const families: SourceFamily[] = sources ? [sources.sdi, sources.ndi, sources.guests] : []
  const live = families.flatMap((family) => family.sources)
  const chosen = live.find((source) => source.reference === sourceRef)

  const at = parseTimecode(atText, rate)
  const asset = assets.find((candidate) => candidate.id === assetId)
  const needsTime = mode !== 'FLOW'
  const valid =
    (kind === 'FILE' ? asset !== undefined : chosen !== undefined && liveMinutes > 0) &&
    (!needsTime || at !== null)

  const build = (): Anchor => {
    if (mode === 'FLOW' || at === null) return { kind: 'FLOW' }
    if (mode === 'FIXED') return { kind: 'FIXED', at }
    return {
      kind: 'SOFT',
      at,
      tolerance: secondsToFrames(toleranceSeconds, rate),
      priority: 3,
    }
  }

  const submit = (): void => {
    const anchor = build()
    if (kind === 'FILE') {
      if (!asset) return
      onAdd({
        mediaId: asset.id,
        sourceRef: null,
        type: 'VT',
        title: asset.title,
        anchor,
        durationOverride: null,
      })
      return
    }
    if (!chosen) return
    onAdd({
      mediaId: null,
      sourceRef: chosen.reference,
      type: 'LIVE',
      title: chosen.label,
      anchor,
      durationOverride: secondsToFrames(liveMinutes * 60, rate),
    })
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Inserir item na grade</h2>
          <div className="sub">a grade se reorganiza em volta da hora que você marcar</div>
        </header>

        <div className="body">
          <div className="field">
            <label>O que entra</label>
            <div className="seg-group">
              <button className={kind === 'FILE' ? 'on' : ''} onClick={() => setKind('FILE')}>
                ARQUIVO
              </button>
              <button className={kind === 'LIVE' ? 'on' : ''} onClick={() => setKind('LIVE')}>
                AO VIVO
              </button>
            </div>
          </div>

          {kind === 'FILE' ? (
            <div className="field">
              <label>Arquivo</label>
              <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                {assets.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title} · {dur(durationIn(option, rate), rate)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div className="field">
                <label>
                  Fonte
                  <button className="link" disabled={scanning} onClick={rescan}>
                    {scanning ? 'procurando…' : 'procurar de novo'}
                  </button>
                </label>
                <select
                  value={sourceRef}
                  disabled={live.length === 0}
                  onChange={(event) => setSourceRef(event.target.value)}
                >
                  <option value="">
                    {scanning
                      ? 'procurando fontes…'
                      : live.length === 0
                        ? 'nenhuma fonte ao vivo disponível'
                        : 'escolha a fonte'}
                  </option>
                  {(['SDI', 'NDI', 'GUEST'] as const).map((family) => {
                    const group = live.filter((source) => source.family === family)
                    if (group.length === 0) return null
                    return (
                      <optgroup key={family} label={FAMILY_LABEL[family]}>
                        {group.map((source) => (
                          <option key={source.reference} value={source.reference}>
                            {source.label}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>

              {/* O que falta é tão informativo quanto o que existe: sem placa,
                  sem plugin e sem convidado são três problemas diferentes. */}
              {sources && (
                <ul className="reasons">
                  {reasonsOf(sources).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}

              <div className="field">
                <label>Ocupa na grade (minutos)</label>
                <input
                  type="number"
                  min="1"
                  max="600"
                  value={liveMinutes}
                  onChange={(event) => setLiveMinutes(Number(event.target.value))}
                />
              </div>
            </>
          )}

          <div className="field">
            <label>Compromisso com o relógio</label>
            <div className="seg-group">
              <button className={mode === 'FLOW' ? 'on' : ''} onClick={() => setMode('FLOW')}>
                NA SEQUÊNCIA
              </button>
              <button className={mode === 'FIXED' ? 'on' : ''} onClick={() => setMode('FIXED')}>
                HORA FIXA
              </button>
              <button className={mode === 'SOFT' ? 'on' : ''} onClick={() => setMode('SOFT')}>
                HORA COM FOLGA
              </button>
            </div>
          </div>

          {needsTime && (
            <div className="row">
              <div className="field">
                <label>Entra às</label>
                <input
                  type="text"
                  className={at === null ? 'bad' : ''}
                  value={atText}
                  onChange={(event) => setAtText(event.target.value)}
                />
              </div>
              {mode === 'SOFT' && (
                <div className="field">
                  <label>Tolerância (segundos)</label>
                  <input
                    type="number"
                    min="0"
                    max="600"
                    value={toleranceSeconds}
                    onChange={(event) => setToleranceSeconds(Number(event.target.value))}
                  />
                </div>
              )}
            </div>
          )}

          <div className="note">
            {kind === 'LIVE'
              ? 'A fonte ao vivo não tem fim próprio: o tempo acima é o que ela ocupa na grade. '
              : ''}
            {mode === 'FLOW' && 'Entra quando o item anterior terminar. Vai para o fim da grade.'}
            {mode === 'FIXED' &&
              'Hora obrigatória. O que estiver na frente é cortado ou descartado para caber.'}
            {mode === 'SOFT' &&
              'Hora alvo com folga para os dois lados. O motor escolhe o melhor ponto da janela.'}
          </div>
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button className="btn take" disabled={!valid} onClick={submit}>
            inserir
          </button>
        </footer>
      </div>
    </div>
  )
}

const FAILED: SourceFamily = {
  available: false,
  reason: 'a máquina não respondeu à descoberta de fontes',
  sources: [],
}

/** Uma linha por família que não tem nada a oferecer, dizendo o motivo. */
function reasonsOf(list: SourceList): string[] {
  const lines: string[] = []
  const add = (family: SourceFamily, name: string, empty: string): void => {
    if (family.sources.length > 0) return
    lines.push(`${name}: ${family.reason ?? empty}`)
  }
  add(list.sdi, 'placa', 'driver presente, nenhuma placa encontrada')
  add(list.ndi, 'NDI', 'nenhuma fonte anunciada na rede')
  add(list.guests, 'convidados', 'nenhuma chave de convidado ativa')
  return lines
}

import { useState } from 'react'
import { formatVideoFormat, type Channel } from '@rplayout/protocol'
import { api } from '../api.js'

interface Props {
  channel: Channel
  onCancel: () => void
  onSaved: (message: string) => void
}

/** Formatos que uma emissora usa de verdade. Cadência é razão exata, sempre. */
const RATES: { label: string; num: number; den: number }[] = [
  { label: '59,94', num: 60000, den: 1001 },
  { label: '50', num: 50, den: 1 },
  { label: '29,97', num: 30000, den: 1001 },
  { label: '25', num: 25, den: 1 },
  { label: '23,976', num: 24000, den: 1001 },
]

const SIZES: { label: string; width: number; height: number }[] = [
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '720×576', width: 720, height: 576 },
]

/**
 * Formato do canal.
 *
 * Geometria, cadência e varredura são a espinha do pipeline: o engine é
 * construído em volta delas. Trocar derruba e reconstrói o canal -- alguns
 * segundos de preto --, e a tela diz isso em vez de fingir que é instantâneo.
 */
export function ChannelDialog({ channel, onCancel, onSaved }: Props) {
  const [name, setName] = useState(channel.name)
  const [size, setSize] = useState({ width: channel.width, height: channel.height })
  const [rate, setRate] = useState({ num: channel.rate.num, den: channel.rate.den })
  const [scan, setScan] = useState(channel.scan)
  const [fieldOrder, setFieldOrder] = useState(channel.fieldOrder)
  const [busy, setBusy] = useState(false)

  const preview = formatVideoFormat({ height: size.height, rate, scan })
  const muda =
    size.width !== channel.width ||
    size.height !== channel.height ||
    rate.num !== channel.rate.num ||
    rate.den !== channel.rate.den ||
    scan !== channel.scan ||
    fieldOrder !== channel.fieldOrder

  const salvar = (): void => {
    setBusy(true)
    api
      .patchChannel(channel.id, {
        name,
        width: size.width,
        height: size.height,
        rateNum: rate.num,
        rateDen: rate.den,
        scan,
        fieldOrder,
      })
      .then((result) =>
        onSaved(
          result.formatChanged
            ? `Canal em ${preview}. O motor foi reconstruído.`
            : 'Canal atualizado.',
        ),
      )
      .catch((failure: Error) => onSaved(failure.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Formato do canal</h2>
          <div className="sub">
            hoje em {formatVideoFormat(channel)} · a grade conta quadros nesta cadência
          </div>
        </header>

        <div className="body">
          <div className="field">
            <label>Nome</label>
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </div>

          <div className="field">
            <label>Tamanho</label>
            <div className="seg-group wrap">
              {SIZES.map((option) => (
                <button
                  key={option.label}
                  className={size.width === option.width && size.height === option.height ? 'on' : ''}
                  onClick={() => setSize({ width: option.width, height: option.height })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Cadência</label>
            <div className="seg-group wrap">
              {RATES.map((option) => (
                <button
                  key={option.label}
                  className={rate.num === option.num && rate.den === option.den ? 'on' : ''}
                  onClick={() => setRate({ num: option.num, den: option.den })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Varredura</label>
            <div className="seg-group">
              <button
                className={scan === 'PROGRESSIVE' ? 'on' : ''}
                onClick={() => setScan('PROGRESSIVE')}
              >
                PROGRESSIVA
              </button>
              <button
                className={scan === 'INTERLACED' ? 'on' : ''}
                onClick={() => setScan('INTERLACED')}
              >
                ENTRELAÇADA
              </button>
            </div>
          </div>

          {scan === 'INTERLACED' && (
            <div className="field">
              <label>Primeiro campo</label>
              <div className="seg-group">
                <button className={fieldOrder === 'TFF' ? 'on' : ''} onClick={() => setFieldOrder('TFF')}>
                  SUPERIOR (TFF)
                </button>
                <button className={fieldOrder === 'BFF' ? 'on' : ''} onClick={() => setFieldOrder('BFF')}>
                  INFERIOR (BFF)
                </button>
              </div>
            </div>
          )}

          <div className="note">
            Fica em <b>{preview}</b>.{' '}
            {scan === 'INTERLACED' &&
              'Entrelaçado, a grade continua contando quadros e o motor compõe no dobro, em campos. '}
            Cadência alta custa CPU: 1080p50 é o dobro do trabalho de 1080p25, e vários canais na
            mesma máquina somam.
          </div>

          {muda && (
            <div className="note warn">
              Trocar o formato derruba e reconstrói o canal — alguns segundos de preto no ar. O que
              estiver tocando volta do começo.
            </div>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button className="btn take" disabled={busy} onClick={salvar}>
            aplicar
          </button>
        </footer>
      </div>
    </div>
  )
}

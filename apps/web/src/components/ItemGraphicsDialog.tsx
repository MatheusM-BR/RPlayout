import { useEffect, useRef,useState } from 'react'
import { api,type ItemAutomationState } from '../api.js'
import type { ItemView } from '../types.js'
import {SecondaryEventsPanel} from './SecondaryEventsPanel.js'
import {matchesAutomationOwner} from '../domain/item-automation-state.js'

interface Props {
  view: ItemView
  channelId: string
  onClose: () => void
  onMessage: (text: string) => void
}

const mmss = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

/**
 * Grafismo preso ao item.
 *
 * É o que tira o GC do improviso: o crédito entra sozinho no segundo marcado,
 * toda vez que aquele item for ao ar. O operador continua podendo pôr arte na
 * mão pelo painel de GC -- as duas coisas passam pelo mesmo caminho.
 */
export function ItemGraphicsDialog({ view, channelId, onClose, onMessage }: Props) {
  const [snapshot,setSnapshot]=useState<ItemAutomationState|null>(null)
  const [origin]=useState(()=>({itemId:view.item.id,rundownId:view.item.rundownId,channelId,revision:view.editorialRevision}))
  const [busy,setBusy]=useState(false),busyRef=useRef(false)
  const [error,setError]=useState<string|null>(null),generation=useRef(0)
  const [chosen, setChosen] = useState('')
  const [atSeconds, setAtSeconds] = useState(5)
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const current=++generation.current
    if(origin.revision===undefined){setError('Atualize a grade antes de abrir a edição de grafismos.');return}
    void api.itemGraphics(origin.itemId,origin.revision)
      .then((result) => {
        if (generation.current!==current) return
        if(!matchesAutomationOwner(result,origin))throw new Error('O item mudou de grade. Feche e atualize a seleção.')
        setSnapshot(result)
        setChosen((now) => now || (result.templates[0]?.id ?? ''))
      })
      .catch(failure => {if(generation.current===current)setError(failure instanceof Error?failure.message:'Não foi possível abrir a conferência.')})
    return () => {
      ++generation.current
    }
  }, [origin])

  const templates=snapshot?.templates??[],cues=snapshot?.cues??null
  const apply=async(work:()=>Promise<ItemAutomationState>):Promise<boolean>=>{
    if(busyRef.current||!snapshot)return false
    const current=generation.current;busyRef.current=true;setBusy(true);setError(null)
    try{
      const result=await work()
      if(generation.current!==current)return false
      if(!matchesAutomationOwner(result,origin))throw new Error('A resposta pertence a outra seleção. Atualize a conferência.')
      setSnapshot(result);onMessage('Edição salva. Publique uma revisão para aplicá-la na execução.');return true
    }catch(failure){if(generation.current===current)setError(failure instanceof Error?failure.message:'Edição recusada.');return false}
    finally{if(generation.current===current){busyRef.current=false;setBusy(false)}}
  }
  const refresh=async()=>{
    if(busyRef.current)return
    const current=generation.current;busyRef.current=true;setBusy(true)
    try{
      const result=await api.itemGraphics(origin.itemId)
      if(generation.current!==current)return
      if(!matchesAutomationOwner(result,origin))throw new Error('O item mudou de grade. Feche e atualize a seleção.')
      setSnapshot(result);setError(null)
    }catch(failure){if(generation.current===current)setError(failure instanceof Error?failure.message:'Não foi possível atualizar.')}
    finally{if(generation.current===current){busyRef.current=false;setBusy(false)}}
  }

  const template = templates.find((entry) => entry.id === chosen) ?? null

  const add = (): void => {
    if (!template||!snapshot) return
    void apply(()=>api.addItemGraphic(origin.itemId,template.id,values,atSeconds,snapshot.editorialRevision)).then(accepted=>{if(accepted)setValues({})})
  }

  const remove = (id: string): void => {
    if(snapshot)void apply(()=>api.removeItemGraphic(id,snapshot.editorialRevision))
  }

  return (
    <div className="backdrop" onClick={()=>{if(!busy)onClose()}}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Grafismo deste item</h2>
          <div className="sub">{view.item.title} · entra sozinho, toda vez que o item for ao ar</div>
        </header>

        <div className="body">
          <fieldset disabled={busy}>
          <p className="note">Grafismos automáticos fazem parte da revisão publicada. Edite aqui e publique a grade para aplicar as alterações no ar.</p>
          <p className="note">Se outra estação alterar a grade, salvar será recusado e seu rascunho permanecerá preenchido. Atualizar a conferência mantém os campos, mas mostra a edição atual antes de uma nova confirmação.</p>
          {error&&<p role="alert" className="text-on-air-crimson">{error}</p>}
          <button className="btn small" disabled={busy} onClick={()=>void refresh()}>Atualizar conferência</button>
          {cues === null && <div className="note">carregando…</div>}
          {cues?.length === 0 && (
            <div className="note">Nenhuma arte presa a este item. Ele vai ao ar limpo.</div>
          )}

          {cues && cues.length > 0 && (
            <ul className="cues">
              {cues.map((cue) => (
                <li key={cue.id}>
                  <b>{mmss(cue.atSeconds)}</b>
                  <span>{cue.templateName}</span>
                  <i>{Object.values(cue.values).filter(Boolean).join(' · ') || 'sem campos'}</i>
                  <button className="btn small" disabled={busy} onClick={() => remove(cue.id)}>
                    tirar
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="row">
            <div className="field">
              <label>Arte</label>
              <select
                value={chosen}
                onChange={(event) => {
                  setChosen(event.target.value)
                  setValues({})
                }}
              >
                {templates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Entra aos (segundos)</label>
              <input
                type="number"
                min="0"
                max="3600"
                value={atSeconds}
                onChange={(event) => setAtSeconds(Number(event.target.value))}
              />
            </div>
          </div>

          {template?.fields.map((field) => (
            <div className="field" key={field.key}>
              <label>{field.label}</label>
              <input
                type="text"
                value={values[field.key] ?? ''}
                placeholder={field.defaultValue || '—'}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </div>
          ))}
          <SecondaryEventsPanel itemId={origin.itemId} channelId={origin.channelId} templates={templates} snapshot={snapshot} busy={busy} onApply={apply}/>
          </fieldset>
        </div>

        <footer>
          <button className="btn" disabled={busy} onClick={onClose}>
            fechar
          </button>
          <button className="btn take" disabled={busy||!template||!snapshot} onClick={add}>
            prender ao item
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { Rate } from '@rplayout/protocol'
import { api } from '../api.js'
import { dur } from '../format.js'
import type { FillPlan, ScheduleRule, Snapshot } from '../types.js'

interface Props {
  rundownId: string
  channelId: string
  /** Categorias que existem no acervo, para a faixa escolher entre elas. */
  categories: string[]
  rate: Rate
  onCancel: () => void
  onApplied: (snapshot: Snapshot, message: string) => void
  onMessage: (text: string) => void
}

/**
 * Montagem automática.
 *
 * Planejar é de graça e aplicar mexe na grade, então são dois passos: o
 * operador vê a proposta inteira antes de ela virar programação. Grade que
 * aparece pronta sem ninguém ter visto é grade que o operador desmonta na mão.
 */
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const hhmm = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

const parseHhmm = (text: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 0 && minutes <= 1440 ? minutes : null
}

export function AutoFillDialog({
  rundownId,
  channelId,
  categories,
  rate,
  onCancel,
  onApplied,
  onMessage,
}: Props) {
  const [minutes, setMinutes] = useState(30)
  const [ate, setAte] = useState('')
  const [avoidHours, setAvoidHours] = useState(6)
  const [plan, setPlan] = useState<FillPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [rules, setRules] = useState<ScheduleRule[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editing, setEditing] = useState({ name: '', from: '06:00', to: '12:00', weekdays: '0123456', categories: [] as string[], avoidHours: 6 })
  const [draft, setDraft] = useState({
    name: '',
    from: '06:00',
    to: '12:00',
    weekdays: '0123456',
    categories: [] as string[],
  })

  useEffect(() => {
    let alive = true
    api
      .rules(channelId)
      .then((result) => alive && setRules(result.rules))
      .catch(() => alive && setRules([]))
    return () => {
      alive = false
    }
  }, [channelId])

  const addRule = (): void => {
    const from = parseHhmm(draft.from)
    const to = parseHhmm(draft.to)
    if (draft.name.trim() === '' || from === null || to === null || to <= from) {
      onMessage('A faixa precisa de nome e de um horário que termine depois de começar.')
      return
    }
    api
      .addRule(channelId, {
        name: draft.name.trim(),
        weekdays: draft.weekdays,
        startMinute: from,
        endMinute: to,
        categories: draft.categories,
        avoidHours,
      })
      .then((result) => {
        setRules((current) => [...(current ?? []), result.rule].sort((a, b) => a.startMinute - b.startMinute))
        setDraft({ ...draft, name: '' })
      })
      .catch((failure: Error) => onMessage(failure.message))
  }

  const removeRule = (id: string): void => {
    api
      .removeRule(id)
      .then(() => setRules((current) => (current ?? []).filter((rule) => rule.id !== id)))
      .catch((failure: Error) => onMessage(failure.message))
  }

  const editRule = (rule: ScheduleRule): void => {
    setEditingId(rule.id)
    setEditing({ name: rule.name, from: hhmm(rule.startMinute), to: hhmm(rule.endMinute), weekdays: rule.weekdays, categories: rule.categories, avoidHours: rule.avoidHours })
  }

  const saveRule = (): void => {
    if (!editingId) return
    const from = parseHhmm(editing.from); const to = parseHhmm(editing.to)
    if (!editing.name.trim() || from === null || to === null || to <= from) { onMessage('A faixa precisa de nome e horário válido.'); return }
    api.updateRule(editingId, { name: editing.name.trim(), startMinute: from, endMinute: to, weekdays: editing.weekdays, categories: editing.categories, avoidHours: editing.avoidHours })
      .then((result) => { setRules((current) => (current ?? []).map((rule) => rule.id === editingId ? result.rule : rule).sort((a, b) => a.startMinute - b.startMinute)); setEditingId(null); onMessage('Faixa atualizada.') })
      .catch((failure: Error) => onMessage(failure.message))
  }

  const fillDay = (): void => {
    setBusy(true)
    api
      .autoFillDay(rundownId)
      .then((result) => {
        const filled = result.bands.reduce((total, band) => total + band.items, 0)
        onApplied(result, `Dia montado pela pauta: ${filled} itens em ${result.bands.length} faixas.`)
      })
      .catch((failure: Error) => onMessage(failure.message))
      .finally(() => setBusy(false))
  }

  const run = (preview: boolean): void => {
    let janela = minutes
    if (ate.trim() !== '') {
      const fim = parseHhmm(ate)
      const agora = new Date()
      const inicio = agora.getHours() * 60 + agora.getMinutes()
      if (fim === null || fim <= inicio) { onMessage('Informe um horário futuro para preencher até.'); return }
      janela = fim - inicio
    }
    setBusy(true)
    api
      .autoFill(rundownId, { minutes: janela, avoidHours, preview })
      .then((result) => {
        setPlan(result.plan)
        if (!preview && result.view) {
          onApplied(
            result as Snapshot,
            `${result.plan.items.length} itens montados no fim da grade.`,
          )
        }
      })
      .catch((failure: Error) => onMessage(failure.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Assistente inteligente de programação</h2>
          <div className="sub">o sistema pontua; o operador revisa e decide</div>
        </header>

        <div className="body">
          <div className="row">
            <div className="field">
              <label>Preencher (minutos)</label>
              <input
                type="number"
                min="1"
                max="720"
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label>Não repetir nas últimas (horas)</label>
              <input
                type="number"
                min="0"
                max="240"
                value={avoidHours}
                onChange={(event) => setAvoidHours(Number(event.target.value))}
              />
            </div>
          </div>

          <div className="note">
            A escolha pesa três coisas: o encaixe no tempo que falta, há quanto tempo o arquivo
            não vai ao ar, e o que você costuma inserir ou tirar. Nada é sorteado — a grade
            precisa poder explicar por que cada item entrou.
          </div>

          {plan && (
            <>
              <div className={`note${plan.reason === 'OUT_OF_MATERIAL' ? ' warn' : ''}`}>
                {plan.reason === 'FILLED'
                  ? `Janela preenchida; sobraram ${dur(plan.leftover, rate)}.`
                  : `O acervo acabou antes: faltaram ${dur(plan.leftover, rate)} para fechar a janela.`}
              </div>
              <ul className="cues">
                {plan.items.map((item, index) => (
                  <li key={`${item.mediaId}-${index}`}>
                    <b>{dur(item.durationFrames, rate)}</b>
                    <span>{item.title}</span>
                    <i>{item.explanation?.category ?? 'sem categoria'} · {item.explanation?.lastAiredAt ? `último ar ${new Date(item.explanation.lastAiredAt).toLocaleString()}` : 'nunca foi ao ar'} · preferência {item.explanation?.preference ?? 0}</i>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="field">
            <label>Pauta do dia</label>
            {rules?.length === 0 && (
              <div className="note">
                Sem faixas. Uma faixa diz o que entra em cada hora do dia — é a diferença entre
                montar trinta minutos e montar o dia.
              </div>
            )}
            {rules && rules.length > 0 && (
              <ul className="cues">
                {rules.map((rule) => (
                  <li key={rule.id}>
                    <b>
                      {hhmm(rule.startMinute)}–{hhmm(rule.endMinute)}
                    </b>
                    <span>{rule.name}</span>
                    <i>
                      {rule.categories.length === 0 ? 'qualquer categoria' : rule.categories.join(', ')}
                      {' · '}
                      {[...rule.weekdays].map((day) => WEEKDAYS[Number(day)]).join(' ')}
                    </i>
                    <button className="btn small" onClick={() => editRule(rule)}>editar</button>
                    <button className="btn small" onClick={() => removeRule(rule.id)}>tirar</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="row">
            <div className="field">
              <label>Nome da faixa</label>
              <input
                type="text"
                placeholder="Manhã"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="field">
              <label>Das</label>
              <input
                type="text"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
            </div>
            <div className="field">
              <label>Até</label>
              <input
                type="text"
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            </div>
          </div>

          {categories.length > 0 && (
            <div className="field">
              <label>Categorias da faixa</label>
              <div className="seg-group wrap">
                {categories.map((category) => (
                  <button
                    key={category}
                    className={draft.categories.includes(category) ? 'on' : ''}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        categories: draft.categories.includes(category)
                          ? draft.categories.filter((entry) => entry !== category)
                          : [...draft.categories, category],
                      })
                    }
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label>Ou preencher até (horário)</label>
            <input type="text" placeholder="ex.: 18:00" value={ate} onChange={(event) => setAte(event.target.value)} />
            <div className="note">Útil para evento ao vivo: informe o horário de término e o sistema calcula o espaço restante.</div>
          </div>
          {editingId && (
            <div className="field">
              <label>Editando faixa</label>
              <div className="row">
                <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                <input value={editing.from} onChange={(event) => setEditing({ ...editing, from: event.target.value })} />
                <input value={editing.to} onChange={(event) => setEditing({ ...editing, to: event.target.value })} />
                <input type="number" min="0" max="240" title="não repetir nas últimas horas" value={editing.avoidHours} onChange={(event) => setEditing({ ...editing, avoidHours: Number(event.target.value) })} />
              </div>
              <div className="seg-group wrap">
                {WEEKDAYS.map((day, index) => <button key={day} className={editing.weekdays.includes(String(index)) ? 'on' : ''} onClick={() => setEditing({ ...editing, weekdays: editing.weekdays.includes(String(index)) ? editing.weekdays.replace(String(index), '') : `${editing.weekdays}${index}` })}>{day}</button>)}
              </div>
              {categories.length > 0 && <div className="seg-group wrap">
                {categories.map((category) => <button key={category} className={editing.categories.includes(category) ? 'on' : ''} onClick={() => setEditing({ ...editing, categories: editing.categories.includes(category) ? editing.categories.filter((entry) => entry !== category) : [...editing.categories, category] })}>{category}</button>)}
              </div>}
            </div>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button className="btn" onClick={addRule}>
            guardar faixa
          </button>
          {editingId && <button className="btn take" onClick={saveRule}>salvar edição</button>}
          <button className="btn" disabled={busy || !rules?.length} onClick={fillDay}>
            montar o dia
          </button>
          <button className="btn" disabled={busy} onClick={() => run(true)}>
            propor
          </button>
          <button className="btn take" disabled={busy || plan === null} onClick={() => run(false)}>
            aplicar na grade
          </button>
        </footer>
      </div>
    </div>
  )
}

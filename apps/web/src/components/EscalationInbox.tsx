import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { beep, enableAlarmSound } from '../domain/alarm-sound.js'
import { browserSeenStorage, markSeen, readSeen, seenKey } from '../domain/notification-seen.js'
import { useNotifications } from '../domain/use-notifications.js'
import { useCan } from '../domain/permissions.js'

const stateName: Record<string, string> = { black: 'BLACK', freeze: 'CONGELAMENTO', silence: 'SILÊNCIO' }
const tierName = { OPERATOR: 'Operador', SUPERVISOR: 'Supervisor', GESTOR: 'Gestor', ADMIN: 'Administrador' } as const

/** Faixa discreta "Pendências": quedas de sinal do PGM ainda sem ciente, por nível.
 * "Visto" só silencia o som nesta estação; "Ciente" grava no servidor. */
export function EscalationInbox() {
  const canAcknowledge = useCan('CHANNEL_STOP')
  const { notifications, refresh } = useNotifications()
  const [seen, setSeen] = useState(() => readSeen(browserSeenStorage()))
  const [soundOn, setSoundOn] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const unseen = useMemo(() => notifications.filter(n => !seen.has(seenKey(n))), [notifications, seen])
  const unseenKeys = unseen.map(seenKey).join(',')

  useEffect(() => {
    if (!soundOn || !unseenKeys) return
    const ring = () => { beep(880, 200); window.setTimeout(() => beep(660, 200), 260) }
    ring()
    const timer = window.setInterval(ring, 5_000)
    return () => window.clearInterval(timer)
  }, [soundOn, unseenKeys])

  if (!notifications.length) return null
  const toggleSound = () => { if (soundOn) setSoundOn(false); else if (enableAlarmSound()) { setSoundOn(true); beep(660, 80) } }
  const acknowledge = async (id: string) => {
    try { await api.acknowledgeHealth(id); setFailure(null); refresh() }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Não foi possível registrar o ciente.') }
  }
  return (
    <aside role="region" aria-label="Pendências" className="fixed top-2 left-1/2 z-[65] max-w-[min(720px,calc(100vw-16px))] -translate-x-1/2 rounded border border-armed-amber bg-surface-panel px-3 py-1.5 text-[12px] shadow-lg select-none">
      <div className="flex items-center gap-2">
        <b className="text-armed-amber">Pendências</b>
        {!soundOn && <span className="text-armed-amber" title="Sem som nesta estação">SOM DESLIGADO</span>}
        <button type="button" className="btn small ml-auto" aria-pressed={soundOn} onClick={toggleSound}>{soundOn ? 'Desligar som' : 'Ligar som'}</button>
      </div>
      <ul className="mt-1 space-y-1">
        {notifications.map(n => {
          const isSeen = seen.has(seenKey(n))
          return (
            <li key={seenKey(n)} className="flex flex-wrap items-center gap-2">
              <span>PGM {stateName[n.state] ?? n.state} há {n.minutesOpen} min</span>
              <span className="text-on-surface-variant">nível: {tierName[n.tier]}{n.forMe ? ' (para você)' : ''}</span>
              {!isSeen && <button type="button" className="btn small" onClick={() => setSeen(markSeen(browserSeenStorage(), seenKey(n)))}>Visto</button>}
              {canAcknowledge && <button type="button" className="btn small primary" onClick={() => void acknowledge(n.id)}>Ciente</button>}
            </li>
          )
        })}
      </ul>
      {failure && <p role="alert" className="mt-1 text-armed-amber">{failure}</p>}
    </aside>
  )
}

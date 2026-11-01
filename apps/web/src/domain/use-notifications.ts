import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useTopicRefresh } from './live-topics.js'

export type OpenNotification = Awaited<ReturnType<typeof api.notifications>>['notifications'][number]

/** Pendências abertas do PGM. Relidas quando o servidor avisa que os
 * alertas mudaram (tópico `health`, também com a aba oculta: é o alarme
 * sonoro) e, por segurança, a cada minuto com a aba visível. O nível de
 * escalonamento depende do tempo em aberto, que o minuto cobre. Falha ou
 * 401/403 só deixam a lista como estava. Nunca bloqueia comando algum. */
export function useNotifications(enabled = true, intervalMs = 60_000): { notifications: OpenNotification[]; refresh: () => void } {
  const [notifications, setNotifications] = useState<OpenNotification[]>([])
  const [tick, setTick] = useState(0)
  const reader = useRef<() => void>(() => undefined)
  useEffect(() => {
    if (!enabled) { setNotifications([]); return }
    let alive = true
    const controller = new AbortController()
    const read = async () => {
      try {
        const result = await api.notifications(controller.signal)
        if (alive) setNotifications(result.notifications)
      } catch { /* indisponível: mantém a última leitura */ }
    }
    reader.current = () => void read()
    void read()
    return () => { alive = false; controller.abort(); reader.current = () => undefined }
  }, [enabled, tick])
  useTopicRefresh('health', null, () => reader.current(), { fallbackMs: intervalMs, degradedMs: 10_000, whileHidden: true, enabled })
  return { notifications, refresh: () => setTick(n => n + 1) }
}

import { useEffect, useState } from 'react'
import { api } from '../api.js'

export type OpenNotification = Awaited<ReturnType<typeof api.notifications>>['notifications'][number]

/** Pendências abertas do PGM. Leitura leve a cada 10 s; falha ou 401/403 só
 * deixam a lista como estava. Nunca bloqueia comando algum. */
export function useNotifications(enabled = true, intervalMs = 10_000): { notifications: OpenNotification[]; refresh: () => void } {
  const [notifications, setNotifications] = useState<OpenNotification[]>([])
  const [tick, setTick] = useState(0)
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
    void read()
    const timer = window.setInterval(() => { if (!document.hidden) void read() }, intervalMs)
    return () => { alive = false; controller.abort(); window.clearInterval(timer) }
  }, [enabled, intervalMs, tick])
  return { notifications, refresh: () => setTick(n => n + 1) }
}

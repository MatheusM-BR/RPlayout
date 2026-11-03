import { expect, it, vi } from 'vitest'
import { MonitorWatch, WATCH_BEAT_MS, WATCH_TTL_MS } from './monitor-watch.js'

function harness() {
  let now = 0, hidden = false
  const intervals = new Map<number, { fn: () => void; ms: number; next: number }>()
  const timeouts: Array<{ fn: () => void; at: number }> = []
  let id = 0
  const sent: Array<{ channelId: string; monitors: unknown[]; at: number }> = []
  const watch = new MonitorWatch(async (channelId, monitors) => { sent.push({ channelId, monitors, at: now }) }, () => hidden, () => now, {
    setInterval: (fn, ms) => { intervals.set(++id, { fn, ms, next: now + ms }); return id },
    clearInterval: key => { intervals.delete(key) },
    setTimeout: (fn, ms) => { timeouts.push({ fn, at: now + ms }); return ++id },
  })
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = [...timeouts.map(t => t.at), ...[...intervals.values()].map(i => i.next)].filter(at => at <= end)
      if (!due.length) break
      now = Math.min(...due)
      for (const timeout of timeouts.filter(t => t.at <= now)) { timeouts.splice(timeouts.indexOf(timeout), 1); timeout.fn() }
      for (const interval of [...intervals.values()]) if (interval.next <= now) { interval.next += interval.ms; interval.fn() }
    }
    now = end
  }
  return { watch, sent, advance, setHidden: (value: boolean) => { hidden = value } }
}

it('um POST por canal e por batida para todos os monitores da aba', () => {
  const { watch, sent, advance } = harness()
  // PGM, PVW e multiview batendo a cada 5 s cada um (como o Whep faz).
  const beat = () => { watch.touch('ch', 'mon', 'std'); watch.touch('ch', 'pvw', 'lite'); watch.touch('ch', 'mv') }
  beat()
  advance(50)
  expect(sent).toHaveLength(1)
  expect(sent[0]!.monitors).toEqual([{ bus: 'mon', tier: 'std' }, { bus: 'pvw', tier: 'lite' }, { bus: 'mv' }])
  for (let t = 0; t < 60_000; t += 5000) { advance(5000); beat() }
  // 60 s: antes 3 monitores x 12 batidas = 36 POSTs; agora ~1 a cada 7 s.
  expect(sent.length).toBeLessThanOrEqual(1 + Math.ceil(60_000 / WATCH_BEAT_MS))
  expect(sent.every(row => row.channelId === 'ch')).toBe(true)
})

it('aba oculta não avisa (o servidor solta o monitor); ao voltar, avisa na hora', () => {
  const { watch, sent, advance, setHidden } = harness()
  watch.touch('ch', 'mon'); advance(50)
  const before = sent.length
  setHidden(true)
  for (let t = 0; t < 30_000; t += 5000) { advance(5000); watch.touch('ch', 'mon') }
  expect(sent.length).toBe(before)
  setHidden(false); watch.visible(); advance(50)
  expect(sent.length).toBe(before + 1)
})

it('monitor fechado sai do aviso: por release ou por prazo', () => {
  const { watch, sent, advance } = harness()
  watch.touch('ch', 'mon'); watch.touch('ch', 'pvw'); advance(50)
  watch.release('ch', 'pvw')
  advance(WATCH_BEAT_MS)
  expect(sent.at(-1)!.monitors).toEqual([{ bus: 'mon' }])
  advance(WATCH_TTL_MS + WATCH_BEAT_MS)
  const count = sent.length
  advance(WATCH_BEAT_MS * 3)
  expect(sent.length).toBe(count)
  expect(vi.isFakeTimers()).toBe(false)
})

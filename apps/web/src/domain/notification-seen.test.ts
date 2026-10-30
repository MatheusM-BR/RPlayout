import { expect, it } from 'vitest'
import { markSeen, readSeen, seenKey, type SeenStorage } from './notification-seen.js'

const fake = (): SeenStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }
}
it('grava e relê o visto por id+horário', () => {
  const s = fake(), a = seenKey({ id: 'x', occurredAt: '1' }), b = seenKey({ id: 'x', occurredAt: '2' })
  expect(readSeen(s).size).toBe(0)
  markSeen(s, a)
  expect(readSeen(s).has(a)).toBe(true)
  expect(readSeen(s).has(b)).toBe(false)
})
it('limita o histórico guardado, mantendo os mais recentes', () => {
  const s = fake()
  for (let i = 0; i < 250; i++) markSeen(s, 'k' + i)
  const seen = readSeen(s)
  expect(seen.size).toBe(200); expect(seen.has('k249')).toBe(true); expect(seen.has('k0')).toBe(false)
})
it('tolera storage ausente, quebrado ou conteúdo inválido', () => {
  expect(readSeen(null).size).toBe(0)
  const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
  expect(readSeen(bad).size).toBe(0)
  expect(markSeen(bad, 'k').has('k')).toBe(true)
  const junk = fake(); junk.setItem('rplayout.notifications.seen', '{oops'); expect(readSeen(junk).size).toBe(0)
  junk.setItem('rplayout.notifications.seen', '[1,"a"]'); expect([...readSeen(junk)]).toEqual(['a'])
})

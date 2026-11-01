import { expect, it } from 'vitest'
import { LiveTopics } from './live-topics.js'
import { HIDDEN_LIVE_INTERVAL_MS, LiveSocketPacing } from './live-socket-pacing.js'
import { shouldLogRequest } from './request-log.js'

it('tópico só sobe de revisão quando a assinatura muda; nada muda, nada sai', () => {
  const topics = new LiveTopics()
  let layers = { logo: false }, probe = { audioDbfs: -20 }
  const read = () => topics.sample('ch', { graphics: () => layers, interruptions: () => [] }, () => probe)
  const first = read()!
  expect(first.type).toBe('topics')
  expect(Object.keys(first.revs).sort()).toEqual(['graphics', 'interruptions'])
  expect(read()).toBeNull()
  layers = { logo: true }
  const second = read()!
  expect(second.revs.graphics).toBeGreaterThan(first.revs.graphics!)
  expect(second.revs.interruptions).toBe(first.revs.interruptions)
  // Leitura viva da sonda sai sem mexer nas revisões.
  probe = { audioDbfs: -30 }
  const third = read()!
  expect(third.revs).toEqual(second.revs)
  expect(third.probe).toEqual({ audioDbfs: -30 })
  expect(topics.message('ch')).toEqual(third)
})

it('assinatura que falha não derruba os outros tópicos; canal removido é esquecido', () => {
  const topics = new LiveTopics()
  const message = topics.sample('a', { bad: () => { throw new Error('x') }, ok: () => 1 })!
  expect(Object.keys(message.revs)).toEqual(['ok'])
  topics.sample(null, { scan: () => 1 })
  topics.sample('b', { ok: () => 1 })
  topics.retain(['b'])
  expect(topics.message('a')).toBeNull()
  expect(topics.message('b')).not.toBeNull()
  expect(topics.message(null)).not.toBeNull()
})

it('aba oculta recebe o estado ao vivo a 1 Hz; visível, a cada quadro', () => {
  const pacing = new LiveSocketPacing(), socket = {}
  expect([0, 50, 100].map(t => pacing.due(socket, 'ch', t))).toEqual([true, true, true])
  pacing.setHidden(socket, true)
  const sent = Array.from({ length: 60 }, (_, i) => pacing.due(socket, 'ch', 1000 + i * 50)).filter(Boolean).length
  expect(sent).toBe(Math.ceil(60 * 50 / HIDDEN_LIVE_INTERVAL_MS))
  // Cada canal tem a sua cadência.
  expect(pacing.due(socket, 'outro', 1010)).toBe(true)
  pacing.setHidden(socket, false)
  expect(pacing.due(socket, 'ch', 1001)).toBe(true)
})

it('log HTTP: comandos, erros e leituras lentas; leitura rotineira não', () => {
  expect(shouldLogRequest('GET', 200, 3)).toBe(false)
  expect(shouldLogRequest('GET', 304, 3)).toBe(false)
  expect(shouldLogRequest('GET', 404, 3)).toBe(true)
  expect(shouldLogRequest('GET', 200, 1500)).toBe(true)
  expect(shouldLogRequest('POST', 200, 3)).toBe(true)
})

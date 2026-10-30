import { expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../db/client.js'
import { healthEvents, integrationDeliveries, integrations } from '../db/schema.js'
import { AlertNotifier, alertText } from './alert-notifier.js'

it('envia crítico e aviso novos, lembra sem ciente e para quando há ciente', async () => {
  const db = openDatabase(':memory:')
  let clock = Date.parse('2026-10-27T22:00:00Z')
  db.db.insert(integrations).values({ id: 'tg', name: 'Telegram', url: 'https://api.telegram.org/botX/sendMessage?chat_id=1', events: ['alert.critical', 'alert.warning', 'alert.reminder'], enabled: true, createdAt: 'now' }).run()
  const notifier = new AlertNotifier(db.db, { now: () => clock, reminderMs: 120_000, maxReminders: 2 })
  const at = (offset: number) => new Date(clock + offset).toISOString()
  db.db.insert(healthEvents).values({ id: 'old', channelId: null, component: 'SIGNAL', state: 'silence', severity: 'CRITICAL', message: 'antigo', occurredAt: at(-60_000) }).run()
  db.db.insert(healthEvents).values({ id: 'c1', channelId: 'ch', component: 'SIGNAL', state: 'silence', severity: 'CRITICAL', message: 'Silêncio no PGM', occurredAt: at(1000) }).run()
  db.db.insert(healthEvents).values({ id: 'w1', channelId: 'ch', component: 'ENGINE', state: 'warning', severity: 'WARN', message: 'aviso', occurredAt: at(2000) }).run()
  db.db.insert(healthEvents).values({ id: 'i1', channelId: 'ch', component: 'INTEGRATION', state: 'retrying', severity: 'WARN', message: 'laço', occurredAt: at(3000) }).run()
  db.db.insert(healthEvents).values({ id: 'n1', channelId: 'ch', component: 'ENGINE', state: 'ok', severity: 'INFO', message: 'info', occurredAt: at(4000) }).run()
  expect(await notifier.tick()).toBe(2)
  const events = () => db.db.select().from(integrationDeliveries).all().map(row => row.event)
  expect(events().sort()).toEqual(['alert.critical', 'alert.warning'])
  clock += 60_000; expect(await notifier.tick()).toBe(0)
  clock += 61_000; expect(await notifier.tick()).toBe(2) // lembrete + escalada ao passar de 2 min
  expect(events().filter(event => event === 'alert.reminder')).toHaveLength(1)
  db.db.update(healthEvents).set({ acknowledgedAt: new Date(clock).toISOString() }).where(eq(healthEvents.id, 'c1')).run()
  clock += 200_000; expect(await notifier.tick()).toBe(0)
  db.sqlite.close()
})

it('texto do Telegram é curto e legível', () => {
  const text = alertText('alert.reminder', { id: 'x', payload: { component: 'SIGNAL', state: 'silence', message: 'Silêncio no PGM', minutesOpen: 4 } }, 'ab1023d0-8291')
  expect(text).toBe('⏰ RPlayout sem ciente há 4 min\nSIGNAL · silence\nSilêncio no PGM\ncanal ab1023d0')
})

function escalationFixture() {
  const db = openDatabase(':memory:')
  const state = { clock: Date.parse('2026-10-30T10:00:00Z') }
  db.db.insert(integrations).values({ id: 'tg', name: 'Telegram', url: 'https://api.telegram.org/botX/sendMessage?chat_id=1', events: ['alert.critical', 'alert.reminder', 'alert.escalated'], enabled: true, createdAt: 'now' }).run()
  const make = () => new AlertNotifier(db.db, { now: () => state.clock, reminderMs: 120_000, maxReminders: 1 })
  const escalated = () => db.db.select().from(integrationDeliveries).where(eq(integrationDeliveries.event, 'alert.escalated')).all().map(row => (row.payload as unknown as { payload: { tier: string; minutesOpen: number } }).payload)
  const insert = (id: string, occurredAt: number, extra: Partial<typeof healthEvents.$inferInsert> = {}) =>
    db.db.insert(healthEvents).values({ id, channelId: 'ch', component: 'SIGNAL', state: 'black', severity: 'CRITICAL', message: 'PGM black', occurredAt: new Date(occurredAt).toISOString(), ...extra }).run()
  return { db, state, make, escalated, insert }
}

it('escala uma vez por nível (SUPERVISOR 2 min, GESTOR 7, ADMIN 15), independente do teto de lembretes', async () => {
  const { db, state, make, escalated, insert } = escalationFixture()
  const notifier = make()
  insert('pgm-signal:a:active', state.clock + 1000)
  state.clock += 1000
  await notifier.tick()
  state.clock += 119_000; await notifier.tick()
  expect(escalated()).toEqual([])
  state.clock += 1000; await notifier.tick()
  expect(escalated().map(row => row.tier)).toEqual(['SUPERVISOR'])
  state.clock += 60_000; await notifier.tick(); await notifier.tick()
  expect(escalated()).toHaveLength(1)
  state.clock += 5 * 60_000 - 60_000 - 1000; await notifier.tick()
  expect(escalated()).toHaveLength(1)
  state.clock += 1000; await notifier.tick()
  expect(escalated().map(row => row.tier)).toEqual(['SUPERVISOR', 'GESTOR'])
  expect(escalated()[1]!.minutesOpen).toBe(7)
  state.clock += 7 * 60_000 + 59_000; await notifier.tick()
  expect(escalated()).toHaveLength(2)
  state.clock += 1000; await notifier.tick()
  expect(escalated().map(row => row.tier)).toEqual(['SUPERVISOR', 'GESTOR', 'ADMIN'])
  expect(escalated()[2]!.minutesOpen).toBe(15)
  state.clock += 600_000; await notifier.tick()
  expect(escalated()).toHaveLength(3)
  db.sqlite.close()
})

it('não escala depois de ciente nem de resolvido, nem incidentes que não são sinal do PGM', async () => {
  const { db, state, make, escalated, insert } = escalationFixture()
  const notifier = make()
  insert('pgm-signal:ack:active', state.clock + 1000)
  insert('pgm-signal:res:active', state.clock + 1000)
  insert('eng', state.clock + 1000, { component: 'ENGINE', state: 'FAILED' })
  state.clock += 1000; await notifier.tick()
  state.clock += 60_000
  db.db.update(healthEvents).set({ acknowledgedAt: new Date(state.clock).toISOString() }).where(eq(healthEvents.id, 'pgm-signal:ack:active')).run()
  db.db.update(healthEvents).set({ resolvedAt: new Date(state.clock).toISOString() }).where(eq(healthEvents.id, 'pgm-signal:res:active')).run()
  state.clock += 600_000; await notifier.tick()
  expect(escalated()).toEqual([])
  db.sqlite.close()
})

it('instância nova reconstrói do banco e não repete nível já enviado', async () => {
  const { db, state, make, escalated, insert } = escalationFixture()
  insert('pgm-signal:old:active', state.clock - 3 * 60_000)
  const first = make(); first.start(); await first.tick()
  expect(escalated()).toEqual([])
  state.clock += 5 * 60_000; await first.tick()
  expect(escalated().map(row => row.tier)).toEqual(['GESTOR'])
  first.close()
  const second = make(); second.start(); await second.tick(); await second.tick()
  expect(escalated()).toHaveLength(1)
  second.close()
  db.sqlite.close()
})

it('o texto do alerta diz "escalado para GESTOR"', () => {
  expect(alertText('alert.escalated', { id: 'x', payload: { component: 'SIGNAL', state: 'black', message: 'PGM black', tier: 'GESTOR', minutesOpen: 7 } }, 'ab1023d0-8291')).toContain('escalado para GESTOR · sem ciente há 7 min')
})

it('reaproveitar o id com novo occurredAt reinicia a escalada', async () => {
  const { db, state, make, escalated, insert } = escalationFixture()
  const notifier = make()
  insert('pgm-signal:x:active', state.clock + 1000)
  state.clock += 1000; await notifier.tick()
  state.clock += 130_000; await notifier.tick()
  expect(escalated()).toHaveLength(1)
  db.db.update(healthEvents).set({ resolvedAt: new Date(state.clock).toISOString() }).where(eq(healthEvents.id, 'pgm-signal:x:active')).run()
  await notifier.tick()
  db.db.update(healthEvents).set({ resolvedAt: null, occurredAt: new Date(state.clock + 1000).toISOString() }).where(eq(healthEvents.id, 'pgm-signal:x:active')).run()
  state.clock += 1000; await notifier.tick()
  state.clock += 125_000; await notifier.tick()
  expect(escalated()).toHaveLength(2)
  db.sqlite.close()
})

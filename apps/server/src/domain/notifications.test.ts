import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client.js'
import { healthEvents } from '../db/schema.js'
import { acknowledgeHealthIncident } from './health-incidents.js'
import { readOpenNotifications } from './notifications.js'
import { can, type Role } from './permissions.js'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60_000 - 500).toISOString()
function fixture() {
  const db = openDatabase(':memory:')
  const insert = (id: string, minutes: number) => db.db.insert(healthEvents).values({ id, channelId: 'ch', component: 'SIGNAL', state: 'black', severity: 'CRITICAL', message: 'PGM black', occurredAt: minutesAgo(minutes) }).run()
  const read = (role: Parameters<typeof readOpenNotifications>[3]) => readOpenNotifications(db.db, null, undefined, role, NOW)
  return { db, insert, read }
}

describe('caixa de notificações com o nível GESTOR', () => {
  it('tier por tempo: OPERATOR <2, SUPERVISOR 2-<7, GESTOR 7-<15, ADMIN >=15', () => {
    const { db, insert, read } = fixture()
    insert('a', 1); insert('b', 3); insert('c', 8); insert('d', 20)
    expect(read('ADMIN').map(n => [n.id, n.tier]).sort()).toEqual([['a', 'OPERATOR'], ['b', 'SUPERVISOR'], ['c', 'GESTOR'], ['d', 'ADMIN']])
    db.sqlite.close()
  })

  it('forMe por papel', () => {
    const { db, insert, read } = fixture()
    insert('a', 1); insert('b', 3); insert('c', 8); insert('d', 20)
    const forMe = (role: Parameters<typeof read>[0]) => read(role).filter(n => n.forMe).map(n => n.id).sort()
    expect(forMe('OPERATOR')).toEqual(['a'])
    expect(forMe('SUPERVISOR')).toEqual(['a', 'b'])
    expect(forMe('GESTOR')).toEqual(['a', 'b', 'c'])
    expect(forMe('ADMIN')).toEqual(['a', 'b', 'c', 'd'])
    expect(forMe('DENIED')).toEqual([])
    db.sqlite.close()
  })

  it.each(['SUPERVISOR', 'GESTOR', 'ADMIN'] as Role[])('ciente de %s encerra o escalonamento (sai da lista)', role => {
    const { db, insert, read } = fixture()
    insert('x', 9)
    expect(read(role).map(n => n.tier)).toEqual(['GESTOR'])
    acknowledgeHealthIncident(db.db, 'x', () => ({ actor: role.toLowerCase(), channelIds: null, canAcknowledge: can(role, 'CHANNEL_STOP') }))
    expect(read(role)).toEqual([])
    expect(read('ADMIN')).toEqual([])
    db.sqlite.close()
  })

  it.each(['OPERATOR', 'PROGRAMMER'] as Role[])('%s não dá ciente', role => {
    const { db, insert, read } = fixture()
    insert('x', 9)
    expect(() => acknowledgeHealthIncident(db.db, 'x', () => ({ actor: 'u', channelIds: null, canAcknowledge: can(role, 'CHANNEL_STOP') }))).toThrow()
    expect(read('GESTOR')).toHaveLength(1)
    db.sqlite.close()
  })
})

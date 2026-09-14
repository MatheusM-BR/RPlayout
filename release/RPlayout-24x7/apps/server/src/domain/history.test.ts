import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import type { Trim } from '@rplayout/protocol'
import { openDatabase, type Db } from '../db/client.js'
import { channels, mediaAssets, rundownItems, rundowns } from '../db/schema.js'
import { History } from './history.js'
import { applyTrim, targetItemIds } from './scopes.js'

const now = new Date().toISOString()

let db: Db
let history: History
let assetId: string
let gradeA: string
let gradeB: string
let a1: string
let a2: string
let b1: string

async function addItem(rundownId: string, title: string, order: number): Promise<string> {
  const id = randomUUID()
  await db.insert(rundownItems).values({
    id,
    rundownId,
    sortOrder: order,
    type: 'VT',
    title,
    mediaId: assetId,
    sourceRef: null,
    trim: null,
    audio: null,
    durationOverride: null,
    minDuration: 0,
    anchor: { kind: 'FLOW' },
    onOverrun: 'PUSH',
    elastic: null,
    blockId: null,
    locked: false,
    autoNext: true,
    loop: false,
    notes: null,
  })
  return id
}

const titlesOf = async (rundownId: string): Promise<string[]> =>
  (
    await db
      .select()
      .from(rundownItems)
      .where(eq(rundownItems.rundownId, rundownId))
      .orderBy(asc(rundownItems.sortOrder))
  ).map((row) => row.title)

const trimOf = async (id: string): Promise<Trim | null> => {
  const [row] = await db.select().from(rundownItems).where(eq(rundownItems.id, id))
  return row?.trim ?? null
}

beforeEach(async () => {
  db = openDatabase(':memory:').db
  history = new History()

  const channelId = randomUUID()
  await db.insert(channels).values({
    id: channelId,
    name: 'Canal',
    rateNum: 50,
    rateDen: 1,
    width: 1920,
    height: 1080,
    targetLufs: -23,
    ceilingDbtp: -1,
    limiterLookaheadMs: 5,
    programSdiDeviceId: null,
    createdAt: now,
  })

  assetId = randomUUID()
  await db.insert(mediaAssets).values({
    id: assetId,
    contentHash: assetId,
    path: 'D:/Media/Reportagens/vt.mxf',
    title: 'VT',
    kind: 'VIDEO',
    durationFrames: 10_000,
    categoryId: null,
    defaultTrim: null,
    defaultAudio: null,
    loudnessFile: null,
    suggestedTrim: null,
    createdAt: now,
  })

  gradeA = randomUUID()
  gradeB = randomUUID()
  for (const [id, name] of [
    [gradeA, 'Grade A'],
    [gradeB, 'Grade B'],
  ] as const) {
    await db.insert(rundowns).values({
      id,
      channelId,
      name,
      plannedStart: 0,
      loop: true,
      date: '2026-08-31',
      createdAt: now,
      updatedAt: now,
    })
  }

  a1 = await addItem(gradeA, 'primeiro', 10)
  a2 = await addItem(gradeA, 'segundo', 20)
  b1 = await addItem(gradeB, 'outra grade', 10)
})

const trim: Trim = { in: 100, out: 5000 }

describe('desfazer', () => {
  it('devolve o corte de todos os itens que a edição pegou', async () => {
    const targets = await targetItemIds(db, a1, 'RUNDOWN')
    await history.capture(db, gradeA, 'marcar entrada e saída', { itemIds: targets.ids })
    await applyTrim(db, a1, trim, 'RUNDOWN')

    expect(await trimOf(a1)).toEqual(trim)
    expect(await trimOf(a2)).toEqual(trim)

    expect(await history.undo(db, gradeA)).toBe('marcar entrada e saída')
    expect(await trimOf(a1)).toBeNull()
    expect(await trimOf(a2)).toBeNull()
  })

  it('alcança itens de outra grade quando o escopo saiu desta', async () => {
    const targets = await targetItemIds(db, a1, 'ALL_RUNDOWNS')
    await history.capture(db, gradeA, 'marcar entrada e saída', { itemIds: targets.ids })
    await applyTrim(db, a1, trim, 'ALL_RUNDOWNS')
    expect(await trimOf(b1)).toEqual(trim)

    await history.undo(db, gradeA)
    // O escopo largo é justamente o que mais precisa de volta.
    expect(await trimOf(b1)).toBeNull()
  })

  it('devolve o padrão do acervo junto com o item', async () => {
    await history.capture(db, gradeA, 'marcar entrada e saída', {
      itemIds: [a1],
      assetIds: [assetId],
    })
    await applyTrim(db, a1, trim, 'ASSET_DEFAULT')

    const [changed] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId))
    expect(changed?.defaultTrim).toEqual(trim)

    await history.undo(db, gradeA)
    const [restored] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId))
    expect(restored?.defaultTrim).toBeNull()
  })

  it('devolve item removido e a ordem em que ele estava', async () => {
    await history.capture(db, gradeA, 'remover item', { wholeRundown: true })
    await db.delete(rundownItems).where(eq(rundownItems.id, a1))
    expect(await titlesOf(gradeA)).toEqual(['segundo'])

    await history.undo(db, gradeA)
    expect(await titlesOf(gradeA)).toEqual(['primeiro', 'segundo'])
  })

  it('devolve a ordem depois de mover', async () => {
    await history.capture(db, gradeA, 'mover item', { wholeRundown: true })
    await db.update(rundownItems).set({ sortOrder: 30 }).where(eq(rundownItems.id, a1))
    expect(await titlesOf(gradeA)).toEqual(['segundo', 'primeiro'])

    await history.undo(db, gradeA)
    expect(await titlesOf(gradeA)).toEqual(['primeiro', 'segundo'])
  })
})

describe('refazer', () => {
  it('repete o passo desfeito', async () => {
    await history.capture(db, gradeA, 'marcar entrada e saída', { itemIds: [a1] })
    await applyTrim(db, a1, trim, 'ITEM')

    await history.undo(db, gradeA)
    expect(await trimOf(a1)).toBeNull()

    expect(await history.redo(db, gradeA)).toBe('marcar entrada e saída')
    expect(await trimOf(a1)).toEqual(trim)
  })

  it('uma alteração nova descarta o refazer pendente', async () => {
    await history.capture(db, gradeA, 'primeira', { itemIds: [a1] })
    await applyTrim(db, a1, trim, 'ITEM')
    await history.undo(db, gradeA)
    expect(history.state(gradeA).canRedo).toBe(true)

    await history.capture(db, gradeA, 'segunda', { itemIds: [a2] })
    expect(history.state(gradeA).canRedo).toBe(false)
    expect(history.state(gradeA).undoLabel).toBe('segunda')
  })

  it('sem histórico não inventa passo', async () => {
    expect(await history.undo(db, gradeA)).toBeNull()
    expect(await history.redo(db, gradeA)).toBeNull()
    expect(history.state(gradeA)).toMatchObject({ canUndo: false, canRedo: false })
  })
})

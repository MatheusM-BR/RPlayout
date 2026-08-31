import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { AudioLevel, Trim } from '@rplayout/protocol'
import { openDatabase, type Db } from '../db/client.js'
import { mediaAssets, rundownItems, rundowns, channels } from '../db/schema.js'
import { applyAudio, applyTrim } from './scopes.js'

const now = new Date().toISOString()

let db: Db
let assetId: string
let otherAssetId: string
let rundownA: string
let rundownB: string
/** Dois itens do mesmo arquivo na grade A, um na grade B. */
let itemA1: string
let itemA2: string
let itemB1: string
let itemOutro: string

async function addItem(rundownId: string, mediaId: string): Promise<string> {
  const id = randomUUID()
  await db.insert(rundownItems).values({
    id,
    rundownId,
    sortOrder: 10,
    type: 'VT',
    title: 'VT',
    mediaId,
    sourceRef: null,
    trim: null,
    audio: null,
    durationOverride: null,
    minDuration: 0,
    anchor: { kind: 'FLOW' },
    onOverrun: 'PUSH',
    elastic: null,
    locked: false,
    autoNext: true,
    loop: false,
    notes: null,
  })
  return id
}

beforeEach(async () => {
  db = openDatabase(':memory:').db

  const channelId = randomUUID()
  await db.insert(channels).values({
    id: channelId,
    name: 'Canal de teste',
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
  otherAssetId = randomUUID()
  for (const [id, title] of [
    [assetId, 'Reportagem'],
    [otherAssetId, 'Outro arquivo'],
  ] as const) {
    await db.insert(mediaAssets).values({
      id,
      contentHash: id,
      path: `D:/media/${title}.mxf`,
      title,
      kind: 'VIDEO',
      durationFrames: 10_000,
      categoryId: null,
      defaultTrim: null,
      defaultAudio: null,
      loudnessFile: null,
      suggestedTrim: null,
      createdAt: now,
    })
  }

  rundownA = randomUUID()
  rundownB = randomUUID()
  for (const [id, name] of [
    [rundownA, 'Grade A'],
    [rundownB, 'Grade B'],
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

  itemA1 = await addItem(rundownA, assetId)
  itemA2 = await addItem(rundownA, assetId)
  itemB1 = await addItem(rundownB, assetId)
  itemOutro = await addItem(rundownA, otherAssetId)
})

const trimOf = async (id: string): Promise<Trim | null> => {
  const [row] = await db.select().from(rundownItems).where(eq(rundownItems.id, id))
  return row?.trim ?? null
}

const audioOf = async (id: string): Promise<AudioLevel | null> => {
  const [row] = await db.select().from(rundownItems).where(eq(rundownItems.id, id))
  return row?.audio ?? null
}

const trim: Trim = { in: 100, out: 5000 }
const audio: AudioLevel = { mode: 'MANUAL', gainDb: -3.5, measured: null }

describe('escopo do corte', () => {
  it('ITEM não encosta em mais ninguém', async () => {
    const result = await applyTrim(db, itemA1, trim, 'ITEM')
    expect(result.itemsAffected).toBe(1)
    expect(await trimOf(itemA1)).toEqual(trim)
    expect(await trimOf(itemA2)).toBeNull()
    expect(await trimOf(itemB1)).toBeNull()
  })

  it('RUNDOWN pega os do mesmo arquivo só nesta grade', async () => {
    const result = await applyTrim(db, itemA1, trim, 'RUNDOWN')
    expect(result.itemsAffected).toBe(2)
    expect(await trimOf(itemA2)).toEqual(trim)
    // Grade B usa o mesmo arquivo, mas não foi pedido.
    expect(await trimOf(itemB1)).toBeNull()
    // Arquivo diferente na mesma grade também fica de fora.
    expect(await trimOf(itemOutro)).toBeNull()
  })

  it('ALL_RUNDOWNS atravessa as grades', async () => {
    const result = await applyTrim(db, itemA1, trim, 'ALL_RUNDOWNS')
    expect(result.itemsAffected).toBe(3)
    expect(await trimOf(itemB1)).toEqual(trim)
    expect(await trimOf(itemOutro)).toBeNull()
  })

  it('ASSET_DEFAULT grava no acervo e faz o item voltar a herdar', async () => {
    const result = await applyTrim(db, itemA1, trim, 'ASSET_DEFAULT')
    expect(result.assetUpdated).toBe(true)

    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId))
    expect(asset?.defaultTrim).toEqual(trim)
    // Sem override, a linha mostra o selo de herdado em vez de "só neste item".
    expect(await trimOf(itemA1)).toBeNull()
  })

  it('recusa gravar padrão de acervo em item sem arquivo', async () => {
    const id = randomUUID()
    await db.insert(rundownItems).values({
      id,
      rundownId: rundownA,
      sortOrder: 99,
      type: 'LIVE',
      title: 'Estúdio',
      mediaId: null,
      sourceRef: 'sdi:0',
      trim: null,
      audio: null,
      durationOverride: 5000,
      minDuration: 0,
      anchor: { kind: 'FLOW' },
      onOverrun: 'PUSH',
      elastic: null,
      locked: false,
      autoNext: true,
      loop: false,
      notes: null,
    })
    await expect(applyTrim(db, id, trim, 'ASSET_DEFAULT')).rejects.toThrow('acervo')
  })
})

describe('escopo do nivelamento', () => {
  it('segue exatamente a mesma mecânica do corte', async () => {
    const result = await applyAudio(db, itemA1, audio, 'RUNDOWN')
    expect(result.itemsAffected).toBe(2)
    expect(await audioOf(itemA2)).toEqual(audio)
    expect(await audioOf(itemB1)).toBeNull()
  })

  it('ASSET_DEFAULT grava no acervo e limpa o override', async () => {
    await applyAudio(db, itemA1, audio, 'ASSET_DEFAULT')
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId))
    expect(asset?.defaultAudio).toEqual(audio)
    expect(await audioOf(itemA1)).toBeNull()
  })
})

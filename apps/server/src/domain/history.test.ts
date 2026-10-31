import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import type { Trim } from '@rplayout/protocol'
import { openDatabase, type Db } from '../db/client.js'
import { channels, mediaAssets, rundownItems, rundowns,secondaryEvents } from '../db/schema.js'
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
    await applyTrim(db, a1, trim, 'RUNDOWN',tx=>history.prepareCapture(tx,gradeA,'marcar entrada e saída',{itemIds:targets.ids}))

    expect(await trimOf(a1)).toEqual(trim)
    expect(await trimOf(a2)).toEqual(trim)

    expect(await history.undo(db, gradeA)).toBe('marcar entrada e saída')
    expect(await trimOf(a1)).toBeNull()
    expect(await trimOf(a2)).toBeNull()
  })

  it('alcança itens de outra grade quando o escopo saiu desta', async () => {
    const targets = await targetItemIds(db, a1, 'ALL_RUNDOWNS')
    await applyTrim(db, a1, trim, 'ALL_RUNDOWNS',tx=>history.prepareCapture(tx,gradeA,'marcar entrada e saída',{itemIds:targets.ids}))
    expect(await trimOf(b1)).toEqual(trim)

    await history.undo(db, gradeA)
    // O escopo largo é justamente o que mais precisa de volta.
    expect(await trimOf(b1)).toBeNull()
  })

  it('devolve o padrão do acervo junto com o item', async () => {
    await applyTrim(db,a1,trim,'ASSET_DEFAULT',tx=>history.prepareCapture(tx,gradeA,'marcar entrada e saída',{
      itemIds: [a1],
      assetIds: [assetId],
    }))

    const [changed] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId))
    expect(changed?.defaultTrim).toEqual(trim)
    expect(changed?.defaultTrimRateNum).toBe(50)
    expect(changed?.defaultTrimRateDen).toBe(1)

    await history.undo(db, gradeA)
    const [restored] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId))
    expect(restored?.defaultTrim).toBeNull()
    expect(restored?.defaultTrimRateNum).toBeNull()
    expect(restored?.defaultTrimRateDen).toBeNull()
    await history.redo(db,gradeA)
    expect(db.select().from(mediaAssets).where(eq(mediaAssets.id,assetId)).get()).toMatchObject({defaultTrim:trim,defaultTrimRateNum:50,defaultTrimRateDen:1})
  })

  it('devolve item removido e a ordem em que ele estava', async () => {
    history.edit(db,gradeA,'remover item',{wholeRundown:true},tx=>tx.delete(rundownItems).where(eq(rundownItems.id,a1)).run())
    expect(await titlesOf(gradeA)).toEqual(['segundo'])

    await history.undo(db, gradeA)
    expect(await titlesOf(gradeA)).toEqual(['primeiro', 'segundo'])
  })

  it('devolve a ordem depois de mover', async () => {
    history.edit(db,gradeA,'mover item',{wholeRundown:true},tx=>tx.update(rundownItems).set({sortOrder:30}).where(eq(rundownItems.id,a1)).run())
    expect(await titlesOf(gradeA)).toEqual(['segundo', 'primeiro'])

    await history.undo(db, gradeA)
    expect(await titlesOf(gradeA)).toEqual(['primeiro', 'segundo'])
  })
})

describe('refazer', () => {
  it('repete o passo desfeito', async () => {
    await applyTrim(db,a1,trim,'ITEM',tx=>history.prepareCapture(tx,gradeA,'marcar entrada e saída',{itemIds:[a1]}))

    await history.undo(db, gradeA)
    expect(await trimOf(a1)).toBeNull()

    expect(await history.redo(db, gradeA)).toBe('marcar entrada e saída')
    expect(await trimOf(a1)).toEqual(trim)
  })

  it('uma alteração nova descarta o refazer pendente', async () => {
    await applyTrim(db,a1,trim,'ITEM',tx=>history.prepareCapture(tx,gradeA,'primeira',{itemIds:[a1]}))
    await history.undo(db, gradeA)
    expect(history.state(gradeA).canRedo).toBe(true)

    history.edit(db,gradeA,'segunda',{itemIds:[a2]},()=>undefined)
    expect(history.state(gradeA).canRedo).toBe(false)
    expect(history.state(gradeA).undoLabel).toBe('segunda')
  })

  it('sem histórico não inventa passo', async () => {
    expect(await history.undo(db, gradeA)).toBeNull()
    expect(await history.redo(db, gradeA)).toBeNull()
    expect(history.state(gradeA)).toMatchObject({ canUndo: false, canRedo: false })
  })
})

describe('histórico selado e protegido contra alterações posteriores',()=>{
  const cut=()=>applyTrim(db,a1,trim,'ITEM',tx=>history.prepareCapture(tx,gradeA,'corte',{itemIds:[a1]}))
  it('não registra captura que não foi selada após a escrita',()=>{
    const remember=history.prepareCapture(db,gradeA,'incompleta',{itemIds:[a1]})
    remember()
    expect(history.state(gradeA).canUndo).toBe(false)
  })
  it('falha durante restauração reverte linhas e contadores, conservando o passo para nova revisão',async()=>{
    history.edit(db,gradeA,'alterar ordem',{wholeRundown:true},tx=>tx.update(rundownItems).set({sortOrder:30}).where(eq(rundownItems.id,a1)).run())
    const before=db.select().from(rundownItems).all(),versions=db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all(),pending=history.state(gradeA)
    db.$client.exec(`CREATE TRIGGER fail_restore BEFORE INSERT ON rundown_items WHEN NEW.id='${a2}' BEGIN SELECT RAISE(ABORT,'restauração interrompida'); END`)
    await expect(history.undo(db,gradeA)).rejects.toThrow('restauração interrompida')
    expect(db.select().from(rundownItems).all()).toEqual(before)
    expect(db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()).toEqual(versions)
    expect(history.state(gradeA)).toEqual(pending)
    db.$client.exec('DROP TRIGGER fail_restore')
    await history.undo(db,gradeA)
    expect(await titlesOf(gradeA)).toEqual(['primeiro','segundo'])
  })
  it('falha no meio da edição reverte dados e contadores sem passo fictício',()=>{
    const before=db.select().from(rundownItems).all(),versions=db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()
    expect(()=>history.edit(db,gradeA,'falhou',{wholeRundown:true},tx=>{
      tx.update(rundownItems).set({title:'Não gravado'}).where(eq(rundownItems.id,a1)).run()
      throw new Error('falha deliberada')
    })).toThrow('falha deliberada')
    expect(db.select().from(rundownItems).all()).toEqual(before)
    expect(db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()).toEqual(versions)
    expect(history.state(gradeA).canUndo).toBe(false)
  })
  it('desfazer não sobrescreve edição posterior da mesma linha',async()=>{
    await cut()
    db.update(rundownItems).set({notes:'Outra estação'}).where(eq(rundownItems.id,a1)).run()
    const before=db.select().from(rundownItems).all()
    await expect(history.undo(db,gradeA)).rejects.toThrow('alterados depois')
    expect(db.select().from(rundownItems).all()).toEqual(before)
    expect(history.state(gradeA).canUndo).toBe(true)
  })
  it('alteração em linha fora da operação não impede um desfazer restrito e não é revertida',async()=>{
    await cut()
    db.update(rundownItems).set({notes:'Outra estação'}).where(eq(rundownItems.id,a2)).run()
    await history.undo(db,gradeA)
    expect(await trimOf(a1)).toBeNull()
    expect(db.select().from(rundownItems).where(eq(rundownItems.id,a2)).get()?.notes).toBe('Outra estação')
  })
  it('refazer também recusa alteração posterior e conserva a ação pendente',async()=>{
    await cut();await history.undo(db,gradeA)
    db.update(rundownItems).set({title:'Posterior ao undo'}).where(eq(rundownItems.id,a1)).run()
    await expect(history.redo(db,gradeA)).rejects.toThrow('alterados depois')
    expect(await trimOf(a1)).toBeNull()
    expect(db.select().from(rundownItems).where(eq(rundownItems.id,a1)).get()?.title).toBe('Posterior ao undo')
    expect(history.state(gradeA).canRedo).toBe(true)
  })
  it('confere linhas de outras grades alcançadas pelo escopo',async()=>{
    await applyTrim(db,a1,trim,'ALL_RUNDOWNS',tx=>history.prepareCapture(tx,gradeA,'global',{itemIds:[a1,a2,b1]}))
    db.update(rundownItems).set({notes:'Novo texto de B'}).where(eq(rundownItems.id,b1)).run()
    await expect(history.undo(db,gradeA)).rejects.toThrow('alterados depois')
    expect(await trimOf(a1)).toEqual(trim);expect(await trimOf(b1)).toEqual(trim)
  })
  it.each(['hash','new-reference'])('padrão do acervo não volta sobre conteúdo ou vínculos superados: %s',async change=>{
    await applyTrim(db,a1,trim,'ASSET_DEFAULT',tx=>history.prepareCapture(tx,gradeA,'padrão',{itemIds:[a1],assetIds:[assetId]}))
    if(change==='hash')db.update(mediaAssets).set({contentHash:'novo-conteúdo'}).where(eq(mediaAssets.id,assetId)).run()
    else await addItem(gradeB,'novo uso',30)
    await expect(history.undo(db,gradeA)).rejects.toThrow('alterados depois')
    expect(db.select().from(mediaAssets).where(eq(mediaAssets.id,assetId)).get()?.defaultTrim).toEqual(trim)
  })
  it.each(['trim','audio','notes'])('desfazer padrão não altera sem revisão um usuário existente que foi editado depois: %s',async field=>{
    await applyTrim(db,a1,trim,'ASSET_DEFAULT',tx=>history.prepareCapture(tx,gradeA,'padrão',{itemIds:[a1],assetIds:[assetId]}))
    db.update(rundownItems).set(field==='trim'?{trim:{in:0,out:200}}:field==='audio'?{audio:{mode:'MANUAL',gainDb:-3,measured:null}}:{notes:'Outro operador'}).where(eq(rundownItems.id,b1)).run()
    const before=db.select().from(rundownItems).all()
    await expect(history.undo(db,gradeA)).rejects.toThrow('alterados depois')
    expect(db.select().from(rundownItems).all()).toEqual(before)
    expect(db.select().from(mediaAssets).where(eq(mediaAssets.id,assetId)).get()?.defaultTrim).toEqual(trim)
    expect(history.state(gradeA).canUndo).toBe(true)
  })
  it('não restaura definições secundárias antigas sobre uma edição posterior',async()=>{
    history.edit(db,gradeA,'ordem',{wholeRundown:true},tx=>tx.update(rundownItems).set({sortOrder:30}).where(eq(rundownItems.id,a1)).run())
    const channelId=db.select().from(rundowns).where(eq(rundowns.id,gradeA)).get()!.channelId
    db.insert(secondaryEvents).values({id:'new-event',channelId,itemId:a1,definition:{id:'new-event',channelId,rundownItemId:a1,name:'Novo logo',type:'GRAPHICS_OVERLAY',targetLayer:'STATION_LOGO',triggerMode:'MANUAL',offsetFrames:0,templateId:'',payload:{},enabled:true},createdAt:now,updatedAt:now}).run()
    await expect(history.undo(db,gradeA)).rejects.toThrow('alterados depois')
    expect(db.select().from(secondaryEvents).all()).toHaveLength(1)
  })
})

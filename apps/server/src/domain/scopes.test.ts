import { randomUUID } from 'node:crypto'
import { afterEach,beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { resolveTrim, type AudioLevel, type Trim } from '@rplayout/protocol'
import { toAsset } from '../db/repo.js'
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
afterEach(()=>db?.$client.close())

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
    blockId: null,
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

function otherChannel(num:number,den=1) {
  const id=randomUUID()
  db.insert(channels).values({id,name:'Outro FPS',rateNum:num,rateDen:den,width:1920,height:1080,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  db.update(rundowns).set({channelId:id}).where(eq(rundowns.id,rundownB)).run()
}

describe('escopo do corte', () => {
  it('corte amplo converte 50 → 25 e mantém mesmo instante de entrada/saída',async()=>{
    otherChannel(25)
    await applyTrim(db,itemA1,{in:100,out:5000},'ALL_RUNDOWNS')
    expect(await trimOf(itemA1)).toEqual({in:100,out:5000})
    expect(await trimOf(itemA2)).toEqual({in:100,out:5000})
    expect(await trimOf(itemB1)).toEqual({in:50,out:2500})
  })
  it('padrão declara 50fps e é resolvido a 30000/1001 sem mudar overrides',async()=>{
    otherChannel(30000,1001)
    db.update(rundownItems).set({trim:{in:3,out:7}}).where(eq(rundownItems.id,itemB1)).run()
    await applyTrim(db,itemA1,{in:500,out:1000},'ASSET_DEFAULT')
    const asset=toAsset(db.select().from(mediaAssets).where(eq(mediaAssets.id,assetId)).get()!)
    expect(asset.defaultTrimRate).toEqual({num:50,den:1})
    expect(resolveTrim(null,asset,{num:30000,den:1001}).value).toEqual({in:300,out:599})
    expect(await trimOf(itemB1)).toEqual({in:3,out:7})
  })
  it.each(['ALL_RUNDOWNS','ASSET_DEFAULT'] as const)('recusa trecho vazio em outro FPS e não deixa alterações parciais: %s',async scope=>{
    otherChannel(1)
    const before=db.select().from(rundownItems).all(),assets=db.select().from(mediaAssets).all()
    const versions=db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()
    await expect(applyTrim(db,itemA1,{in:0,out:1},scope)).rejects.toThrow('ficaria vazio')
    expect(db.select().from(rundownItems).all()).toEqual(before);expect(db.select().from(mediaAssets).all()).toEqual(assets)
    expect(db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()).toEqual(versions)
  })
  it('falha ao limpar override não deixa padrão ou revisão parcialmente gravados',async()=>{
    const version=db.$client.prepare('SELECT version FROM editorial_revision_counters WHERE scope=\'RUNDOWN\' AND rundown_id=?').get(rundownA)
    db.$client.exec(`CREATE TRIGGER fail_trim BEFORE UPDATE OF trim ON rundown_items WHEN NEW.id='${itemA1}' BEGIN SELECT RAISE(ABORT,'falha após padrão'); END`)
    await expect(applyTrim(db,itemA1,trim,'ASSET_DEFAULT')).rejects.toThrow('falha após padrão')
    expect(db.select().from(mediaAssets).where(eq(mediaAssets.id,assetId)).get()?.defaultTrim).toBeNull()
    expect(db.select().from(mediaAssets).where(eq(mediaAssets.id,assetId)).get()?.defaultTrimRateNum).toBeNull()
    expect(db.$client.prepare('SELECT version FROM editorial_revision_counters WHERE scope=\'RUNDOWN\' AND rundown_id=?').get(rundownA)).toEqual(version)
  })
  it('guard vê alvos atuais dentro da transação e aborta sem escrita',async()=>{
    const guard=(_db:Pick<Db,'select'>,targets:{ids:string[]})=>{expect(targets.ids.sort()).toEqual([itemA1,itemA2,itemB1].sort());throw new Error('canal não autorizado')}
    await expect(applyTrim(db,itemA1,trim,'ALL_RUNDOWNS',guard)).rejects.toThrow('canal não autorizado')
    expect(await trimOf(itemA1)).toBeNull();expect(await trimOf(itemB1)).toBeNull()
  })
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
      blockId: null,
      locked: false,
      autoNext: true,
      loop: false,
      notes: null,
    })
    await expect(applyTrim(db, id, trim, 'ASSET_DEFAULT')).rejects.toThrow('acervo')
  })
})

describe('escopo do nivelamento', () => {
  it('AUTO padrão usa exclusivamente FILE do acervo, não loudness enviada pelo cliente',async()=>{
    const measured={integratedLufs:-27,lra:2,truePeakDbtp:-6,scope:'FILE' as const,measuredAt:now}
    db.update(mediaAssets).set({loudnessFile:measured}).where(eq(mediaAssets.id,assetId)).run()
    await applyAudio(db,itemA1,{mode:'AUTO',gainDb:20,measured:{...measured,integratedLufs:9,scope:'TRIM'}},'RUNDOWN')
    for(const id of [itemA1,itemA2])expect(db.select().from(rundownItems).where(eq(rundownItems.id,id)).get()?.audio?.measured).toEqual(measured)
  })
  it.each(['missing','trim','date','hash','lra'])('AUTO padrão recusa FILE inválido %s sem alterar alvos/revisões',async field=>{
    const measured={integratedLufs:-27,lra:field==='lra'?-1:2,truePeakDbtp:-6,scope:field==='trim'?'TRIM' as const:'FILE' as const,measuredAt:field==='date'?'invalid':now,...(field==='hash'?{input:{contentHash:'wrong',audioTrack:0,routing:{mode:'DEFAULT' as const}}}:{})}
    db.update(mediaAssets).set({loudnessFile:field==='missing'?null:measured}).where(eq(mediaAssets.id,assetId)).run()
    const items=db.select().from(rundownItems).all(),versions=db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()
    await expect(applyAudio(db,itemA1,{mode:'AUTO',gainDb:0,measured:{...measured,scope:'FILE'}},'ALL_RUNDOWNS')).rejects.toThrow('salva no acervo')
    expect(db.select().from(rundownItems).all()).toEqual(items);expect(db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()).toEqual(versions)
  })
  it.each(['RUNDOWN','ALL_RUNDOWNS','ASSET_DEFAULT'] as const)('trilha é só do item selecionado mesmo com nível amplo: %s',async scope=>{
    const before=db.select({id:rundownItems.id,track:rundownItems.audioTrack}).from(rundownItems).all().filter(row=>row.id!==itemA1)
    await applyAudio(db,itemA1,audio,scope,undefined,1)
    const tracks=db.select({id:rundownItems.id,track:rundownItems.audioTrack}).from(rundownItems).all()
    expect(tracks.find(row=>row.id===itemA1)?.track).toBe(1)
    expect(tracks.filter(row=>row.id!==itemA1)).toEqual(before)
  })
  it('falha no override reverte padrão de áudio e contadores',async()=>{
    const versions=db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()
    db.$client.exec(`CREATE TRIGGER fail_audio BEFORE UPDATE OF audio ON rundown_items WHEN NEW.id='${itemA1}' BEGIN SELECT RAISE(ABORT,'falha de áudio'); END`)
    await expect(applyAudio(db,itemA1,audio,'ASSET_DEFAULT')).rejects.toThrow('falha de áudio')
    expect(db.select().from(mediaAssets).where(eq(mediaAssets.id,assetId)).get()?.defaultAudio).toBeNull()
    expect(db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()).toEqual(versions)
  })
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
  it('grava matriz/nível/trilha atomicamente e preserva a seleção ao ler',async()=>{
    const routed:AudioLevel={mode:'MANUAL',gainDb:-3,measured:null,routing:{mode:'MATRIX',matrix:[[0,0,1,0],[0,0,0,1]]}}
    await applyAudio(db,itemA1,routed,'ITEM',undefined,1)
    expect(await audioOf(itemA1)).toEqual(routed);expect(db.select().from(rundownItems).where(eq(rundownItems.id,itemA1)).get()?.audioTrack).toBe(1)
  })
  it('matriz incompatível e ganho automático sem medição do mix não gravam nada',async()=>{
    db.update(mediaAssets).set({hasAudio:true,audioChannels:2,audioTracks:[{index:0,channels:2,rate:48000}]}).where(eq(mediaAssets.id,assetId)).run()
    expect(db.select().from(mediaAssets).where(eq(mediaAssets.id,assetId)).get()?.audioChannels).toBe(2)
    const before=db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()
    const routed:AudioLevel={mode:'MANUAL',gainDb:0,measured:null,routing:{mode:'STEREO_3_4'}}
    await expect(applyAudio(db,itemA1,routed,'ALL_RUNDOWNS',undefined,0)).rejects.toMatchObject({status:409,payload:{error:'AUDIO_ROUTING_INVALID',message:expect.stringContaining('exige 4')}})
    await expect(applyAudio(db,itemA1,{...routed,mode:'AUTO',routing:{mode:'LEFT_ONLY'}},'ITEM')).rejects.toMatchObject({status:409,payload:{message:expect.stringContaining('medição')}})
    expect(await audioOf(itemA1)).toBeNull();expect(await audioOf(itemA2)).toBeNull();expect(await audioOf(itemB1)).toBeNull()
    expect(db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()).toEqual(before)
  })
})

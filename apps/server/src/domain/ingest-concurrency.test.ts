import {createHash} from 'node:crypto'
import {mkdtempSync,rmSync,utimesSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {eq} from 'drizzle-orm'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {mediaAssets} from '../db/schema.js'
import {qcRevision} from '../db/qc-revisions.js'
import {Ingest,SILENT_AUDIO_NOTE,silentAudioNote} from './ingest.js'
import type {MediaWorkflow} from './media-workflow.js'

const contents='PROBE_TEST_BYTES',hash=createHash('sha256').update(contents).digest('hex')
const valid={ok:true as const,durationNs:1e9,video:{width:1920,height:1080,rateNum:25,rateDen:1,interlaceMode:'PROGRESSIVE'},audio:{rate:48000,channels:2}}
type Result=typeof valid|{ok:false;reason:string}
let opened:ReturnType<typeof openDatabase>,directory:string,path:string,ingest:Ingest
let record:ReturnType<typeof vi.fn>
const row=()=>opened.db.select().from(mediaAssets).where(eq(mediaAssets.path,path)).get()
function seed(id='asset',contentHash=hash){
  opened.db.insert(mediaAssets).values({id,path,contentHash,title:'Antes',kind:'VIDEO',durationFrames:250,createdAt:'before',categoryId:'Notícias',qcStatus:'APPROVED',qcNotes:'Antes',qcCheckedAt:'before',ignored:false}).run()
}
beforeEach(()=>{
  directory=mkdtempSync(join(tmpdir(),'RPlayout-ingest-concurrency-'));path=join(directory,'AÇÃO Çãó.mxf')
  writeFileSync(path,contents);utimesSync(path,new Date('2020-01-01'),new Date('2020-01-01'))
  opened=openDatabase(join(directory,'catalog.db'));record=vi.fn()
  ingest=new Ingest(opened.db,'unused-probe',join(directory,'.thumbs'),{record} as unknown as MediaWorkflow)
  ingest.measure=false
})
afterEach(()=>{vi.restoreAllMocks();opened.sqlite.close();rmSync(directory,{recursive:true,force:true})})
async function duringProbe(change:()=>void,result:Result=valid){
  let release!:()=>void,entered!:()=>void
  const waiting=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{entered=resolve})
  const internals=ingest as unknown as {probe:()=>Promise<Result>;absorb:(path:string)=>Promise<boolean>}
  vi.spyOn(internals,'probe').mockImplementation(async()=>{entered();await waiting;return result})
  const pending=internals.absorb(path)
  await ready
  let mutationFailure:unknown
  try{change()}catch(error){mutationFailure=error}finally{release()}
  const outcome=await pending
  if(mutationFailure)throw mutationFailure
  return outcome
}

describe('sonda lenta não sobrescreve decisões mais recentes do acervo',()=>{
  it('conserva título/categoria/ignorado/QC/loudness atuais do mesmo hash e enfileira só após commit',async()=>{
    seed();const before=qcRevision(opened.db,'asset')
    const loudness={integratedLufs:-23,lra:4,truePeakDbtp:-2,scope:'FILE' as const,measuredAt:'latest'}
    record.mockImplementation((id,metadata)=>{expect(opened.sqlite.inTransaction).toBe(false);expect(id).toBe('asset');expect(metadata).toEqual(row())})
    await duringProbe(()=>opened.db.update(mediaAssets).set({title:'Operador Çãó',categoryId:'Ao Vivo',ignored:true,qcStatus:'BLOCKED',qcNotes:'Decisão nova',qcCheckedAt:'latest',loudnessFile:loudness}).where(eq(mediaAssets.id,'asset')).run())
    expect(row()).toMatchObject({title:'Operador Çãó',categoryId:'Ao Vivo',ignored:true,qcStatus:'BLOCKED',qcNotes:'Decisão nova',qcCheckedAt:'latest',loudnessFile:loudness,width:1920,contentHash:hash})
    expect(qcRevision(opened.db,'asset')).toBe(before+2);expect(record).toHaveBeenCalledTimes(1)
  })
  it('conteúdo novo não herda aprovação/medição do hash anterior, mas conserva metadata atual',async()=>{
    seed('asset','old-hash')
    await duringProbe(()=>opened.db.update(mediaAssets).set({title:'Atual',categoryId:null,ignored:true,qcStatus:'APPROVED',qcNotes:'hash antigo',qcCheckedAt:'latest'}).where(eq(mediaAssets.id,'asset')).run())
    expect(row()).toMatchObject({title:'Atual',categoryId:null,ignored:true,contentHash:hash,qcStatus:'PENDING',qcNotes:null,qcCheckedAt:null,loudnessFile:null})
  })
  it('falha técnica conserva metadata/ignorado atuais, sem manter aprovação falsa',async()=>{
    seed()
    await duringProbe(()=>opened.db.update(mediaAssets).set({title:'Atual',categoryId:'Esportes',ignored:false,qcStatus:'APPROVED'}).where(eq(mediaAssets.id,'asset')).run(),{ok:false,reason:'codec ausente'})
    expect(row()).toMatchObject({title:'Atual',categoryId:'Esportes',ignored:false,qcStatus:'FAILED',probeError:'codec ausente',qcNotes:'codec ausente'})
  })
  it('entrada criada por outra estação durante a sonda é atualizada sem duplicação nem apagar escolhas',async()=>{
    await duringProbe(()=>{seed('other');opened.db.update(mediaAssets).set({title:'Outra estação',ignored:true,qcStatus:'APPROVED_WITH_NOTES',qcNotes:'Ressalva'}).where(eq(mediaAssets.id,'other')).run()})
    expect(opened.db.select().from(mediaAssets).all()).toHaveLength(1)
    expect(row()).toMatchObject({id:'other',title:'Outra estação',ignored:true,qcStatus:'APPROVED_WITH_NOTES',qcNotes:'Ressalva',width:1920})
    expect(ingest.status()).toMatchObject({added:0,updated:1})
  })
  it('entrada removida durante análise não é ressuscitada pela resposta atrasada',async()=>{
    seed();await duringProbe(()=>opened.db.delete(mediaAssets).where(eq(mediaAssets.id,'asset')).run())
    expect(row()).toBeUndefined();expect(record).not.toHaveBeenCalled();expect(ingest.status().skipped).toBe(1)
  })
  it('outro ID substituindo o caminho não recebe a sonda da entrada anterior',async()=>{
    seed();let replacement:ReturnType<typeof row>
    await duringProbe(()=>{opened.db.delete(mediaAssets).where(eq(mediaAssets.id,'asset')).run();seed('replacement');replacement=row()})
    expect(row()).toEqual(replacement);expect(record).not.toHaveBeenCalled();expect(ingest.status().skipped).toBe(1)
  })
  it('adquire writer antes de reler decisões; outra conexão não grava durante o merge',async()=>{
    seed();const peer=openDatabase(join(directory,'catalog.db'));peer.sqlite.pragma('busy_timeout=0')
    try{
      await duringProbe(()=>{
        const original=opened.db.select.bind(opened.db);let checked=false
        vi.spyOn(opened.db,'select').mockImplementation((...args:Parameters<typeof original>)=>{
          if(!checked){checked=true;expect(opened.sqlite.inTransaction).toBe(true);expect(()=>peer.sqlite.prepare("UPDATE media_assets SET title='Race' WHERE id='asset'").run()).toThrow('locked')}
          return original(...args)
        })
      })
      expect(row()?.title).toBe('Antes');expect(row()?.width).toBe(1920)
    }finally{peer.sqlite.close()}
  })
  it('erro no commit reverte dados/counter e não publica versão ou estatística falsa',async()=>{
    seed();const original=row(),revision=qcRevision(opened.db,'asset')
    await expect(duringProbe(()=>opened.sqlite.exec("CREATE TRIGGER probe_failure BEFORE UPDATE ON media_assets BEGIN SELECT RAISE(ABORT,'PROBE_COMMIT_FIXTURE'); END"))).rejects.toThrow('PROBE_COMMIT_FIXTURE')
    expect(row()).toEqual(original);expect(qcRevision(opened.db,'asset')).toBe(revision);expect(record).not.toHaveBeenCalled();expect(ingest.status()).toMatchObject({added:0,updated:0,failed:0})
  })
})

describe('áudio medido em silêncio digital',()=>{
  const silent={...valid,audio:{rate:48000,channels:2,integratedLufs:-70,lra:0,truePeakDbtp:-90}}
  it('conteúdo novo vai para o QC com nota de silêncio; conteúdo com som não',async()=>{
    seed('asset','old-hash')
    await duringProbe(()=>{},silent as unknown as Result)
    expect(row()).toMatchObject({qcStatus:'PENDING',qcNotes:SILENT_AUDIO_NOTE,loudnessFile:{integratedLufs:-70,truePeakDbtp:-90}})
    expect(silentAudioNote({integratedLufs:-23,truePeakDbtp:-2})).toBeNull()
    expect(silentAudioNote({integratedLufs:-70,truePeakDbtp:-20})).toBeNull()
    expect(silentAudioNote(null)).toBeNull()
  })
  it('mesmo conteúdo já aprovado mantém decisão e nota do operador',async()=>{
    seed()
    await duringProbe(()=>{},silent as unknown as Result)
    expect(row()).toMatchObject({qcStatus:'APPROVED',qcNotes:'Antes'})
  })
})

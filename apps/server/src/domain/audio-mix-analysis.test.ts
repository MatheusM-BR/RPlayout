import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {hostname} from 'node:os'
import {openDatabase,type Db} from '../db/client.js'
import {channels,mediaAssets,rundowns,rundownItems,operatorDecisions} from '../db/schema.js'
import {AudioMixAnalysis,requireMixMeasurement,type MixReading} from './audio-mix-analysis.js'
import {applyAudio} from './scopes.js'
import type {AudioRouting} from '@rplayout/protocol'
const hash='a'.repeat(64),route:AudioRouting={mode:'STEREO_3_4'},reading:MixReading={ok:true,integratedLufs:-18,lra:3,truePeakDbtp:-7,sampleFrames:48000,rate:48000,channels:2}
let db:Db,workers:AudioMixAnalysis[]=[]
function worker(runner:()=>Promise<MixReading>=async()=>reading,original=async()=>'/verified/ação.mkv'){
  const value=new AudioMixAnalysis(db,'fixture-medidor',original,runner);workers.push(value);return value
}
beforeEach(()=>{
  db=openDatabase(':memory:').db;workers=[];const now=new Date().toISOString()
  db.insert(channels).values({id:'ch',name:'Test',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Test',date:'2026-10-02',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  db.insert(mediaAssets).values({id:'asset',contentHash:hash,path:'/ação.mkv',title:'Áudio',kind:'VIDEO',durationFrames:250,audioChannels:4,hasAudio:true,audioTracks:[{index:0,channels:4,rate:48000},{index:1,channels:2,rate:48000}],createdAt:now}).run()
  for(const id of ['a','b'])db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:id==='a'?0:10,title:id,type:'VT',mediaId:'asset',anchor:{kind:'FLOW'},onOverrun:'PUSH',minDuration:0,autoNext:false,loop:false,locked:false}).run()
})
afterEach(()=>{for(const w of workers)w.close();db.$client.close()})
const versions=()=>db.$client.prepare('SELECT * FROM editorial_revision_counters ORDER BY scope,rundown_id,item_id').all()
describe('medição durável do mix não altera operação/editorial/QC',()=>{
  it('conclui, reutiliza e usa só números do medidor, não do cliente',async()=>{
    const before=versions(),w=worker(),job=w.queue('a',hash,0,route,'operador',()=>{})
    await vi.waitFor(()=>expect(w.read('a',job.id)?.state).toBe('READY'))
    expect(versions()).toEqual(before);expect(w.queue('a',hash,0,route,'operador',()=>{}).id).toBe(job.id)
    expect(w.read('b',job.id)).toBeNull();expect(db.select().from(mediaAssets).get()?.qcStatus).toBe('APPROVED')
    const measured=requireMixMeasurement(db,job.id,hash,0,route)
    await applyAudio(db,'a',{mode:'AUTO',gainDb:99,measured:{...measured,integratedLufs:10},routing:route,analysisId:job.id},'ITEM',undefined,0)
    expect(db.select().from(rundownItems).where(eq(rundownItems.id,'a')).get()?.audio?.measured).toEqual(measured)
    expect(()=>requireMixMeasurement(db,job.id,hash,1,route)).toThrow('não corresponde')
    expect(()=>requireMixMeasurement(db,job.id,'b'.repeat(64),0,route)).toThrow('não corresponde')
    expect(()=>requireMixMeasurement(db,job.id,hash,0,{mode:'LEFT_ONLY'})).toThrow('não corresponde')
  })
  it('segunda instância não rouba claim; fechar marca somente o próprio trabalho',async()=>{
    const run=vi.fn(()=>new Promise<MixReading>(()=>{})),first=worker(run),job=first.queue('a',hash,0,route,null,()=>{})
    await vi.waitFor(()=>expect(run).toHaveBeenCalledOnce())
    const other=worker();await other.tick();expect(other.read('a',job.id)?.state).toBe('RUNNING')
    other.close();expect(first.read('a',job.id)?.state).toBe('RUNNING')
    first.close();expect(first.read('a',job.id)?.state).toBe('FAILED')
  })
  it('queda comprovada do dono local invalida resultado, sem fabricar medição ou repetir',async()=>{
    const first=worker(()=>new Promise<MixReading>(()=>{})),job=first.queue('a',hash,0,route,null,()=>{})
    await vi.waitFor(()=>expect(first.read('a',job.id)?.state).toBe('RUNNING'))
    const current=first.read('a',job.id)!
    db.update(operatorDecisions).set({payload:{...current,worker:{host:hostname(),pid:2147483647,boot:'dead'}} as unknown as Record<string,unknown>}).where(eq(operatorDecisions.id,job.id)).run()
    const restarted=worker();expect(restarted.read('a',job.id)?.state).toBe('FAILED');expect(restarted.read('a',job.id)?.measurement).toBeNull()
  })
  it('mudança de versão durante análise descarta o resultado sem modificar item',async()=>{
    let finish!:(reading:MixReading)=>void;const w=worker(()=>new Promise(resolve=>{finish=resolve})),before=versions(),job=w.queue('a',hash,0,route,null,()=>{})
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
    db.update(mediaAssets).set({contentHash:'b'.repeat(64)}).where(eq(mediaAssets.id,'asset')).run();const changed=versions();finish(reading)
    await vi.waitFor(()=>expect(w.read('a',job.id)?.state).toBe('FAILED'))
    expect(versions()).toEqual(changed);expect(changed).not.toEqual(before);expect(db.select().from(rundownItems).get()?.audio).toBeNull()
  })
  it('áudio incompleto e original adulterado não produzem medição',async()=>{
    const w=worker(async()=>({...reading,sampleFrames:0})),job=w.queue('a',hash,0,route,null,()=>{})
    await vi.waitFor(()=>expect(w.read('a',job.id)?.state).toBe('FAILED'))
    const bad=worker(async()=>reading,async()=>null as unknown as string),retry=bad.queue('a',hash,0,route,null,()=>{})
    await vi.waitFor(()=>expect(bad.read('a',retry.id)?.state).toBe('FAILED'))
    expect(()=>requireMixMeasurement(db,retry.id,hash,0,route)).toThrow('não corresponde')
  })
  it('recusa canal/arquivo superado, par ausente e autorização revogada antes de gravar',()=>{
    const w=worker(),before=versions()
    expect(()=>w.queue('a','b'.repeat(64),0,route,null,()=>{})).toThrow('versão')
    expect(()=>w.queue('a',hash,1,route,null,()=>{})).toThrow('exige 4')
    expect(()=>w.queue('a',hash,0,route,null,()=>{throw new Error('revogada')})).toThrow('revogada')
    expect(db.select().from(operatorDecisions).all()).toHaveLength(0);expect(versions()).toEqual(before)
  })
  it('escopo amplo recusa outra trilha e padrão com trilha incompatível, revertendo tudo',async()=>{
    const w=worker(),job=w.queue('a',hash,0,route,null,()=>{});await vi.waitFor(()=>expect(w.read('a',job.id)?.state).toBe('READY'))
    db.update(rundownItems).set({audioTrack:1}).where(eq(rundownItems.id,'b')).run();const before=versions()
    await expect(applyAudio(db,'a',{mode:'AUTO',gainDb:0,measured:null,routing:route,analysisId:job.id},'RUNDOWN')).rejects.toThrow('não corresponde')
    expect(db.select().from(rundownItems).all().every(row=>row.audio===null)).toBe(true);expect(versions()).toEqual(before)
    await expect(applyAudio(db,'a',{mode:'AUTO',gainDb:0,measured:null,routing:{mode:'DEFAULT'}},'ITEM',undefined,1)).rejects.toThrow('medição própria')
  })
})

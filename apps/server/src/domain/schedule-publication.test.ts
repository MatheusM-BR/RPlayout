import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir,hostname} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createApp,type App} from '../app.js'
import {channels,mediaAssets,rundowns,scheduleRules,operatorDecisions,users,qcDecisions,operationalPlaylistRevisions} from '../db/schema.js'
import {SchedulePublication,readSchedulePublicationPolicy} from './schedule-publication.js'
import {planScheduleDay,type DayPlanRequest} from './schedule-day.js'
import {readOperationalPayload} from './operational-playlist.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let app:App,service:SchedulePublication,directory:string,file:string,runner:ReturnType<typeof vi.fn>,original:ReturnType<typeof vi.fn>
const owner={userId:null,username:null},now=()=>new Date().toISOString()
beforeEach(async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-03T12:00:00'))
  directory=await mkdtemp(join(tmpdir(),'RPlayout-schedule-auto-'));file=join(directory,'Ação-aprovada.mxf');await writeFile(file,'APPROVED_EDITION')
  app=await createApp(':memory:')
  app.db.insert(channels).values({id:'ch',name:'Canal',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now()}).run()
  app.db.insert(rundowns).values({id:'anchor',channelId:'ch',name:'Manual no ar',date:'2026-10-03',plannedStart:0,loop:false,createdAt:now(),updatedAt:now()}).run()
  app.db.insert(mediaAssets).values({id:'asset',path:file,title:'Aprovado',contentHash:createHash('sha256').update('APPROVED_EDITION').digest('hex'),kind:'VIDEO',durationFrames:3600*25,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:now()}).run()
  app.db.insert(scheduleRules).values({id:'rule',channelId:'ch',name:'Pauta 24h',weekdays:'0123456',startMinute:0,endMinute:1440,categories:[],avoidHours:0,createdAt:now()}).run()
  runner=vi.fn(async(request:DayPlanRequest)=>planScheduleDay(request));original=vi.fn(async()=>file)
  service=new SchedulePublication(app.db,'fixture-worker',original,runner)
})
afterEach(async()=>{service.close();app.close();vi.useRealTimers();vi.restoreAllMocks();await rm(directory,{recursive:true,force:true})})
function enable(days=2){const review=service.review('ch',days,2000,owner);return service.enable('ch',days,2000,owner,review.token,()=>{})}
const count=(table:string)=>(app.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n
describe('publicação recorrente apenas de dias futuros próprios',()=>{
  it('desligada por padrão; review é readonly e ENABLE sem conferência não escreve',async()=>{
    expect(service.status('ch').state).toBe('DISABLED');await service.tick();expect(runner).not.toHaveBeenCalled()
    const before=count('operator_decisions');service.review('ch',2,2000,owner);expect(count('operator_decisions')).toBe(before)
    expect(()=>service.enable('ch',2,2000,owner,undefined,()=>{})).toThrow('Confira')
    expect(count('operator_decisions')).toBe(before);expect(count('rundowns')).toBe(1)
  })
  it('habilita sem TAKE e publica uma vez por dia, com fotografia operacional e autoria duráveis',async()=>{
    enable();expect(count('rundowns')).toBe(1)
    await Promise.all([service.tick(),service.tick()]);expect(count('rundowns')).toBe(2)
    await service.tick();await service.tick()
    expect(count('rundowns')).toBe(3);expect(count('operational_playlist_revisions')).toBe(2);expect(runner).toHaveBeenCalledTimes(2)
    expect(service.status('ch').jobs.every(job=>job.state==='READY')).toBe(true)
    expect(JSON.stringify(service.status('ch'))).not.toContain(file)
    expect(JSON.stringify(service.status('ch'))).not.toContain('"pid"')
    for(const row of app.db.select().from(operationalPlaylistRevisions).all()){
      const payload=readOperationalPayload(row.payload);expect(payload.items).toHaveLength(24);expect(payload.schedule.endsAt).toBe(2160000);expect(payload.schedule.conflicts).toEqual([]);expect(payload.rundown.loop).toBe(false)
    }
    expect(count('qc_decisions')).toBe(0);expect(count('as_run')).toBe(0)
    const restarted=new SchedulePublication(app.db,'fixture-worker',original,runner);await restarted.tick();expect(count('operational_playlist_revisions')).toBe(2);restarted.close()
  })
  it('não sobrescreve dia manual nem publica plano com material sem aprovação',async()=>{
    app.db.insert(rundowns).values({id:'manual',channelId:'ch',name:'Outra edição',date:'2026-10-04',plannedStart:0,loop:false,createdAt:now(),updatedAt:now()}).run()
    expect(()=>enable()).toThrow('grade manual');expect(count('operational_playlist_revisions')).toBe(0);expect(runner).not.toHaveBeenCalled()
    app.db.delete(rundowns).where(eq(rundowns.id,'manual')).run();app.db.update(mediaAssets).set({qcStatus:'PENDING'}).where(eq(mediaAssets.id,'asset')).run()
    enable();await service.tick();expect(service.status('ch').jobs[0]!.state).toBe('FAILED');expect(count('rundowns')).toBe(1)
  })
  it('pauta incompleta ou alterada invalida conferência e suspende sem publicar',async()=>{
    const review=service.review('ch',2,2000,owner)
    app.db.update(scheduleRules).set({name:'Novo critério'}).where(eq(scheduleRules.id,'rule')).run()
    expect(()=>service.enable('ch',2,2000,owner,review.token,()=>{})).toThrow('mudou')
    enable();app.db.update(scheduleRules).set({endMinute:1439}).where(eq(scheduleRules.id,'rule')).run();await service.tick()
    expect(service.status('ch').state).toBe('SUSPENDED');expect(count('rundowns')).toBe(1)
  })
  it('QC/hash/duração alterados durante seleção ou verificação descartam resultado exato',async()=>{
    enable();runner.mockImplementationOnce(async(request:DayPlanRequest)=>{const plan=planScheduleDay(request);app.db.update(mediaAssets).set({durationFrames:3601*25}).where(eq(mediaAssets.id,'asset')).run();return plan})
    await service.tick();expect(service.status('ch').state).toBe('SUSPENDED');expect(count('rundowns')).toBe(1)
    app.db.update(mediaAssets).set({durationFrames:3600*25}).where(eq(mediaAssets.id,'asset')).run();enable()
    original.mockImplementationOnce(async()=>{app.db.insert(qcDecisions).values({id:'reject',assetId:'asset',contentHash:app.db.select().from(mediaAssets).get()!.contentHash,channelId:'ch',status:'REJECTED',notes:'Mudou',checks:{playable:false,errors:['Mudou'],warnings:[]},createdAt:now()}).run();return file})
    await service.tick();expect(count('operational_playlist_revisions')).toBe(0);expect(count('rundowns')).toBe(1)
  })
  it('perda de conta/permissão e disable durante worker impedem publicação, sem suspender versão nova',async()=>{
    enable();runner.mockImplementationOnce(async(request:DayPlanRequest)=>{service.suspend('ch',null,'Operador desligou','DISABLED');return planScheduleDay(request)})
    await service.tick();expect(service.status('ch')).toMatchObject({state:'DISABLED',version:2});expect(count('rundowns')).toBe(1)
    enable();app.db.insert(users).values({id:'admin',username:'admin',passwordHash:'unused',role:'ADMIN',enabled:true,createdAt:now()}).run();await service.tick()
    expect(service.status('ch').state).toBe('SUSPENDED');expect(count('rundowns')).toBe(1)
  })
  it('falha de auditoria reverte grade, itens, publicação e READY no mesmo commit',async()=>{
    enable();app.sqlite.exec("CREATE TRIGGER abort_schedule BEFORE INSERT ON operator_decisions WHEN NEW.kind='SCHEDULE_DAY_PUBLISHED' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
    await service.tick();expect(count('rundowns')).toBe(1);expect(count('rundown_items')).toBe(0);expect(count('operational_playlist_revisions')).toBe(0);expect(service.status('ch').jobs[0]!.state).toBe('FAILED')
    await service.tick();expect(runner).toHaveBeenCalledTimes(1)
  })
  it('dono vivo/remoto não é roubado, interrompido exige nova conferência',async()=>{
    enable();const policy=readSchedulePublicationPolicy(app.db,'ch')!
    const job={id:'foreign',channelId:'ch',date:'2026-10-04',policyVersion:policy.version,state:'RUNNING',worker:{host:hostname(),pid:process.pid,boot:'other'},createdAt:now(),updatedAt:now(),message:'busy'}
    app.db.insert(operatorDecisions).values({id:job.id,rundownId:'anchor',kind:'SCHEDULE_PUBLICATION_JOB',payload:job,createdAt:now()}).run()
    await service.tick();expect(runner).not.toHaveBeenCalled();expect(service.status('ch').state).toBe('ENABLED')
    app.db.update(operatorDecisions).set({payload:{...job,worker:{host:'remote',pid:2147483647,boot:'foreign'}}}).where(eq(operatorDecisions.id,job.id)).run();await service.tick();expect(runner).not.toHaveBeenCalled()
    app.db.update(operatorDecisions).set({payload:{...job,worker:{host:hostname(),pid:2147483647,boot:'dead'}}}).where(eq(operatorDecisions.id,job.id)).run();await service.tick()
    expect(service.status('ch').state).toBe('SUSPENDED');expect(service.status('ch').jobs[0]!.state).toBe('FAILED')
  })
  it('duas instâncias não publicam o mesmo dia enquanto a seleção está pendente',async()=>{
    enable();let release!:(value:ReturnType<typeof planScheduleDay>)=>void
    runner.mockImplementationOnce((request:DayPlanRequest)=>new Promise(resolve=>{release=()=>resolve(planScheduleDay(request))}))
    const first=service.tick();await Promise.resolve()
    const second=new SchedulePublication(app.db,'fixture-worker',original,runner);await second.tick();expect(runner).toHaveBeenCalledTimes(1)
    release(undefined as never);await first;await second.tick();expect(count('operational_playlist_revisions')).toBe(2);second.close()
  })
  it('plano malformado, arquivo sem bytes verificados e nova grade criada durante worker não chegam a READY',async()=>{
    enable();runner.mockImplementationOnce(async(request:DayPlanRequest)=>{const plan=planScheduleDay(request);plan.items[0]!.duration=1;return plan})
    await service.tick();expect(count('rundowns')).toBe(1)
    enable();original.mockResolvedValueOnce(null);await service.tick();expect(count('operational_playlist_revisions')).toBe(0)
    enable();runner.mockImplementationOnce(async(request:DayPlanRequest)=>{app.db.insert(rundowns).values({id:'manual-race',channelId:'ch',name:'Criada por operador',date:'2026-10-04',plannedStart:0,loop:false,createdAt:now(),updatedAt:now()}).run();return planScheduleDay(request)})
    await service.tick();expect(count('rundowns')).toBe(2);expect(count('operational_playlist_revisions')).toBe(0)
  })
  it('bytes reais substituídos são recusados mesmo quando o resolver retorna o mesmo caminho',async()=>{
    enable();await writeFile(file,'REPLACED_EDITION')
    await service.tick();expect(count('rundowns')).toBe(1);expect(count('operational_playlist_revisions')).toBe(0)
    expect(service.status('ch').jobs[0]!.state).toBe('FAILED')
    expect(service.status('ch').message).toContain('não correspondem')
  })
  it('reserva da publicação anterior conta para repetição, mesmo sem as-run',async()=>{
    app.db.update(mediaAssets).set({durationFrames:12*3600*25}).where(eq(mediaAssets.id,'asset')).run()
    const row=app.db.select().from(mediaAssets).get()!
    const second=join(directory,'Outro-aprovado.mxf');await writeFile(second,'SECOND_APPROVED_EDITION')
    app.db.insert(mediaAssets).values({...row,id:'asset2',path:second,contentHash:createHash('sha256').update('SECOND_APPROVED_EDITION').digest('hex')}).run()
    original.mockImplementation(async(id:string)=>id==='asset2'?second:file)
    app.db.update(scheduleRules).set({avoidHours:25}).where(eq(scheduleRules.id,'rule')).run()
    enable();await service.tick();expect(count('operational_playlist_revisions')).toBe(1)
    await service.tick();expect(service.status('ch').state).toBe('SUSPENDED');expect(count('operational_playlist_revisions')).toBe(1)
    expect(service.status('ch').jobs.filter(job=>job.state==='READY')).toHaveLength(1);expect(count('as_run')).toBe(0)
  })
})

import { afterEach,describe,expect,it,vi } from 'vitest'
import { openDatabase } from '../db/client.js'
import { SecondaryEventLedger } from './secondary-event-ledger.js'
import { secondaryEventRuns,healthEvents } from '../db/schema.js'
import type { SecondaryEvent } from '@rplayout/protocol'
const databases:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for (const db of databases.splice(0)) db.sqlite.close()})
const event:SecondaryEvent={id:'event',rundownItemId:'item',targetLayer:'LOWER_THIRD',triggerMode:'OFFSET_FROM_START',offsetFrames:125,templateId:'',payload:{},enabled:true}
const context={executionId:'pass-1',itemId:'item',revisionId:'rev-1',frames:125}
describe('ledger de eventos secundários',()=>{
  it('admissão expõe confirmação ausente sem mudar o resultado nem reenviar comando',async()=>{
    const db=openDatabase(':memory:');databases.push(db)
    await db.db.insert(secondaryEventRuns).values({id:'missing',channelId:'ch',...context,eventId:event.id,mode:'FIRE',state:'FIRING',createdAt:'now'})
    const ledger=new SecondaryEventLedger(db.db,'ch'),work=vi.fn(async()=>{})
    expect(ledger.reportUnconfirmed()).toBe(1)
    expect(await ledger.execute(context,{...event,type:'GRAPHICS_OVERLAY'},'FIRE',work,true)).toBe(false)
    expect(work).not.toHaveBeenCalled()
    expect(db.sqlite.prepare('SELECT state,completed_at FROM secondary_event_runs').get()).toEqual({state:'FIRING',completed_at:null})
    expect(db.sqlite.prepare('SELECT component,state,severity,resolved_at FROM health_events').get()).toEqual({component:'SECONDARY_EVENT',state:'secondary_confirmation_missing',severity:'CRITICAL',resolved_at:null})
  })
  it('reabertura não duplica alarme nem apaga reconhecimento ou declara recuperação',async()=>{
    const db=openDatabase(':memory:');databases.push(db)
    await db.db.insert(secondaryEventRuns).values({id:'missing',channelId:'ch',...context,eventId:event.id,mode:'FIRE',state:'FIRING',createdAt:'now'})
    expect(new SecondaryEventLedger(db.db,'ch').reportUnconfirmed()).toBe(1)
    db.sqlite.prepare("UPDATE health_events SET acknowledged_at='operator-reviewed'").run()
    expect(new SecondaryEventLedger(db.db,'ch').reportUnconfirmed()).toBe(0)
    expect(db.sqlite.prepare('SELECT acknowledged_at,resolved_at FROM health_events').get()).toEqual({acknowledged_at:'operator-reviewed',resolved_at:null})
    expect(db.sqlite.prepare('SELECT count(*) n FROM health_events').get()).toEqual({n:1})
  })
  it('diagnóstico limita-se ao canal e a FIRING, sem expor identificadores externos',async()=>{
    const db=openDatabase(':memory:');databases.push(db)
    for(const [id,channelId,state] of [['private-password=secret','ch','FIRING'],['other','other','FIRING'],['done','ch','EXECUTED'],['failed','ch','FAILED']] as const){
      await db.db.insert(secondaryEventRuns).values({id,channelId,...context,eventId:id,mode:'FIRE',state,createdAt:'now'})
    }
    expect(new SecondaryEventLedger(db.db,'ch').reportUnconfirmed()).toBe(1)
    const alarms=db.sqlite.prepare('SELECT * FROM health_events').all()
    expect(alarms).toHaveLength(1)
    expect(JSON.stringify(alarms)).not.toContain('private-password=secret')
    expect(JSON.stringify(await db.db.select().from(healthEvents))).not.toContain('private-password=secret')
  })
  it('falha de armazenamento não deixa reparo parcial nem altera intenção',async()=>{
    const db=openDatabase(':memory:');databases.push(db)
    for(const id of ['first','second'])await db.db.insert(secondaryEventRuns).values({id,channelId:'ch',...context,eventId:id,mode:'FIRE',state:'FIRING',createdAt:'now'})
    db.sqlite.exec("CREATE TRIGGER fail_secondary_alarm BEFORE INSERT ON health_events WHEN (SELECT count(*) FROM health_events)>0 BEGIN SELECT RAISE(ABORT,'storage-fault'); END")
    expect(()=>new SecondaryEventLedger(db.db,'ch').reportUnconfirmed()).toThrow('storage-fault')
    expect(db.sqlite.prepare('SELECT count(*) n FROM health_events').get()).toEqual({n:0})
    expect(db.sqlite.prepare("SELECT count(*) n FROM secondary_event_runs WHERE state='FIRING'").get()).toEqual({n:2})
  })
  it.each([
    {name:'outro canal',channel:'other',item:'item',revision:'rev-1'},
    {name:'outro item',channel:'ch',item:'other',revision:'rev-1'},
    {name:'outra revisão',channel:'ch',item:'item',revision:'rev-2'},
    {name:'revisão legada nula',channel:'ch',item:'item',revision:null},
  ])('não restaura confirmação pertencente a $name',async({channel,item,revision})=>{
    const db=openDatabase(':memory:');databases.push(db)
    const graphic={...event,type:'GRAPHICS_OVERLAY' as const},work=vi.fn(async()=>{})
    await new SecondaryEventLedger(db.db,channel).execute({...context,itemId:item,revisionId:revision},graphic,'FIRE',work)
    work.mockClear()
    expect(new SecondaryEventLedger(db.db,'ch').fireFor(context,event.id)).toBeUndefined()
    expect(await new SecondaryEventLedger(db.db,'ch').execute(context,graphic,'FIRE',work,true)).toBe(false)
    expect(work).not.toHaveBeenCalled()
    expect(await db.db.select().from(secondaryEventRuns)).toHaveLength(1)
  })
  it('recompõe ocorrência legada nula apenas quando ambos os registros têm revisão nula',async()=>{
    const db=openDatabase(':memory:');databases.push(db)
    const ledger=new SecondaryEventLedger(db.db,'ch'),work=vi.fn(async()=>{}),graphic={...event,type:'GRAPHICS_OVERLAY' as const}
    await ledger.execute({...context,revisionId:null},graphic,'FIRE',work)
    await ledger.execute({...context,revisionId:null},graphic,'FIRE',work,true)
    expect(ledger.fireFor({...context,revisionId:null},event.id)).toMatchObject({state:'EXECUTED',revisionId:null})
    expect(ledger.fireFor(context,event.id)).toBeUndefined()
    expect(work).toHaveBeenCalledTimes(2)
    expect(await db.db.select().from(secondaryEventRuns)).toHaveLength(1)
  })
  it('recompõe somente SVG local já executado, sem duplicar registro nem repetir SCTE',async()=>{
    const db=openDatabase(':memory:');databases.push(db)
    const ledger=new SecondaryEventLedger(db.db,'ch'),work=vi.fn(async()=>{})
    const graphic={...event,type:'GRAPHICS_OVERLAY' as const}
    await ledger.execute(context,graphic,'FIRE',work)
    await ledger.execute(context,graphic,'FIRE',work,true)
    expect(work).toHaveBeenCalledTimes(2)
    expect(await db.db.select().from(secondaryEventRuns)).toHaveLength(1)
    const scte={...event,id:'scte',type:'SCTE_TRIGGER' as const}
    await ledger.execute(context,scte,'FIRE',work)
    await ledger.execute(context,scte,'FIRE',work,true)
    expect(work).toHaveBeenCalledTimes(3)
  })
  it('não restaura gráfico encerrado ou de resultado incerto',async()=>{
    const db=openDatabase(':memory:');databases.push(db)
    const ledger=new SecondaryEventLedger(db.db,'ch'),work=vi.fn(async()=>{}),graphic={...event,type:'GRAPHICS_OVERLAY' as const}
    await ledger.execute(context,graphic,'FIRE',work)
    await ledger.execute(context,graphic,'DISMISS',work)
    await ledger.execute(context,graphic,'FIRE',work,true)
    expect(work).toHaveBeenCalledTimes(2)
    await db.db.insert(secondaryEventRuns).values({id:'uncertain',channelId:'ch',...context,eventId:'other',mode:'FIRE',state:'FIRING',createdAt:'now'})
    await ledger.execute(context,{...graphic,id:'other'},'FIRE',work,true)
    expect(work).toHaveBeenCalledTimes(2)
  })
  it('persiste antes do efeito e impede duas execuções concorrentes/recuperação da mesma passagem',async ()=>{
    const db=openDatabase(':memory:');databases.push(db)
    const ledger=new SecondaryEventLedger(db.db,'ch')
    const work=vi.fn(async()=>{expect(db.sqlite.prepare('SELECT state FROM secondary_event_runs').get()).toEqual({state:'FIRING'})})
    await Promise.all([ledger.execute(context,event,'FIRE',work),ledger.execute(context,event,'FIRE',work)])
    await new SecondaryEventLedger(db.db,'ch').execute(context,event,'FIRE',work)
    expect(work).toHaveBeenCalledTimes(1)
    expect((await db.db.select().from(secondaryEventRuns))[0]).toMatchObject({state:'EXECUTED',revisionId:'rev-1',frames:125})
  })
  it('não repete comando incerto após queda, mas uma nova passagem pode disparar',async ()=>{
    const db=openDatabase(':memory:');databases.push(db)
    await db.db.insert(secondaryEventRuns).values({id:'uncertain',channelId:'ch',...context,eventId:event.id,mode:'FIRE',state:'FIRING',createdAt:'now'})
    const work=vi.fn(async()=>{})
    const ledger=new SecondaryEventLedger(db.db,'ch')
    expect(await ledger.execute(context,event,'FIRE',work)).toBe(false)
    expect(work).not.toHaveBeenCalled()
    expect(await ledger.execute({...context,executionId:'pass-2'},event,'FIRE',work)).toBe(true)
    expect(work).toHaveBeenCalledTimes(1)
  })
  it('falha fica auditável, não expõe erro/segredo externo e não se repete a cada tick',async ()=>{
    const db=openDatabase(':memory:');databases.push(db)
    const work=vi.fn(async()=>{throw new Error('PASSWORD=SEGREDO')})
    const ledger=new SecondaryEventLedger(db.db,'ch')
    expect(await ledger.execute(context,event,'FIRE',work)).toBe(false)
    expect(await ledger.execute(context,event,'FIRE',work)).toBe(false)
    expect(work).toHaveBeenCalledTimes(1)
    expect((await db.db.select().from(secondaryEventRuns))[0]?.state).toBe('FAILED')
    expect(JSON.stringify(db.sqlite.prepare('SELECT * FROM secondary_event_runs').all())).not.toContain('SEGREDO')
    expect(db.sqlite.prepare("SELECT component,severity FROM health_events").get()).toEqual({component:'SECONDARY_EVENT',severity:'CRITICAL'})
  })
})

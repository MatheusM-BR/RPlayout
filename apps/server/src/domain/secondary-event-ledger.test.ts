import { afterEach,describe,expect,it,vi } from 'vitest'
import { openDatabase } from '../db/client.js'
import { SecondaryEventLedger } from './secondary-event-ledger.js'
import { secondaryEventRuns } from '../db/schema.js'
import type { SecondaryEvent } from '@rplayout/protocol'
const databases:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for (const db of databases.splice(0)) db.sqlite.close()})
const event:SecondaryEvent={id:'event',rundownItemId:'item',targetLayer:'LOWER_THIRD',triggerMode:'OFFSET_FROM_START',offsetFrames:125,templateId:'',payload:{},enabled:true}
const context={executionId:'pass-1',itemId:'item',revisionId:'rev-1',frames:125}
describe('ledger de eventos secundários',()=>{
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

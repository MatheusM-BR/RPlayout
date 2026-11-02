import {afterEach,expect,it,vi} from 'vitest'
import {Graphics} from './graphics.js'
import {SecondaryEventLedger} from './secondary-event-ledger.js'
import {EngineCommandRejected} from './engine.js'
import {openDatabase} from '../db/client.js'
import type {Channel,SecondaryEvent} from '@rplayout/protocol'
import type {Transport} from './transport.js'
const databases:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.sqlite.close()})
const event:SecondaryEvent={id:'event',rundownItemId:'item',targetLayer:'LOWER_THIRD',triggerMode:'OFFSET_FROM_START',offsetFrames:0,templateId:'',payload:{name:'Çãó'},enabled:true,type:'GRAPHICS_OVERLAY'}
function setup(authorize:()=>void=()=>{}){
  const database=openDatabase(':memory:');databases.push(database)
  const ledger=new SecondaryEventLedger(database.db,'ch')
  const graphic=vi.fn(),graphicConfirmed=vi.fn(async(_svg:string|null,_fade:number,guard?:()=>void)=>{guard?.()})
  const transport={graphic,graphicConfirmed,state:()=>({mode:'NATIVE'})} as unknown as Transport
  const graphics=new Graphics({id:'ch',rate:{num:25,den:1}} as Channel,transport,{
    template:()=>undefined,
    execute:async(evt,mode,work)=>{await ledger.execute({executionId:'pass',itemId:'item',revisionId:'revision',frames:0},evt,mode,()=>work(authorize))},
  })
  graphics.scheduler.setEvents([event])
  return {database,graphics,graphic,graphicConfirmed,run:()=>database.sqlite.prepare('SELECT state FROM secondary_event_runs WHERE mode=\'FIRE\'').get()}
}
it('deixa automática persiste FIRING e aguarda ACK antes de EXECUTED e camada ativa',async()=>{
  const {graphics,graphicConfirmed,graphic,run}=setup();let confirm!:()=>void
  graphicConfirmed.mockImplementation(async(_s,_f,guard)=>{guard?.();await new Promise<void>(resolve=>{confirm=resolve})})
  const work=graphics.scheduler.tick('item',0,100)
  await vi.waitFor(()=>expect(graphicConfirmed).toHaveBeenCalledTimes(1))
  expect(run()).toEqual({state:'FIRING'});expect(graphics.getLayers().LOWER_THIRD.active).toBe(false)
  confirm();await work
  expect(run()).toEqual({state:'EXECUTED'});expect(graphics.getLayers().LOWER_THIRD.active).toBe(true);expect(graphic).not.toHaveBeenCalled()
})
it('timeout após envio permanece incerto e não restaura ou repete a deixa',async()=>{
  const {graphics,graphicConfirmed,run,database}=setup()
  graphicConfirmed.mockImplementation(async(_s,_f,guard)=>{guard?.();throw new Error('ACK_TIMEOUT_PRIVATE')})
  await graphics.scheduler.tick('item',0,100)
  expect(run()).toEqual({state:'FIRING'});expect(graphics.getLayers().LOWER_THIRD.active).toBe(false)
  graphics.scheduler.resetItem(null);await graphics.scheduler.tick('item',0,100)
  expect(graphicConfirmed).toHaveBeenCalledTimes(1)
  expect(database.sqlite.prepare('SELECT severity FROM health_events').get()).toEqual({severity:'CRITICAL'})
  expect(JSON.stringify(database.sqlite.prepare('SELECT * FROM secondary_event_runs').all())).not.toContain('PRIVATE')
})
it('recusa nativa fica FAILED, enquanto troca de execução antes do envio impede o comando',async()=>{
  const first=setup();first.graphicConfirmed.mockImplementation(async(_s,_f,guard)=>{guard?.();throw new EngineCommandRejected('REJECTED')})
  await first.graphics.scheduler.tick('item',0,100);expect(first.run()).toEqual({state:'FAILED'})
  const second=setup(()=>{throw new Error('ITEM_CHANGED')})
  await second.graphics.scheduler.tick('item',0,100)
  expect(second.run()).toEqual({state:'FAILED'});expect(second.graphicConfirmed).not.toHaveBeenCalled()
})
it('template selecionado ausente falha sem trocar a composição nem enviar gráfico genérico',async()=>{
  const {graphics,graphicConfirmed,graphic,run}=setup()
  graphics.scheduler.setEvents([{...event,templateId:'missing-published-template'}])
  await graphics.scheduler.tick('item',0,100)
  expect(run()).toEqual({state:'FAILED'})
  expect(graphicConfirmed).not.toHaveBeenCalled()
  expect(graphic).not.toHaveBeenCalled()
  expect(graphics.getLayers().LOWER_THIRD.active).toBe(false)
})

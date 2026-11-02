import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {ChannelRuntime} from '../app.js'
import {getChannel} from '../db/repo.js'
import {channels,rundowns,rundownItems,graphicTemplates,itemGraphics,secondaryEvents} from '../db/schema.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'
import {publishOperationalPlaylist} from './operational-playlist.js'
let database:ReturnType<typeof openDatabase>,runtime:ChannelRuntime
beforeEach(async()=>{
  database=openDatabase(':memory:');const now=new Date().toISOString()
  database.db.insert(channels).values({id:'ch',name:'CH',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  database.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade',date:'2026-10-10',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  database.db.insert(rundownItems).values({id:'live',rundownId:'rd',sortOrder:0,type:'LIVE',title:'Live',sourceRef:'ndi:CAM',durationOverride:500,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
  database.db.insert(graphicTemplates).values({id:'tpl',name:'Crédito',svg:'<svg width="640" height="360"><text>{{nome}}</text></svg>',fields:[],fadeMs:0,holdSeconds:1,createdAt:now}).run()
  database.db.insert(itemGraphics).values({id:'cue',itemId:'live',templateId:'tpl',values:{nome:'PUBLICADO Çãó'},atSeconds:0,createdAt:now}).run()
  runtime=new ChannelRuntime((await getChannel(database.db,'ch'))!,database.db,['null']);await runtime.load('rd');await runtime.transport.take('rd','live')
})
afterEach(()=>{vi.useRealTimers();runtime.close();database.sqlite.close();vi.restoreAllMocks()})
const terminal=()=>database.sqlite.prepare("SELECT kind FROM operator_decisions WHERE kind IN ('GRAPHIC_COMMAND_SIMULATED','GRAPHIC_COMMAND_REJECTED','GRAPHIC_COMMAND_UNCERTAIN')").all()
it('deixa legada é durável e identificada como simulação, sem repetir em outro ciclo',async()=>{
  const show=vi.spyOn(runtime.graphics,'showConfirmed')
  expect(runtime.fireDueGraphics()).toBe(true)
  expect(runtime.fireDueGraphics()).toBe(false)
  await vi.waitFor(()=>expect(terminal()).toHaveLength(1))
  expect(show).toHaveBeenCalledTimes(1);expect(terminal()).toEqual([{kind:'GRAPHIC_COMMAND_SIMULATED'}])
  expect(runtime.graphics.onAir()?.values.nome).toBe('PUBLICADO Çãó')
  runtime.fireDueGraphics();expect(show).toHaveBeenCalledTimes(1)
})
it('emergência iniciada antes da fila impede deixa antiga e conserva composição',async()=>{
  runtime.fireDueGraphics();runtime.emergencyOverlay=true
  await vi.waitFor(()=>expect(terminal()).toEqual([{kind:'GRAPHIC_COMMAND_REJECTED'}]))
  expect(runtime.graphics.onAir()).toBeNull()
})
it('expiração mantém camada enquanto pendente e grava retirada, sem repetir',async()=>{
  runtime.fireDueGraphics();await vi.waitFor(()=>expect(terminal()).toHaveLength(1))
  const now=Date.now();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now+2000)
  expect(runtime.expireGraphics()).toBe(true)
  expect(runtime.graphics.getLayers().LOWER_THIRD.active).toBe(true)
  expect(runtime.expireGraphics()).toBe(false)
  await vi.waitFor(()=>expect(terminal()).toHaveLength(2))
  expect(runtime.graphics.getLayers().LOWER_THIRD.active).toBe(false)
  expect(runtime.expireGraphics()).toBe(false)
})
it('expiração não retira composição substituída enquanto aguardava fila',async()=>{
  runtime.fireDueGraphics();await vi.waitFor(()=>expect(terminal()).toHaveLength(1))
  const now=Date.now();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now+2000)
  runtime.expireGraphics()
  runtime.graphics.triggerLayer('LOWER_THIRD','SHOW',{name:'Substituição'})
  await vi.waitFor(()=>expect(terminal()).toHaveLength(2))
  expect(terminal()).toContainEqual({kind:'GRAPHIC_COMMAND_REJECTED'})
  expect(runtime.graphics.getLayers().LOWER_THIRD.name).toBe('Substituição')
  expect(runtime.graphics.getLayers().LOWER_THIRD.active).toBe(true)
})
async function secondary(durationFrames?:number){
  database.db.delete(itemGraphics).run()
  const event={id:'secondary',rundownItemId:'live',targetLayer:'LOWER_THIRD' as const,triggerMode:'OFFSET_FROM_START' as const,offsetFrames:0,templateId:'tpl',payload:{nome:'SECUNDÁRIO'},enabled:true,type:'GRAPHICS_OVERLAY' as const,durationFrames}
  const now=new Date().toISOString()
  database.db.insert(secondaryEvents).values({id:event.id,channelId:'ch',itemId:'live',definition:event,createdAt:now,updatedAt:now}).run()
  await publishOperationalPlaylist(database.db,runtime.channel,'rd','editor')
  await runtime.load('rd');return event
}
it('resultado manual incerto adia grafismo secundário sem consumir deixa, conferência libera o evento',async()=>{
  await secondary();const ledger=new GraphicCommandLedger(database.db,'ch')
  await expect(ledger.execute({key:'manual-uncertain',actorId:'operator',actorName:'Operator',native:true,selection:{action:'SHOW'}},()=>{},async send=>{send();throw new Error('ACK_TIMEOUT')})).rejects.toThrow()
  const show=vi.spyOn(runtime.graphics,'triggerLayerConfirmed')
  expect(runtime.fireDueGraphics()).toBe(false)
  expect(database.sqlite.prepare("SELECT state FROM secondary_event_runs WHERE event_id='secondary'").get()).toBeUndefined()
  expect(show).not.toHaveBeenCalled();expect(ledger.list()).toHaveLength(1)
  expect(ledger.list()[0]!.state).toBe('UNCERTAIN')
  const receipt=ledger.list()[0]!
  ledger.review(receipt.id,receipt.reviewToken,'Imagem conferida, sem reenvio','admin',()=>{})
  runtime.fireDueGraphics()
  await vi.waitFor(()=>expect(database.sqlite.prepare("SELECT state FROM secondary_event_runs WHERE event_id='secondary'").get()).toEqual({state:'EXECUTED'}))
  expect(show).toHaveBeenCalledTimes(1)
})
it('timeout secundário persiste incerteza compartilhada e impede novo comando manual',async()=>{
  await secondary()
  const original=runtime.transport.state.bind(runtime.transport)
  vi.spyOn(runtime.transport,'state').mockImplementation(()=>({...original(),mode:'NATIVE'}))
  Object.assign(runtime.transport,{graphicConfirmed:vi.fn(async(_s:unknown,_f:unknown,guard?:()=>void)=>{guard?.();throw new Error('ACK_TIMEOUT')})})
  runtime.fireDueGraphics()
  const ledger=new GraphicCommandLedger(database.db,'ch')
  await vi.waitFor(()=>expect(ledger.list()[0]?.state).toBe('UNCERTAIN'))
  await vi.waitFor(()=>expect(database.sqlite.prepare("SELECT state FROM secondary_event_runs WHERE event_id='secondary'").get()).toEqual({state:'FIRING'}))
  const work=vi.fn();await expect(ledger.execute({key:'new-manual-command',actorId:'operator',actorName:'Operator',native:true,selection:{action:'HIDE'}},()=>{},work)).rejects.toThrow()
  expect(work).not.toHaveBeenCalled();expect(runtime.graphics.getLayers().LOWER_THIRD.active).toBe(false)
})
it('evento secundário e deixa legada no mesmo instante executam em ciclos separados sem perder a deixa',async()=>{
  await secondary()
  database.db.insert(itemGraphics).values({id:'legacy-second',itemId:'live',templateId:'tpl',values:{nome:'DEIXA LEGADA'},atSeconds:0,createdAt:new Date().toISOString()}).run()
  await publishOperationalPlaylist(database.db,runtime.channel,'rd','editor');await runtime.load('rd')
  const show=vi.spyOn(runtime.graphics,'showConfirmed')
  expect(runtime.fireDueGraphics()).toBe(false)
  await vi.waitFor(()=>expect(terminal()).toHaveLength(1))
  expect(show).not.toHaveBeenCalled()
  expect(runtime.fireDueGraphics()).toBe(true)
  await vi.waitFor(()=>expect(terminal()).toHaveLength(2))
  expect(show).toHaveBeenCalledTimes(1)
  expect(runtime.graphics.onAir()?.values.nome).toBe('DEIXA LEGADA')
})
it('deixa atrasada usa somente os quadros restantes da janela publicada',async()=>{
  await secondary(75)
  const state=runtime.transport.state()
  vi.spyOn(runtime.transport,'state').mockReturnValue({...state,onAir:{...state.onAir!,elapsed:50}})
  const show=vi.spyOn(runtime.graphics,'triggerLayerConfirmed')
  runtime.fireDueGraphics()
  await vi.waitFor(()=>expect(terminal()).toHaveLength(1))
  expect(show.mock.calls[0]![2].durationFrames).toBe(25)
})
it('deixa já encerrada não aparece nem retira grafismo manual ao descartar',async()=>{
  await secondary(25)
  await runtime.graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{name:'Manual preservado'},()=>{})
  const state=runtime.transport.state()
  vi.spyOn(runtime.transport,'state').mockReturnValue({...state,onAir:{...state.onAir!,elapsed:50}})
  const trigger=vi.spyOn(runtime.graphics,'triggerLayerConfirmed')
  runtime.fireDueGraphics()
  await vi.waitFor(()=>expect(database.sqlite.prepare("SELECT state FROM secondary_event_runs WHERE mode='DISMISS'").get()).toEqual({state:'FAILED'}))
  expect(trigger).not.toHaveBeenCalled();expect(runtime.graphics.onAir()?.name).toBe('Manual preservado')
  expect(database.sqlite.prepare("SELECT state FROM secondary_event_runs WHERE mode='FIRE'").get()).toEqual({state:'FAILED'})
})
it('descarte de evento confirmado não retira substituição manual na mesma camada',async()=>{
  await secondary(25)
  const original=runtime.transport.state();let elapsed=0
  vi.spyOn(runtime.transport,'state').mockImplementation(()=>({...original,onAir:{...original.onAir!,elapsed}}))
  runtime.fireDueGraphics();await vi.waitFor(()=>expect(terminal()).toHaveLength(1))
  await runtime.graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{name:'Manual posterior'},()=>{})
  elapsed=50;runtime.fireDueGraphics()
  await vi.waitFor(()=>expect(database.sqlite.prepare("SELECT state FROM secondary_event_runs WHERE mode='DISMISS'").get()).toEqual({state:'FAILED'}))
  expect(runtime.graphics.onAir()?.name).toBe('Manual posterior')
})
it('outra camada manual não impede descarte da camada ainda pertencente ao evento',async()=>{
  await secondary(25)
  const original=runtime.transport.state();let elapsed=0
  vi.spyOn(runtime.transport,'state').mockImplementation(()=>({...original,onAir:{...original.onAir!,elapsed}}))
  runtime.fireDueGraphics();await vi.waitFor(()=>expect(terminal()).toHaveLength(1))
  await runtime.graphics.triggerLayerConfirmed('STATION_LOGO','SHOW',{name:'Marca preservada'},()=>{})
  elapsed=50;runtime.fireDueGraphics()
  await vi.waitFor(()=>expect(database.sqlite.prepare("SELECT state FROM secondary_event_runs WHERE mode='DISMISS'").get()).toEqual({state:'EXECUTED'}))
  expect(runtime.graphics.getLayers().LOWER_THIRD.active).toBe(false)
  expect(runtime.graphics.getLayers().STATION_LOGO.active).toBe(true)
})

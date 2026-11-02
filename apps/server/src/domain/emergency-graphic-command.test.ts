import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {ChannelRuntime} from '../app.js'
import {EngineTransport} from './engine.js'
import {Graphics} from './graphics.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'
import {getChannel} from '../db/repo.js'
import {channels,graphicTemplates,rundowns} from '../db/schema.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:''}))
let database:ReturnType<typeof openDatabase>,runtime:ChannelRuntime,ack:ReturnType<typeof vi.fn>,ledger:GraphicCommandLedger
beforeEach(async()=>{
  database=openDatabase(':memory:');const now=new Date().toISOString()
  database.db.insert(channels).values({id:'ch',name:'CH',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,slateTemplateId:'slate',createdAt:now}).run()
  database.db.insert(graphicTemplates).values({id:'slate',channelId:'ch',name:'Slate',svg:'<g><text>Çãó</text></g>',fields:[],holdSeconds:null,fadeMs:0,createdAt:now}).run()
  database.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade',date:'2026-10-10',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  const channel=(await getChannel(database.db,'ch'))!
  runtime=new ChannelRuntime(channel,database.db,['null'])
  // Contract fixture only: never starts a native process or proves output.
  ack=vi.fn(async(_s:string|null,_f:number,guard?:()=>void)=>{guard?.()})
  const transport=Object.assign(Object.create(EngineTransport.prototype),{state:()=>({mode:'NATIVE',onAir:null}),graphicConfirmed:ack,close:vi.fn()}) as EngineTransport
  Object.defineProperty(runtime,'transport',{value:transport})
  Object.defineProperty(runtime,'graphics',{value:new Graphics(channel,transport)})
  ledger=new GraphicCommandLedger(database.db,'ch')
  await runtime.load('rd')
})
afterEach(()=>{runtime.close();database.sqlite.close();vi.restoreAllMocks()})
it('emergência persiste envio e só fica ativa após ACK, com fundo opaco mesmo em template g',async()=>{
  let confirm!:()=>void
  ack.mockImplementation(async(_s,_f,guard)=>{guard?.();await new Promise<void>(resolve=>{confirm=resolve})})
  const work=runtime.setEmergencySlate(true,{key:'emergency-show'})
  await vi.waitFor(()=>expect(ledger.list()[0]?.state).toBe('SENDING'))
  expect(runtime.emergencyOverlay).toBe(false);expect(runtime.emergencyCommandPending).toBe(true)
  expect(ack.mock.calls[0]![0]).toContain('<rect width="1920" height="1080" fill="black"/>')
  confirm();expect((await work).state).toBe('CONFIRMED');expect(runtime.emergencyOverlay).toBe(true)
})
it('RESET confirmado limpa também estado das camadas; replay antigo não troca estado nem envia',async()=>{
  await runtime.graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{name:'Antes'},()=>{})
  await runtime.setEmergencySlate(true,{key:'emergency-show'})
  await runtime.setEmergencySlate(false,{key:'emergency-reset'})
  expect(runtime.emergencyOverlay).toBe(false);expect(runtime.graphics.getLayers().LOWER_THIRD.active).toBe(false)
  const count=ack.mock.calls.length
  expect((await runtime.setEmergencySlate(true,{key:'emergency-show'})).replayed).toBe(true)
  expect(runtime.emergencyOverlay).toBe(false);expect(ack).toHaveBeenCalledTimes(count)
})
it('timeout conserva estado anterior e bloqueia outra intervenção até conferência',async()=>{
  ack.mockImplementation(async(_s,_f,guard)=>{guard?.();throw new Error('ACK_TIMEOUT')})
  await expect(runtime.setEmergencySlate(true,{key:'emergency-timeout'})).rejects.toMatchObject({payload:{graphicCommand:{state:'UNCERTAIN'}}})
  expect(runtime.emergencyOverlay).toBe(false);expect(runtime.emergencyCommandPending).toBe(false)
  await expect(runtime.setEmergencySlate(false,{key:'emergency-another'})).rejects.toThrow()
  expect(ack).toHaveBeenCalledTimes(1)
})
it('autorização revogada dentro da fila não envia nem ativa emergência',async()=>{
  let permitted=true
  ack.mockImplementation(async(_s,_f,guard)=>{permitted=false;guard?.()})
  await expect(runtime.setEmergencySlate(true,{key:'emergency-revoked',authorize:()=>{if(!permitted)throw new Error('REVOKED')}})).rejects.toThrow()
  expect(ledger.list()[0]!.state).toBe('REJECTED');expect(runtime.emergencyOverlay).toBe(false)
})
it('apresentação idle aguarda ACK e retirada após desconfigurar também é durável',async()=>{
  let confirm!:()=>void
  ack.mockImplementationOnce(async(_s,_f,guard)=>{guard?.();await new Promise<void>(resolve=>{confirm=resolve})})
  runtime.followSlate()
  await vi.waitFor(()=>expect(ledger.list()[0]?.state).toBe('SENDING'))
  expect(runtime.graphics.onAir()).toBeNull()
  runtime.followSlate();expect(ack).toHaveBeenCalledTimes(1)
  confirm();await vi.waitFor(()=>expect(ledger.list()[0]?.state).toBe('CONFIRMED'))
  runtime.setSlate(null)
  await vi.waitFor(()=>expect(ledger.list().filter(row=>row.state==='CONFIRMED')).toHaveLength(2))
  expect(runtime.graphics.onAir()).toBeNull();expect(ack.mock.calls[1]![0]).toBeNull()
  runtime.setSlate('slate')
  await vi.waitFor(()=>expect(ledger.list().filter(row=>row.state==='CONFIRMED')).toHaveLength(3))
  expect(runtime.graphics.onAir()?.templateId).toBe('slate')
})
it('idle não substitui emergência incerta nem tenta novamente por ciclo',async()=>{
  ack.mockImplementation(async(_s,_f,guard)=>{guard?.();throw new Error('ACK_TIMEOUT')})
  await expect(runtime.setEmergencySlate(true,{key:'uncertain-emergency'})).rejects.toThrow()
  runtime.followSlate();runtime.followSlate()
  expect(ack).toHaveBeenCalledTimes(1);expect(ledger.list()).toHaveLength(1)
})
it('idle não retira grafismo manual que substituiu sua composição',async()=>{
  runtime.followSlate();await vi.waitFor(()=>expect(ledger.list()[0]?.state).toBe('CONFIRMED'))
  await runtime.graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{name:'Manual'},()=>{})
  const count=ack.mock.calls.length
  runtime.setSlate(null);runtime.followSlate()
  expect(ack).toHaveBeenCalledTimes(count);expect(runtime.graphics.onAir()?.name).toBe('Manual')
})
it('programa que entra enquanto idle aguarda fila impede apresentação antiga',async()=>{
  runtime.followSlate()
  vi.spyOn(runtime.transport,'state').mockReturnValue({mode:'NATIVE',onAir:{itemId:'vt'}} as ReturnType<typeof runtime.transport.state>)
  await vi.waitFor(()=>expect(ledger.list()[0]?.state).toBe('REJECTED'))
  expect(ack).not.toHaveBeenCalled();expect(runtime.graphics.onAir()).toBeNull()
})
it('retirada idle conserva grafismo manual de outra camada',async()=>{
  runtime.followSlate();await vi.waitFor(()=>expect(ledger.list()[0]?.state).toBe('CONFIRMED'))
  await runtime.graphics.triggerLayerConfirmed('STATION_LOGO','SHOW',{name:'Marca manual'},()=>{})
  runtime.setSlate(null)
  await vi.waitFor(()=>expect(ledger.list().filter(row=>row.state==='CONFIRMED')).toHaveLength(2))
  expect(runtime.graphics.getLayers().LOWER_THIRD.active).toBe(false)
  expect(runtime.graphics.getLayers().STATION_LOGO.active).toBe(true)
  expect(runtime.graphics.onAir()?.name).toBe('Marca manual')
})

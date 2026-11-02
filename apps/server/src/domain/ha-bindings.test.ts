import {afterEach,beforeEach,it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {HaBindings,type HaBindingInventory} from './ha-bindings.js'
import type {HaSnapshot} from './ha-replication.js'
let db:Database.Database,bindings:HaBindings
let state:{sequence:number;digest:string;snapshot:HaSnapshot}
const inventory:HaBindingInventory={inputs:[{key:'local-ndi',label:'ESTÚDIO-ÇÃO',family:'NDI',reference:'ndi:LOCAL-ÇÃO'}],sdiOutputs:[{key:'out-0',label:'Saída SDI 0',family:'SDI',reference:'sdi:0'}]}
beforeEach(()=>{
  db=new Database(':memory:')
  state={sequence:1,digest:'wire-1',snapshot:{version:1,capturedAt:new Date().toISOString(),asRun:[],journals:[],channels:[{channelId:'ch',configuration:{channel:{id:'ch',name:'Canal'},revision:1,outputs:[{id:'srt',name:'Destino',kind:'SRT',target:'srt://primary:9000',enabled:true}]},checkpoint:null,transport:null,blockers:{},revisions:[{id:'rev',active:true,payload:{version:1,rundown:{id:'rd'},items:[{id:'live',title:'Ao vivo',sourceRef:'ndi:PRIMARY'}],schedule:{}}}]}]}}
  bindings=new HaBindings(db,'cluster:standby',()=>state)
})
afterEach(()=>db.close())
function request(){const view=bindings.review('ch',inventory);return {requestId:randomUUID(),channelId:'ch',sequence:view.sequence,basePlanId:view.basePlanId,reviewToken:view.reviewToken,inputs:[{sourceKey:view.inputs[0]!.sourceKey,localKey:'local-ndi'}],outputs:[{outputId:'srt',disposition:'LOCAL' as const,localTarget:'srt://local:9000?passphrase=PRIVATE_BINDING_SECRET'}]}}
it('telemetria nova não invalida configuração; registro permanece cifrado e não promove',()=>{
  const body=request();state={...state,sequence:2,digest:'wire-2',snapshot:{...state.snapshot,capturedAt:new Date().toISOString()}}
  const view=bindings.save(body,inventory,'admin',()=>{})
  expect(view.saved?.stale).toBe(false);expect(view.promotionReady).toBe(false);expect(view.physicalSignalValidated).toBe(false)
  const payload=(db.prepare('SELECT payload FROM ha_local_binding_plans').get() as {payload:string}).payload
  expect(payload).not.toContain('PRIVATE_BINDING_SECRET');expect(payload).not.toContain('LOCAL-ÇÃO')
  expect(view.saved?.outputs[0]?.target).not.toContain('PRIVATE_BINDING_SECRET')
})
it('mudança de edição, inventário ou outro plano recusa base antiga sem sobrescrever',()=>{
  const body=request()
  expect(()=>bindings.save(body,{...inventory,inputs:[{...inventory.inputs[0]!,reference:'ndi:CHANGED'}]},'admin',()=>{})).toThrow('mudou')
  state.snapshot.channels[0]!.configuration.revision=2
  expect(()=>bindings.save(body,inventory,'admin',()=>{})).toThrow('mudou')
  const fresh=request();bindings.save(fresh,inventory,'admin',()=>{})
  expect(()=>bindings.save({...fresh,requestId:randomUUID()},inventory,'admin',()=>{})).toThrow('mudou')
})
it('requisição repetida consulta; outra seleção com a mesma identidade é recusada',()=>{
  const body=request();bindings.save(body,inventory,'admin',()=>{});bindings.save(body,inventory,'admin',()=>{})
  expect(db.prepare('SELECT count(*) n FROM ha_local_binding_plans').get()).toEqual({n:1})
  expect(()=>bindings.save({...body,outputs:[{outputId:'srt',disposition:'DISABLED',reason:'maintenance'}]},inventory,'admin',()=>{})).toThrow('outro plano')
  expect(()=>db.prepare('DELETE FROM ha_local_binding_plans').run()).toThrow('cannot be deleted')
})
it('sem entrada compatível ou saída explícita não grava plano incompleto',()=>{
  const body=request()
  expect(()=>bindings.save({...body,inputs:[]},inventory,'admin',()=>{})).toThrow('exatamente uma vez')
  expect(()=>bindings.save({...body,outputs:[{outputId:'srt',disposition:'DISABLED'}]},inventory,'admin',()=>{})).toThrow('motivo')
  expect(()=>bindings.save({...body,outputs:[{outputId:'srt',disposition:'LOCAL',localTarget:'srt://local:9000?passphrase=REDACTED'}]},inventory,'admin',()=>{})).toThrow('redigido')
  expect(db.prepare('SELECT count(*) n FROM ha_local_binding_plans').get()).toEqual({n:0})
})

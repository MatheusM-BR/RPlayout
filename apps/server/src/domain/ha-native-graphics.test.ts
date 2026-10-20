import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {captureGraphicDisplay,graphicLayers,type GraphicDisplaySnapshot} from './graphic-composition.js'
import {prepareHaNativeGraphics} from './ha-native-graphics.js'
import type {HaRecovery} from './ha-recovery.js'
import type {App} from '../app.js'
import type {HaExecutionAdmission} from './ha-execution-admission.js'
import type {EngineTransport} from './engine.js'
import type {Channel} from '@rplayout/protocol'
// NOT_RUN: mocked lifecycle/persistence; no engine, native ACK or physical proof.
let expired=false,expireCalls=0
const resetOccurrence=vi.fn()
function display():GraphicDisplaySnapshot{return {version:1,layers:Object.fromEntries(graphicLayers.map(layer=>[layer,{layer,active:false}])) as GraphicDisplaySnapshot['layers'],current:null,currentLayer:null,deadlines:{},versions:{},owners:{},emergencySvg:null}}
vi.mock('./graphics.js',()=>({Graphics:class{
  scheduler={setEvents:()=>{},resetItem:resetOccurrence,hasDue:()=>false}
  async restoreDisplayConfirmed(value:GraphicDisplaySnapshot,authorize:()=>void,send:()=>void){authorize();send();captureGraphicDisplay(value)}
  hasExpiredLayers(){return expired}
  async expireConfirmed(authorize:()=>void,send:()=>void){authorize();send();expireCalls++;expired=false;captureGraphicDisplay(display());return true}
}}))
beforeEach(()=>{vi.useFakeTimers();expired=false;expireCalls=0;resetOccurrence.mockClear()})
afterEach(()=>vi.useRealTimers())
function fixture(){
  let held=true,refuse=false
  const rows:Array<Record<string,unknown>>=[],close=vi.fn()
  const admission={assertHeld:()=>{},copy:{id:'promotion',preparationId:'preparation'}} as unknown as HaExecutionAdmission
  const app={haExecutionAdmission:admission,db:{insert:()=>({values:(value:Record<string,unknown>)=>({run:()=>rows.push(value)})})}} as unknown as App
  const transport={fenceBinding:()=>({ownerId:'owner',term:9}),health:()=>({ready:true,programAdmission:{held}}),close} as unknown as EngineTransport
  const candidate={candidate:{graphicRecovery:{status:'CLEAR',sourceReceiptId:null,display:display()}}} as unknown as Awaited<ReturnType<HaRecovery['activationCandidate']>>
  const authorize=vi.fn(async()=>{if(refuse)throw new Error('authority lost')})
  return {candidate,app,admission,transport,authorize,rows,close,release:()=>{held=false},refuse:()=>{refuse=true}}
}
it('maintenance cannot start while program outputs remain held',async()=>{
  const f=fixture(),prepared=await prepareHaNativeGraphics(f.candidate,f.app,f.admission,f.transport,{id:'ch'} as Channel,f.authorize)
  await expect(prepared.startMaintenance()).rejects.toThrow('geração')
  await prepared.stopMaintenance()
})
it('expires once with a new local receipt and does no cadence authorization when nothing is due',async()=>{
  const f=fixture(),prepared=await prepareHaNativeGraphics(f.candidate,f.app,f.admission,f.transport,{id:'ch'} as Channel,f.authorize)
  f.release();await prepared.startMaintenance();const calls=f.authorize.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000);expect(f.authorize).toHaveBeenCalledTimes(calls)
  expired=true;await vi.advanceTimersByTimeAsync(250)
  expect(expireCalls).toBe(1)
  expect(f.rows.some(row=>row.kind==='HA_GRAPHIC_EXPIRATION_CONFIRMED')).toBe(true)
  await vi.advanceTimersByTimeAsync(1000);expect(expireCalls).toBe(1)
  await prepared.stopMaintenance();expect(f.close).not.toHaveBeenCalled()
})
it('authority loss closes only the supplied owned transport and refuses maintenance restart',async()=>{
  const f=fixture(),prepared=await prepareHaNativeGraphics(f.candidate,f.app,f.admission,f.transport,{id:'ch'} as Channel,f.authorize)
  f.release();await prepared.startMaintenance();f.refuse();expired=true
  await vi.advanceTimersByTimeAsync(250)
  expect(f.close).toHaveBeenCalledTimes(1);expect(expireCalls).toBe(0)
  await expect(prepared.startMaintenance()).rejects.toThrow('incerta')
  await prepared.stopMaintenance()
})
it('admits a fresh decoder occurrence, without reapplying foreign phases — NOT_RUN',async()=>{
  const f=fixture(),candidate=f.candidate as unknown as {candidate:Record<string,unknown>}
  candidate.candidate.localExecutionRevisionId='edition'
  candidate.candidate.revisions=[{localRevisionId:'edition',payload:{items:[{id:'next'}],secondaryEvents:[]}}]
  const transport=f.transport as unknown as {programDecoderBinding:()=>{itemId:string;decoderId:number};state:()=>{onAir:null}}
  transport.programDecoderBinding=()=>({itemId:'next',decoderId:21});transport.state=()=>({onAir:null})
  const prepared=await prepareHaNativeGraphics(f.candidate,f.app,f.admission,f.transport,{id:'ch'} as Channel,f.authorize,'first-execution')
  f.release();await prepared.startMaintenance()
  await prepared.admitOccurrence({itemId:'next',decoderId:21,duration:100,executionId:'new-execution'})
  expect(resetOccurrence).toHaveBeenCalledWith('next')
  expect(f.rows.find(row=>row.kind==='HA_OCCURRENCE_ADMITTED')?.payload).toMatchObject({executionId:'new-execution',itemId:'next',decoderId:21,foreignRunsReplayed:false})
  await prepared.admitOccurrence({itemId:'next',decoderId:21,duration:100,executionId:'new-execution'})
  expect(resetOccurrence).toHaveBeenCalledTimes(1)
  await expect(prepared.admitOccurrence({itemId:'next',decoderId:21,duration:100,executionId:'changed-execution'})).rejects.toThrow('reutilizado')
  await prepared.stopMaintenance()
})

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { framesSinceMidnight,DEFAULT_QC_PROFILE, type Channel } from '@rplayout/protocol'
import type { LivePriorityEvent } from './priority-live.js'
import { EngineTransport,EngineCommandRejected } from './engine.js'
import {createLiveProgramBinding} from './live-program-binding.js'
import {nativeSourceConnectionSignature} from './native-live-replacement-ledger.js'
import type {NativeReplacementPersistence} from './engine.js'
import type {NativeLiveReplacementRequest,NativeLiveReplacementReceipt} from './native-live-replacement.js'
import type { RundownView } from './plan.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const channel = { id: 'channel', name: 'Test', width: 320, height: 180,
  rate: { num: 25, den: 1 }, scan: 'PROGRESSIVE', fieldOrder: 'TFF', ceilingDbtp: -1 } as Channel
let directory: string
let transport: EngineTransport
let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
let commands: Array<{ id: number; cmd: string; item?: { itemId: string; path: string;trimIn?:number;trimOut?:number }; bus?: 'pgm' | 'pvw'; frames?: number; itemId?:string|null;decoderId?:number|null;ownerId?:string;term?:number; on?:boolean }>
let onAir: string | undefined
let armed: string | undefined
let rejectLoad: string | null
let holdLoad: boolean
let holdLiveTake: boolean
let rejectTakeAck: boolean
let holdFileTake: boolean
let holdPreview: boolean
let loadDecoderId:number|undefined
let priorityEvents: LivePriorityEvent[]

function event(value: object): void { child.stdout.write(JSON.stringify(value) + '\n') }
function ack(id: number, ok = true): void { event({ event: 'ack', id, ok, error: ok ? undefined : 'decoder recusou o arquivo' }) }

describe('programHold private transport receipt contract',()=>{
  it.each(['HELD','UNCONFIRMED'] as const)('watchdog never reclassifies %s as normal playback',status=>{
    start(view([]));event({event:'ready',channelId:channel.id,decoderIdentity:true})
    event({event:'state',onAir:'vt',onAirDecoderId:7,programHold:{itemId:'vt',decoderId:7,status,frames:status==='HELD'?61:null}})
    event({event:'position',itemId:'vt',decoderId:7,frames:61,duration:200})
    const internal=transport as unknown as {rundownId:string;recoveryCursor:{itemId:string;frames:number;programHold:string}|null;restore():void}
    internal.rundownId='grade';child.emit('exit',null,'SIGKILL')
    expect(internal.recoveryCursor).toMatchObject({itemId:'vt',frames:61,programHold:status})
    internal.restore();expect(commands).toHaveLength(0)
    expect(transport.health().error).toContain('retomada PLAYING bloqueada')
  })
  it('recoverHeld verifies local SHA/crop and mounts only after native receipt, without TAKE callback',async()=>{
    const file=join(directory,'held.mkv');writeFileSync(file,'local fixture bytes')
    const value=heldView(file),confirmed=vi.fn();start(value,confirmed)
    event({event:'ready',channelId:channel.id,decoderIdentity:true});child.stdin.removeAllListeners('data')
    child.stdin.on('data',(data:Buffer)=>{
      const command=JSON.parse(data.toString());commands.push(command)
      queueMicrotask(()=>{
        event({event:'programHold',id:command.id,itemId:'0',decoderId:8,held:true,frames:61})
        event({event:'state',onAir:'0',onAirDecoderId:8,programHold:{itemId:'0',decoderId:8,status:'HELD',frames:61}})
        event({event:'ack',id:command.id,ok:true,decoderId:8})
      })
    })
    const cut={in:25,out:200,contentHash:value.items[0]!.asset!.contentHash!}
    await expect(transport.recoverHeld('grade','0',61,cut)).resolves.toEqual({itemId:'0',decoderId:8,frames:61})
    expect(commands.map(command=>command.cmd)).toEqual(['restoreProgramHold'])
    expect(commands[0]?.item).toMatchObject({trimIn:25,trimOut:200,startOffsetFrames:61})
    expect(transport.state()).toMatchObject({playing:false,onAir:{itemId:'0',elapsed:61},programTrim:cut})
    expect(confirmed).not.toHaveBeenCalled()
  })
  it('recoverHeld refuses altered file before native command',async()=>{
    const file=join(directory,'held.mkv');writeFileSync(file,'original')
    const value=heldView(file);start(value);writeFileSync(file,'changed')
    await expect(transport.recoverHeld('grade','0',61,{in:25,out:200,contentHash:value.items[0]!.asset!.contentHash!})).rejects.toThrow('versão publicada')
    expect(commands).toHaveLength(0)
  })
  it('recoverHeld preserves uncertainty when file changes during native preparation',async()=>{
    const file=join(directory,'held.mkv');writeFileSync(file,'original')
    const value=heldView(file);const confirmed=vi.fn();start(value,confirmed)
    event({event:'ready',channelId:channel.id,decoderIdentity:true});child.stdin.removeAllListeners('data')
    child.stdin.on('data',(data:Buffer)=>{
      const command=JSON.parse(data.toString());commands.push(command)
      if(command.cmd!=='restoreProgramHold')return
      queueMicrotask(()=>{
        writeFileSync(file,'changed during native restoration')
        event({event:'programHold',id:command.id,itemId:'0',decoderId:8,held:true,frames:61})
        event({event:'state',onAir:'0',onAirDecoderId:8,programHold:{itemId:'0',decoderId:8,status:'HELD',frames:61}})
        event({event:'ack',id:command.id,ok:true,decoderId:8})
      })
    })
    await expect(transport.recoverHeld('grade','0',61,{in:25,out:200,contentHash:value.items[0]!.asset!.contentHash!})).rejects.toThrow('versão publicada')
    expect(commands.map(command=>command.cmd)).toEqual(['restoreProgramHold'])
    expect(transport.state().programTrim).toBeNull();expect(confirmed).not.toHaveBeenCalled()
    expect(transport.health().ready).toBe(false)
  })
  it.each(['confirmed','missing','wrong-cursor','missing-state','wrong-state-decoder','wrong-state-mode','wrong-ack'] as const)('restoreProgramHold %s receipt',async(mode)=>{
    start(view([]));event({event:'ready',channelId:channel.id,decoderIdentity:true});child.stdin.removeAllListeners('data')
    child.stdin.on('data',(data:Buffer)=>{
      const command=JSON.parse(data.toString());commands.push(command)
      queueMicrotask(()=>{
        if(mode!=='missing')event({event:'programHold',id:command.id,itemId:'vt',decoderId:8,held:true,frames:mode==='wrong-cursor'?60:61})
        if(mode!=='missing-state')event({event:'state',onAir:'vt',onAirDecoderId:mode==='wrong-state-decoder'?9:8,programHold:{itemId:'vt',decoderId:mode==='wrong-state-decoder'?9:8,status:mode==='wrong-state-mode'?'RUNNING':'HELD',frames:mode==='wrong-state-mode'?null:61}})
        event({event:'ack',id:command.id,ok:true,decoderId:mode==='wrong-ack'?9:8})
      })
    })
    const pending=(transport as unknown as {request(command:Record<string,unknown>):Promise<void>}).request({cmd:'restoreProgramHold',item:{itemId:'vt',path:'fixture.mkv',trimIn:25,trimOut:200,startOffsetFrames:61}})
    if(mode==='confirmed')await expect(pending).resolves.toBeUndefined()
    else await expect(pending).rejects.toThrow('resultado inconclusivo')
    expect(commands.map(command=>command.cmd)).toEqual(['restoreProgramHold'])
  })
  it('held or inconclusive telemetry cannot become a playing checkpoint',()=>{
    start(view([]));event({event:'ready',channelId:channel.id,decoderIdentity:true})
    for(const status of ['HELD','UNCONFIRMED','RUNNING']){
      event({event:'state',onAir:'vt',onAirDecoderId:7,programHold:{itemId:'vt',decoderId:7,status,frames:status==='HELD'?36:null}})
      event({event:'position',itemId:'vt',decoderId:7,frames:36,duration:200})
      expect(transport.health().programHold?.status).toBe(status)
      if(status==='RUNNING')expect(transport.programPositionEvidence()?.frames).toBe(36)
      else expect(transport.programPositionEvidence()).toBeNull()
      event({event:'state',onAir:'vt',onAirDecoderId:7})
      expect(transport.health().programHold?.status).toBe(status)
      if(status!=='RUNNING')expect(transport.programPositionEvidence()).toBeNull()
    }
    event({event:'state',onAir:'vt',onAirDecoderId:8,programHold:{itemId:'vt',decoderId:7,status:'HELD',frames:36}})
    event({event:'position',itemId:'vt',decoderId:8,frames:40,duration:200})
    expect(transport.health().programHold).toBeNull();expect(transport.programPositionEvidence()).toBeNull()
    transport.close();expect(transport.health().programHold).toBeNull()
  })
  const requestHold=()=> (transport as unknown as {request(command:Record<string,unknown>):Promise<void>}).request({cmd:'programHold',itemId:'vt',decoderId:7,on:true})
  function prepare(){
    start(view([]));event({event:'ready',channelId:channel.id,decoderIdentity:true});event({event:'state',onAir:'vt',onAirDecoderId:7})
    child.stdin.removeAllListeners('data')
  }
  it.each(['confirmed','missing','wrong-request','wrong-decoder','changed-program','wrong-ack'] as const)('programHold %s receipt',async(mode)=>{
    prepare()
    child.stdin.on('data',(data:Buffer)=>{
      const command=JSON.parse(data.toString());commands.push(command)
      queueMicrotask(()=>{
        if(mode!=='missing')event({event:'programHold',id:mode==='wrong-request'?command.id+1:command.id,itemId:'vt',decoderId:mode==='wrong-decoder'?8:7,held:true,frames:36})
        if(mode==='changed-program')event({event:'state',onAir:'next',onAirDecoderId:8})
        event({event:'ack',id:command.id,ok:true,decoderId:mode==='wrong-ack'?8:7})
      })
    })
    const pending=requestHold()
    if(mode==='confirmed')await expect(pending).resolves.toBeUndefined()
    else await expect(pending).rejects.toThrow('resultado inconclusivo')
    expect(commands.map(command=>command.cmd)).toEqual(['programHold'])
  })
  it('programHold receipt alone does not complete ACK or retry on timeout',async()=>{
    vi.useFakeTimers();prepare()
    child.stdin.on('data',(data:Buffer)=>{
      const command=JSON.parse(data.toString());commands.push(command)
      event({event:'programHold',id:command.id,itemId:'vt',decoderId:7,held:true,frames:36})
    })
    const rejected=expect(requestHold()).rejects.toThrow('não confirmou programHold')
    await vi.advanceTimersByTimeAsync(30001);await rejected
    expect(commands.map(command=>command.cmd)).toEqual(['programHold'])
    expect(child.kill).toHaveBeenCalled()
  })
})
it('sonda de incidentes expira telemetria PGM e limpa leitura ao fechar',()=>{
  start(view([]))
  expect(transport.signalSample()).toEqual({meter:null,videoProbe:null})
  event({event:'videoProbe',luma:0,black:true,freeze:false})
  const now=Date.now();expect(transport.signalSample(now).videoProbe?.black).toBe(true)
  expect(transport.signalSample(now+1501)).toEqual({meter:null,videoProbe:null})
  expect(transport.signalSample(now-1000)).toEqual({meter:null,videoProbe:null})
  transport.close();expect(transport.signalSample()).toEqual({meter:null,videoProbe:null})
})
function view(paths: string[], loop = false): RundownView {
  return {
    channel, rundown: { id: 'grade', channelId: channel.id, loop },
    items: paths.map((path, index) => ({ item: { id: String(index), autoNext: true, audioTrack: 0 },
      asset: { id: String(index), path, contentHash:existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):'a'.repeat(64),kind: 'VIDEO',durationFrames:1000,durationNs:null, probeError: null }, trim: { in: 0, out: 250 }, gainDb: 0 })),
    schedule: { items: paths.map((_, index) => ({ id: String(index), state: 'SCHEDULED', duration: 250 })) },
  } as unknown as RundownView
}
function heldView(path:string):RundownView{
  const base=view([path]);return {...base,items:base.items.map(row=>({...row,trim:{in:25,out:200}}))}
}
it('evento novo com frame nativo antigo não comprova vídeo recente',()=>{
  start(view([]))
  for(const sampleAgeMs of [null,NaN,-1,2000]){
    event({event:'videoProbe',luma:100,black:false,freeze:true,freezeDurationMs:3000,sampleAgeMs})
    expect(transport.signalSample().videoProbe).toBeNull()
  }
  event({event:'videoProbe',luma:100,black:false,freeze:false,freezeDurationMs:650,sampleAgeMs:50})
  const now=Date.now();expect(transport.signalSample(now).videoProbe?.freezeDurationMs).toBe(650)
  expect(transport.signalSample(now+1451).videoProbe).toBeNull()
})
function start(value: RundownView, onTakeConfirmed?: ConstructorParameters<typeof EngineTransport>[3]['onTakeConfirmed'], currentView = () => value, executionIdentity?: () => string | null, boundary:Partial<Pick<ConstructorParameters<typeof EngineTransport>[3],'onPlaylistEnd'|'onPreparePlaylistEnd'|'canRecoverProgram'|'canStartProgram'|'fenceLease'|'assertExecutionOwned'|'beforeProcessStart'|'onProcessStarted'|'onProcessExited'|'canRestartEngine'|'onSignalObservation'|'holdProgramOutputs'|'preview'|'executionOccurrenceId'|'onStopDurable'>>={}): void {
  transport = new EngineTransport(channel, currentView, () => null,
    { binary: 'fake-engine', outputs: ['null'], preview: null, bitrateKbps: 500, onLivePriority: event => priorityEvents.push(event),onTakeConfirmed, executionIdentity,...boundary })
  // A decoder ACK requires the real process to have built its pipeline first.
  // Lease-specific tests deliberately supply Ready only after FenceApplied.
  if(!boundary.fenceLease)event({event:'ready',channelId:channel.id})
}
// NOT_RUN: mock wire identity only; no native position/hardware qualification.
it('checkpoint evidence requires the current decoder, not legacy or previous-decoder positions',()=>{
  start(view([]));event({event:'ready',channelId:channel.id,decoderIdentity:true})
  event({event:'state',onAir:'vt',onAirDecoderId:31})
  event({event:'position',itemId:'vt',frames:73,duration:250})
  expect(transport.programPositionEvidence()).toBeNull()
  event({event:'position',itemId:'vt',decoderId:31,frames:73,duration:250})
  expect(transport.programPositionEvidence()).toEqual({itemId:'vt',decoderId:31,frames:73})
  event({event:'position',itemId:'vt',decoderId:30,frames:200,duration:250})
  expect(transport.programPositionEvidence()?.frames).toBe(73)
  event({event:'state',onAir:'vt',onAirDecoderId:32})
  expect(transport.programPositionEvidence()).toBeNull()
})

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'playout-transport-'))
  commands = []; onAir = undefined; armed = undefined; rejectLoad = null; holdLoad = false; holdLiveTake = false
  rejectTakeAck = false
  holdFileTake = false
  holdPreview = false
  loadDecoderId=undefined
  priorityEvents = []
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  vi.mocked(spawn).mockClear()
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  child.stdin.on('data', (data: Buffer) => {
    const command = JSON.parse(data.toString()) as typeof commands[number]
    if (!command.cmd) return // Private startup data, not a transport command.
    commands.push(command)
    queueMicrotask(() => {
      if (command.cmd === 'load' && holdLoad) return
      if (command.cmd === 'load' && command.item?.path === rejectLoad) { armed = undefined; ack(command.id, false); return }
      if (command.cmd === 'load') armed = command.item?.itemId
      if (command.cmd === 'take' && holdLiveTake) { ack(command.id); return }
      if (command.cmd === 'take' && holdFileTake) return
      if (command.cmd === 'preview' && holdPreview) return
      if (command.cmd === 'cancelTake') armed = undefined
      if (command.cmd === 'take') { onAir = armed; armed = undefined }
      if (command.cmd === 'stop') onAir = undefined
      event({ event: 'state', onAir, armed,armedDecoderId:armed?loadDecoderId:undefined,onAirDecoderId:onAir?loadDecoderId:undefined })
      ack(command.id, !(command.cmd === 'take' && rejectTakeAck))
    })
  })
})
afterEach(() => { transport?.close(); vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('confirmed alternative checkpoint recovery (mock native pipe, not media qualification)',()=>{
  function fixture(){
    const value=view(['unused-live-fixture']);Object.assign(value.items[0]!.item,{sourceRef:'ndi:PRINCIPAL',configuredSourceId:'primary'})
    const generation='00000000-0000-4000-8000-000000000020',request={transactionId:'mock-replacement',engineGeneration:generation,selectionRevision:'mock-pair',itemId:'0',expectedDecoderId:7,expectedSourceId:'primary',targetSourceId:'backup',targetSource:'ndi:RESERVA',targetSourceType:'NDI' as const}
    const {targetSource:_,targetSourceType:__,...base}=request
    const binding=createLiveProgramBinding({channelId:channel.id,rundownId:'grade',revisionId:'rev',executionId:'exec',occurrenceId:'exec',itemId:'0',ownerRunId:'00000000-0000-4000-8000-000000000010',engineGeneration:generation,decoderId:7,sourceId:'primary',sourceConnectionSignature:nativeSourceConnectionSignature('primary','NDI','ndi:PRINCIPAL'),policySignature:'a'.repeat(64)},request,{...base,preparedDecoderId:8,phase:'COMMITTED',programFrames:143})
    return {value,binding}
  }
  function ready(value:RundownView,confirmed=vi.fn()){
    start(value,confirmed,()=>value,()=> 'rev',{executionOccurrenceId:()=> 'exec'})
    event({event:'ready',channelId:channel.id,decoderIdentity:true,liveReplacementProtocol:1,engineGeneration:'00000000-0000-4000-8000-000000000021'})
    loadDecoderId=77;return confirmed
  }
  it('loads the confirmed alternative at the exact saved cursor, not its primary or frame zero',async()=>{
    const {value,binding}=fixture(),confirmed=ready(value)
    await transport.recover('grade','0',200,undefined,binding)
    expect(commands[0]).toMatchObject({cmd:'load',item:{itemId:'0',source:'ndi:RESERVA',configuredSourceId:'backup',startOffsetFrames:200}})
    expect(commands.map(command=>command.cmd)).toEqual(['load','take'])
    expect(transport.state().onAir).toMatchObject({itemId:'0',elapsed:200})
    expect(transport.liveProgramBindingSnapshot()).toEqual(binding)
    expect(confirmed).toHaveBeenCalledWith('0',200,true,null)
  })
  it('the same item can stay on backup in PGM and use primary in CUE without cross-attributing source identity',async()=>{
    const {value,binding}=fixture();ready(value);await transport.recover('grade','0',200,undefined,binding)
    child.stdin.removeAllListeners('data');child.stdin.on('data',(chunk:Buffer)=>{
      const command=JSON.parse(chunk.toString());commands.push(command)
      queueMicrotask(()=>event({event:'ack',id:command.id,ok:true,...(command.cmd==='preview'?{decoderId:501}:{})}))
    })
    await transport.cue({kind:'ITEM',id:'0'})
    event({event:'sourceReady',itemId:'0',bus:'pgm',decoderId:77,configuredSourceId:'backup'})
    event({event:'sourceReady',itemId:'0',bus:'pvw',decoderId:501,configuredSourceId:'primary'})
    const signals=transport.state().liveSources!
    expect(signals.find(source=>source.source==='ndi:RESERVA')).toMatchObject({nativeCatalogBindings:{pgm:'backup'},busStates:{pgm:'ON_PGM'}})
    expect(signals.find(source=>source.source==='ndi:PRINCIPAL')).toMatchObject({nativeCatalogBindings:{pvw:'primary'},busStates:{pvw:'PVW_READY'}})
    expect(transport.state().preview).toEqual({kind:'ITEM',id:'0'})
    expect(transport.state().onAir?.elapsed).toBe(200)
  })
  it('a corrupt selected-source envelope cannot fall back to the primary',async()=>{
    const {value,binding}=fixture();ready(value)
    await expect(transport.recover('grade','0',200,undefined,{...binding,sealedSource:binding.sealedSource.slice(0,-8)+'AAAAAAAA'})).rejects.toThrow('não será selecionada por fallback')
    expect(commands).toEqual([]);expect(transport.state().onAir).toBeNull()
  })
  it('legacy decoder capability does not authorize a version2 recovery',async()=>{
    const {value,binding}=fixture();start(value,undefined,()=>value,()=> 'rev',{executionOccurrenceId:()=> 'exec'})
    event({event:'ready',channelId:channel.id,decoderIdentity:true})
    await expect(transport.recover('grade','0',200,undefined,binding)).rejects.toThrow('contrato/geração')
    expect(commands).toEqual([])
  })
})

describe('owning native replacement bridge (simulated child, no physical media claim)',()=>{
 const generation='00000000-0000-4000-8000-000000000020'
 async function fixture(order:'state-first'|'receipt-first'='state-first'){
  const value=view(['live','next'])
  for(const [index,row]of value.items.entries())Object.assign(row,{item:{...row.item,type:'LIVE',sourceRef:index?'ndi:NEXT':'ndi:PRIMARY',configuredSourceId:index?'next':'primary',durationOverride:250,autoNext:false},asset:null})
  const confirmed=vi.fn(),owned=vi.fn()
  start(value,confirmed,()=>value,()=> 'rev',{executionOccurrenceId:()=> 'exec',assertExecutionOwned:owned})
  Object.assign(child,{pid:4321})
  event({event:'ready',channelId:channel.id,decoderIdentity:true,liveReplacementProtocol:1,engineGeneration:generation})
  loadDecoderId=7;await transport.take('grade','0');confirmed.mockClear()
  await transport.cue({kind:'SOURCE',source:'omt:QC'})
  const initial=transport.state().onAir!
  event({event:'state',onAir:'0',onAirDecoderId:7,armed:'1',armedDecoderId:9})
  vi.spyOn(transport,'fenceBinding').mockReturnValue({ownerId:'owner',term:17})
  const selection=transport.nativeLiveSelection()
  const request:NativeLiveReplacementRequest={transactionId:'bridge-1',engineGeneration:generation,selectionRevision:'pair-1',itemId:'0',expectedDecoderId:7,expectedSourceId:'primary',targetSourceId:'backup',targetSource:'ndi:BACKUP',targetSourceType:'NDI'}
  const context={...selection,channelId:channel.id,rundownId:'grade',revisionId:'rev',executionId:'exec',occurrenceId:'exec',ownerRunId:'00000000-0000-4000-8000-000000000010'}
  const persistence:NativeReplacementPersistence={validate:vi.fn(),beforeSend:vi.fn(),receipt:vi.fn((receipt,current)=>receipt.phase==='COMMITTED'&&current?createLiveProgramBinding(context,request,receipt):undefined),stopped:vi.fn()}
  let phase:NativeLiveReplacementReceipt['phase']='READY'
  const receipt=():NativeLiveReplacementReceipt=>{
   const {targetSource:_,targetSourceType:__,...binding}=request
   return {...binding,phase,preparedDecoderId:8,programFrames:phase==='COMMITTED'?143:null}
  }
  child.stdin.removeAllListeners('data')
  child.stdin.on('data',(chunk:Buffer)=>{
   const command=JSON.parse(chunk.toString());commands.push(command)
   queueMicrotask(()=>{
    if(command.cmd==='stop'){event({event:'state'});ack(command.id);return}
    if(command.cmd==='commitLiveReplacement')phase='COMMITTED'
    if(['prepareLiveReplacement','commitLiveReplacement','liveReplacementStatus','cancelLiveReplacement'].includes(command.cmd)){
     const state=()=>event({event:'state',onAir:'0',onAirDecoderId:phase==='COMMITTED'?8:7,armed:'1',armedDecoderId:9})
     if(order==='state-first')state()
     event({event:'liveReplacement',id:command.id,receipt:receipt()})
     if(order==='receipt-first')state()
    }
    ack(command.id)
   })
  })
  commands=[]
  return {request,persistence,confirmed,initial,owned}
 }
 it.each(['state-first','receipt-first'] as const)('binds the actual child/decoder while retaining CUE, next item, clock and as-run occurrence: %s',async order=>{
  const {request,persistence,confirmed,initial}=await fixture(order)
  await expect(transport.prepareNativeLiveReplacement(request,persistence)).resolves.toMatchObject({phase:'READY'})
  expect(transport.state().onAir?.startedAt).toBe(initial.startedAt)
  await expect(transport.nativeLiveReplacementCommand('COMMIT',request.transactionId)).resolves.toMatchObject({phase:'COMMITTED'})
  expect(commands.map(value=>value.cmd)).toEqual(['prepareLiveReplacement','commitLiveReplacement'])
  expect(transport.state()).toMatchObject({onAir:{itemId:'0',startedAt:initial.startedAt,elapsed:143},preview:{kind:'SOURCE',source:'omt:QC'}})
  expect(transport.liveProgramBindingSnapshot()?.receipt.targetSourceId).toBe('backup')
  expect(transport.nativeLiveSelection()).toMatchObject({sourceId:'backup',decoderId:8})
  expect(transport.health().nativeLiveReplacement.selectionUncertain).toBe(false)
  expect(confirmed).not.toHaveBeenCalled()
  expect(persistence.beforeSend).toHaveBeenCalledWith('COMMIT',request)
  event({event:'sourceReady',itemId:'0',bus:'pgm',decoderId:8,configuredSourceId:'backup'})
  expect(transport.state().liveSources.find(row=>row.source==='ndi:BACKUP')).toMatchObject({nativeCatalogBindings:{pgm:'backup'}})
  expect(transport.state().liveSources.find(row=>row.source==='ndi:PRIMARY')?.nativeCatalogBindings?.pgm).toBeUndefined()
 })
 it('SQL intent failure writes no PREPARE bytes to the actual owning pipe',async()=>{
  const {request,persistence}=await fixture()
  vi.mocked(persistence.beforeSend).mockImplementation(()=>{throw new Error('SQL_INTENT_REFUSED')})
  await expect(transport.prepareNativeLiveReplacement(request,persistence)).rejects.toThrow('SQL_INTENT_REFUSED')
  expect(commands).toEqual([]);expect(child.kill).not.toHaveBeenCalled()
 })
 it('failed durable cut confirmation blocks new cuts, then reconciles via STATUS without repeating COMMIT',async()=>{
  const {request,persistence,confirmed,initial}=await fixture()
  await transport.prepareNativeLiveReplacement(request,persistence)
  const original=vi.mocked(persistence.receipt).getMockImplementation()!
  vi.mocked(persistence.receipt).mockImplementation(()=>{throw new Error('SQL_RECEIPT_REFUSED')})
  await expect(transport.nativeLiveReplacementCommand('COMMIT',request.transactionId)).rejects.toMatchObject({outcomeUnknown:true})
  expect(transport.health()).toMatchObject({ready:false,nativeLiveReplacement:{selectionUncertain:true}})
  expect(transport.programPositionEvidence()).toBeNull()
  await expect(transport.take('grade','1')).rejects.toThrow('inconclusivo')
  vi.mocked(persistence.receipt).mockImplementation(original)
  await expect(transport.nativeLiveReplacementCommand('STATUS',request.transactionId)).resolves.toMatchObject({phase:'COMMITTED'})
  expect(transport.state().onAir).toMatchObject({startedAt:initial.startedAt,elapsed:143})
  expect(transport.health().nativeLiveReplacement.selectionUncertain).toBe(false)
  expect(commands.filter(value=>value.cmd==='commitLiveReplacement')).toHaveLength(1)
  expect(commands.some(value=>value.cmd==='load'||value.cmd==='take')).toBe(false)
  expect(confirmed).not.toHaveBeenCalled();expect(child.kill).not.toHaveBeenCalled()
 })
 it('STOP remains blocked after native empty PGM until durable resolution succeeds',async()=>{
  const {request,persistence}=await fixture()
  await transport.prepareNativeLiveReplacement(request,persistence)
  vi.mocked(persistence.stopped).mockImplementation(()=>{throw new Error('STOP_SQL_REFUSED')})
  await expect(transport.stop()).rejects.toThrow('STOP_SQL_REFUSED')
  expect(transport.health()).toMatchObject({ready:false,nativeLiveReplacement:{selectionUncertain:true}})
  await expect(transport.take('grade','1')).rejects.toThrow('inconclusivo')
  vi.mocked(persistence.stopped).mockReset()
  await transport.stop()
  expect(persistence.stopped).toHaveBeenLastCalledWith({engineGeneration:generation,nativeRequestId:expect.any(Number),previousOwnedGenerationExited:false})
  expect(transport.state().onAir).toBeNull();expect(transport.liveProgramBindingSnapshot()).toBeNull()
  expect(transport.health().nativeLiveReplacement.selectionUncertain).toBe(false)
 })
 it('a repeated COMMIT is a historical lookup and never sends a second native cut',async()=>{
  const {request,persistence,confirmed}=await fixture()
  await transport.prepareNativeLiveReplacement(request,persistence)
  await transport.nativeLiveReplacementCommand('COMMIT',request.transactionId)
  await transport.nativeLiveReplacementCommand('COMMIT',request.transactionId)
  expect(commands.map(value=>value.cmd)).toEqual(['prepareLiveReplacement','commitLiveReplacement','liveReplacementStatus'])
  expect(confirmed).not.toHaveBeenCalled()
 })
 it('a receipt without matching native selection cannot publish a successful cut or erase CUE',async()=>{
  const {request,persistence,initial}=await fixture()
  await transport.prepareNativeLiveReplacement(request,persistence)
  child.stdin.removeAllListeners('data')
  child.stdin.on('data',(chunk:Buffer)=>{
   const command=JSON.parse(chunk.toString());commands.push(command)
   queueMicrotask(()=>{
    const {targetSource:_,targetSourceType:__,...binding}=request
    event({event:'liveReplacement',id:command.id,receipt:{...binding,phase:'COMMITTED',preparedDecoderId:8,programFrames:143}})
    ack(command.id)
   })
  })
  await expect(transport.nativeLiveReplacementCommand('COMMIT',request.transactionId)).rejects.toMatchObject({outcomeUnknown:true})
  expect(transport.health()).toMatchObject({ready:false,nativeLiveReplacement:{selectionUncertain:true}})
  expect(transport.liveProgramBindingSnapshot()).toBeNull()
  event({event:'state',onAir:'0',onAirDecoderId:90})
  expect(transport.liveProgramBindingSnapshot()).toBeNull()
  event({event:'state',onAir:'0',onAirDecoderId:8})
  await transport.nativeLiveReplacementCommand('STATUS',request.transactionId)
  expect(transport.liveProgramBindingSnapshot()?.receipt.targetSourceId).toBe('backup')
  expect(transport.state()).toMatchObject({onAir:{startedAt:initial.startedAt},preview:{kind:'SOURCE',source:'omt:QC'}})
  expect(transport.health().nativeLiveReplacement.selectionUncertain).toBe(false)
  expect(commands.filter(row=>row.cmd==='commitLiveReplacement')).toHaveLength(1)
 })
 it('the owning lease is rechecked before private PREPARE and cannot be replaced by a supplied callback',async()=>{
  const {request,persistence,owned}=await fixture()
  owned.mockImplementation(()=>{throw new Error('OWNER_LOST')})
  await expect(transport.prepareNativeLiveReplacement(request,persistence)).rejects.toThrow('OWNER_LOST')
  expect(commands).toEqual([]);expect(persistence.beforeSend).not.toHaveBeenCalled()
 })
 it('each command uses only its own per-action authorization, installed inside the queue slot',async()=>{
  const {request,persistence}=await fixture()
  const first={validate:vi.fn(),beforeSend:vi.fn()},second={validate:vi.fn(),beforeSend:vi.fn()}
  await transport.prepareNativeLiveReplacement(request,persistence,first)
  await transport.nativeLiveReplacementCommand('COMMIT',request.transactionId,second)
  expect(first.beforeSend.mock.calls.map(call=>call[0])).toEqual(['PREPARE'])
  expect(second.beforeSend.mock.calls.map(call=>call[0])).toEqual(['COMMIT'])
  expect(first.validate.mock.calls.every(call=>call[0]==='PREPARE')).toBe(true)
  expect(persistence.validate).not.toHaveBeenCalled();expect(persistence.beforeSend).not.toHaveBeenCalled()
  // Receipts are engine facts: recorded by durable persistence, not the action.
  expect(persistence.receipt).toHaveBeenCalled()
 })
 it('a refused later authorization sends no COMMIT bytes; the first action is not reused',async()=>{
  const {request,persistence}=await fixture()
  const first={validate:vi.fn(),beforeSend:vi.fn()}
  await transport.prepareNativeLiveReplacement(request,persistence,first)
  const expired={validate:vi.fn(()=>{throw new Error('SESSION_EXPIRED')}),beforeSend:vi.fn()}
  await expect(transport.nativeLiveReplacementCommand('COMMIT',request.transactionId,expired)).rejects.toThrow('SESSION_EXPIRED')
  expect(commands.map(value=>value.cmd)).toEqual(['prepareLiveReplacement'])
  expect(expired.beforeSend).not.toHaveBeenCalled();expect(first.validate).toHaveBeenCalledTimes(first.validate.mock.calls.length)
  expect(first.validate.mock.calls.some(call=>call[0]==='COMMIT')).toBe(false)
 })
 it('the action is removed when its command settles; a later command without one falls to persistence',async()=>{
  const {request,persistence}=await fixture()
  const first={validate:vi.fn(),beforeSend:vi.fn()}
  await transport.prepareNativeLiveReplacement(request,persistence,first)
  vi.mocked(persistence.validate).mockImplementation(()=>{throw new Error('NO_CURRENT_ACTION')})
  await expect(transport.nativeLiveReplacementCommand('STATUS',request.transactionId)).rejects.toThrow('NO_CURRENT_ACTION')
  expect(first.validate.mock.calls.some(call=>call[0]==='STATUS')).toBe(false)
  expect(commands.map(value=>value.cmd)).toEqual(['prepareLiveReplacement'])
 })
})

describe('durable STOP hook for journals of other server processes (simulated child)',()=>{
 it('runs inside the durable STOP section; a refusal keeps the native block until it succeeds',async()=>{
  const value=view(['live'])
  Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:PRIMARY',configuredSourceId:'primary',durationOverride:250,autoNext:false},asset:null})
  const durable=vi.fn<(proof:{engineGeneration:string|null;nativeRequestId:number})=>void>(()=>{throw new Error('PREDECESSOR_SQL_REFUSED')})
  start(value,undefined,()=>value,()=> 'rev',{executionOccurrenceId:()=> 'exec',onStopDurable:durable})
  event({event:'ready',channelId:channel.id,decoderIdentity:true,liveReplacementProtocol:1,engineGeneration:'00000000-0000-4000-8000-000000000020'})
  child.stdin.removeAllListeners('data')
  child.stdin.on('data',(chunk:Buffer)=>{const command=JSON.parse(chunk.toString());commands.push(command);queueMicrotask(()=>{if(command.cmd==='stop')event({event:'state'});ack(command.id)})})
  commands=[]
  await expect(transport.stop()).rejects.toThrow('PREDECESSOR_SQL_REFUSED')
  expect(transport.health()).toMatchObject({ready:false,nativeLiveReplacement:{selectionUncertain:true}})
  durable.mockImplementation(()=>{})
  await transport.stop()
  expect(durable).toHaveBeenLastCalledWith({engineGeneration:'00000000-0000-4000-8000-000000000020',nativeRequestId:expect.any(Number)})
  expect(transport.health().nativeLiveReplacement.selectionUncertain).toBe(false)
 })
})

describe('native live replacement capability and uncertain selector protection (mock private wire)',()=>{
  it('legacy Ready is unsupported; capability requires protocol, generation UUID and native identities',()=>{
    start(view([]));expect(transport.health().nativeLiveReplacement).toEqual({supported:false,engineGeneration:null,selectionUncertain:false})
    const generation='00000000-0000-4000-8000-000000000001'
    event({event:'ready',channelId:channel.id,decoderIdentity:true,liveReplacementProtocol:1,engineGeneration:generation})
    expect(transport.health().nativeLiveReplacement).toEqual({supported:true,engineGeneration:generation,selectionUncertain:false})
    event({event:'ready',channelId:channel.id,decoderIdentity:false,liveReplacementProtocol:1,engineGeneration:generation})
    expect(transport.health().nativeLiveReplacement.supported).toBe(false)
    event({event:'ready',channelId:channel.id,decoderIdentity:true,liveReplacementProtocol:1,engineGeneration:'not-a-generation'})
    expect(transport.health().nativeLiveReplacement.supported).toBe(false)
    expect(commands).toEqual([])
  })
  function uncertain(){
    start(view([]));event({event:'ready',channelId:channel.id,decoderIdentity:true})
    event({event:'state',onAir:'live',onAirDecoderId:7,programSelectionUncertain:true})
    event({event:'position',itemId:'live',decoderId:7,frames:143,duration:1000})
  }
  it('uncertainty blocks checkpoint evidence and new cuts without killing an engine still producing',async()=>{
    uncertain();expect(transport.health()).toMatchObject({ready:false,nativeLiveReplacement:{selectionUncertain:true}})
    expect(transport.programDecoderBinding()).toBeNull();expect(transport.programPositionEvidence()).toBeNull()
    const privateTransport=transport as unknown as {request:(command:Record<string,unknown>)=>Promise<void>}
    await expect(privateTransport.request({cmd:'load',item:{itemId:'other'}})).rejects.toThrow('confirme STOP')
    await expect(privateTransport.request({cmd:'take'})).rejects.toThrow('confirme STOP')
    transport.tick();expect(commands).toEqual([]);expect(child.kill).not.toHaveBeenCalled()
  })
  it('later State false alone cannot erase uncertain source selection',()=>{
    uncertain();event({event:'state',onAir:'live',onAirDecoderId:7,programSelectionUncertain:false})
    expect(transport.health().ready).toBe(false);expect(transport.health().nativeLiveReplacement.selectionUncertain).toBe(true)
  })
  it('explicit STOP with ACK and empty program clears the in-process selection guard',async()=>{
    uncertain();await transport.stop()
    expect(commands.map(command=>command.cmd)).toEqual(['stop'])
    expect(transport.health().nativeLiveReplacement.selectionUncertain).toBe(false)
    expect(transport.state().onAir).toBeNull()
  })
  it('STOP ACK without empty native program does not release the guard',async()=>{
    uncertain();child.stdin.removeAllListeners('data');child.stdin.on('data',(chunk:Buffer)=>{const command=JSON.parse(chunk.toString());commands.push(command);ack(command.id)})
    await expect(transport.stop()).rejects.toThrow('STOP sem confirmação')
    expect(transport.health().nativeLiveReplacement.selectionUncertain).toBe(true)
  })
  it('engine exit after uncertain selectors does not silently restore the old source',()=>{
    uncertain();child.emit('exit',1,null)
    const privateTransport=transport as unknown as {restore:()=>void;recoveryCursor:{programHold?:string}|null}
    expect(privateTransport.recoveryCursor?.programHold).toBe('UNCONFIRMED')
    privateTransport.restore();expect(commands).toEqual([])
    expect(transport.health().error).toContain('não retomar silenciosamente')
  })
})

describe('transporte real confirmado pelo engine', () => {
  it('shutdown local aguarda exit zero depois de 1s sem antecipar kill e é idempotente',async()=>{
    vi.useFakeTimers();start(view([]));Object.assign(child,{pid:4321})
    const stopped=transport.closeGracefully(12000,5000)
    expect(transport.closeGracefully()).toBe(stopped)
    await vi.advanceTimersByTimeAsync(2000);expect(child.kill).not.toHaveBeenCalled()
    expect(commands.filter(row=>row.cmd==='shutdown')).toHaveLength(1)
    child.emit('exit',0,null)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false})
    await vi.advanceTimersByTimeAsync(20000);expect(child.kill).not.toHaveBeenCalled()
  })
  it('shutdown sobre handle próprio independe do banco perdido e não libera novo TAKE',async()=>{
    let lost=false;const authority=vi.fn(()=>{if(lost)throw new Error('STORAGE_LOST')})
    start(view([]),undefined,undefined,undefined,{assertExecutionOwned:authority});Object.assign(child,{pid:4321})
    const before=authority.mock.calls.length;lost=true
    const stopped=transport.closeGracefully()
    expect(authority.mock.calls.length).toBe(before);expect(commands.filter(row=>row.cmd==='shutdown')).toHaveLength(1);expect(child.kill).not.toHaveBeenCalled()
    await expect(transport.take('rd','new')).rejects.toThrow('indisponível');expect(commands.some(row=>row.cmd==='take')).toBe(false)
    child.emit('exit',0,null);await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true,graceful:true,forceRequested:false})
  })
  it('prazo normal força somente handles próprios, mas espera exit antes de confirmar parada',async()=>{
    vi.useFakeTimers();start(view([]));Object.assign(child,{pid:4321})
    let settled=false;const stopped=transport.closeGracefully(50,100).then(value=>{settled=true;return value})
    await vi.advanceTimersByTimeAsync(50);expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(settled).toBe(false)
    child.emit('exit',0,null)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true,graceful:false,forceRequested:true})
  })
  it('ausência de exit ou erro com PID conserva incerteza após prazo total',async()=>{
    vi.useFakeTimers();start(view([]));Object.assign(child,{pid:4321})
    const stopped=transport.closeGracefully(50,100);child.emit('error',new Error('kill recusado'))
    await vi.advanceTimersByTimeAsync(150)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:false,graceful:false,forceRequested:true})
  })
  it('cleanup de segurança interrompe imediatamente a espera normal, sem certificar finalização',async()=>{
    vi.useFakeTimers();start(view([]));Object.assign(child,{pid:4321})
    const normal=transport.closeGracefully(),forced=transport.closeConfirmed()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');child.emit('exit',null,'SIGKILL')
    await expect(forced).resolves.toEqual({ownedNativeProcessesStopped:true})
    await expect(normal).resolves.toEqual({ownedNativeProcessesStopped:true,graceful:false,forceRequested:true})
  })
  it('um close rápido já pedido não ganha mais tempo por chamada posterior de grace',async()=>{
    vi.useFakeTimers();start(view([]));Object.assign(child,{pid:4321})
    transport.close();const stopped=transport.closeGracefully()
    await vi.advanceTimersByTimeAsync(1000);expect(child.kill).toHaveBeenCalledWith()
    child.emit('exit',null,'SIGTERM')
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true,graceful:false,forceRequested:true})
  })
  it('geração cercada não entra em grace, mesmo se caller pedir encerramento normal',async()=>{
    start(view([]),undefined,undefined,undefined,{fenceLease:async()=>({term:1,ttlMs:5000})});Object.assign(child,{pid:4321})
    const stopped=transport.closeGracefully();expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('exit',0,null)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true,graceful:false,forceRequested:true})
  })
  it('exit não zero sem força é parada observada, mas não finalização normal',async()=>{
    start(view([]));Object.assign(child,{pid:4321})
    const stopped=transport.closeGracefully();child.emit('exit',1,null)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true,graceful:false,forceRequested:false})
  })
  it('prazo inválido não fecha transporte ou envia shutdown',async()=>{
    start(view([]))
    for(const value of[0,-1,NaN,1.5,30001])await expect(transport.closeGracefully(value)).rejects.toThrow('Prazo')
    await expect(transport.closeGracefully(100,0)).rejects.toThrow('Prazo')
    expect(commands.some(row=>row.cmd==='shutdown')).toBe(false);expect(child.kill).not.toHaveBeenCalled()
  })
  it('parada confirmada depende de exit, não de kill ou fechamento do transporte',async()=>{
    start(view([]));Object.assign(child,{pid:4321})
    let settled=false
    const stopped=transport.closeConfirmed(1000).then(result=>{settled=true;return result})
    await Promise.resolve();expect(settled).toBe(false)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('exit',null,'SIGKILL')
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true})
  })
  it('timeout de parada conserva incerteza mesmo com kill aceito',async()=>{
    vi.useFakeTimers();start(view([]));Object.assign(child,{pid:4321})
    const stopped=transport.closeConfirmed(250)
    await vi.advanceTimersByTimeAsync(250)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:false})
    expect(transport.closeConfirmed(250)).toBe(stopped)
  })
  it('erro de processo com PID não prova término',async()=>{
    vi.useFakeTimers();start(view([]));Object.assign(child,{pid:4321})
    const stopped=transport.closeConfirmed(250);child.emit('error',new Error('kill recusado'))
    await vi.advanceTimersByTimeAsync(250)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:false})
  })
  it('erro de spawn sem PID confirma que nenhum processo foi aberto',async()=>{
    start(view([]));child.emit('error',new Error('spawn ENOENT'))
    await expect(transport.closeConfirmed()).resolves.toEqual({ownedNativeProcessesStopped:true})
  })
  it('cleanup aguarda também geração anterior cuja morte não foi observada',async()=>{
    vi.useFakeTimers();start(view([]));const previous=child;Object.assign(previous,{pid:4321})
    previous.emit('error',new Error('IPC indisponível'))
    const replacement=Object.assign(new EventEmitter(),{pid:4322,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()})
    vi.mocked(spawn).mockReturnValue(replacement as unknown as ReturnType<typeof spawn>)
    transport.watchdog();await vi.advanceTimersByTimeAsync(1000);transport.watchdog()
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2)
    let settled=false;const stopped=transport.closeConfirmed(1000).then(value=>{settled=true;return value})
    replacement.emit('exit',0,null);await Promise.resolve();expect(settled).toBe(false)
    expect(previous.kill).toHaveBeenCalledWith('SIGKILL');expect(replacement.kill).toHaveBeenCalledWith('SIGKILL')
    previous.emit('exit',0,null)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true})
  })
  it('gerações sobrepostas mantêm força imediata, não grace que poderia deixar antecessor vivo',async()=>{
    vi.useFakeTimers();start(view([]));const previous=child;Object.assign(previous,{pid:4321})
    previous.emit('error',new Error('IPC indisponível'))
    const replacement=Object.assign(new EventEmitter(),{pid:4322,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()})
    vi.mocked(spawn).mockReturnValue(replacement as unknown as ReturnType<typeof spawn>)
    transport.watchdog();await vi.advanceTimersByTimeAsync(1000);transport.watchdog()
    const stopped=transport.closeGracefully()
    expect(previous.kill).toHaveBeenCalledWith('SIGKILL');expect(replacement.kill).toHaveBeenCalledWith('SIGKILL')
    replacement.emit('exit',0,null);previous.emit('exit',0,null)
    await expect(stopped).resolves.toEqual({ownedNativeProcessesStopped:true,graceful:false,forceRequested:true})
  })
  it('exit já observado permite cleanup sem inventar nova geração',async()=>{
    start(view([]));child.emit('exit',0,null)
    await expect(transport.closeConfirmed()).resolves.toEqual({ownedNativeProcessesStopped:true})
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
  })
  // Batch fixtures only: NOT_RUN. Fake pipe is not native/physical evidence.
  function heldEngine(value:RundownView=view([]),preview=false){
    const startup:Array<Record<string,unknown>>=[]
    child.stdin.on('data',data=>startup.push(JSON.parse(data.toString())))
    Object.assign(child,{pid:4321})
    start(value,undefined,undefined,undefined,{holdProgramOutputs:true,fenceLease:async()=>({term:7,ttlMs:5000}),assertExecutionOwned:()=>{},canRestartEngine:()=>false,...(preview?{preview:JSON.stringify({id:'local-preview',kind:'srt',target:'srt://127.0.0.1:8890?streamid=publish:reserve',width:426,height:240,rateNum:15,rateDen:1,bitrateKbps:450})}:{})})
    event({event:'fenceApplied',nonce:1,term:7})
    event({event:'ready',channelId:channel.id,decoderIdentity:true,programAdmission:true,programOutputsHeld:true,previewAdmission:true})
    return startup[0]!.fenceOwner as string
  }
  it('backup paused admission keeps explicit mode and refuses normal release before dispatch',async()=>{
    const file=join(directory,'paused-admission.mkv');writeFileSync(file,'MOCK_NATIVE_FRAME_NOT_VIDEO')
    const value=view([file]);heldEngine(value);child.stdin.removeAllListeners('data')
    child.stdin.on('data',(data:Buffer)=>{
      const command=JSON.parse(data.toString());commands.push(command)
      queueMicrotask(()=>{
        if(command.cmd==='restoreProgramHold'){
          event({event:'programHold',id:command.id,itemId:'0',decoderId:31,held:true,frames:73})
          event({event:'state',onAir:'0',onAirDecoderId:31,programHold:{itemId:'0',decoderId:31,status:'HELD',frames:73}})
        }
        if(command.cmd==='releaseProgramOutputs')event({event:'programOutputs',held:false,ownerId:command.ownerId,term:command.term,itemId:'0',decoderId:31,cursor:{elapsed:73,firstVideoConfirmed:true,trim:{in:0,out:250},paused:true}})
        event({event:'ack',id:command.id,ok:true,decoderId:31})
      })
    })
    const trim={in:0,out:250,contentHash:value.items[0]!.asset!.contentHash!}
    await transport.recoverHeld('grade','0',73,trim)
    expect(transport.health().programAdmission.held).toBe(true)
    await expect(transport.releaseProgramOutputs(async()=>{})).rejects.toThrow('admitido como reprodução')
    expect(commands.map(command=>command.cmd)).toEqual(['restoreProgramHold'])
    await expect(transport.releaseProgramOutputs(async()=>{},true)).resolves.toMatchObject({itemId:'0',decoderId:31,elapsed:73,paused:true,programTrim:trim})
    expect(transport.health().programAdmission.held).toBe(false);expect(transport.state().playing).toBe(false)
  })
  it('preparo retido de VT arma corte/offset exatos sem TAKE ou liberação',async()=>{
    const path=join(directory,'prepared.mp4');writeFileSync(path,'MOCK_VIDEO_BYTES_NOT_NATIVE_FRAME')
    const value=view([path]);heldEngine(value);loadDecoderId=31
    const trim={in:0,out:250,contentHash:createHash('sha256').update(readFileSync(path)).digest('hex')}
    await expect(transport.prepareHeldDecoder('0',73,trim,async()=>{})).resolves.toEqual({itemId:'0',decoderId:31,firstVideoConfirmed:true})
    expect(commands.filter(command=>command.cmd==='load')).toEqual([expect.objectContaining({item:expect.objectContaining({itemId:'0',trimIn:0,trimOut:250,startOffsetFrames:73})})])
    expect(commands.some(command=>['take','releaseProgramOutputs'].includes(command.cmd))).toBe(false)
    expect(transport.state().onAir).toBeNull();expect(transport.health().programAdmission.held).toBe(true)
  })
  it('preparo idle não abre decoder nem inventa quadro',async()=>{
    heldEngine()
    await expect(transport.prepareHeldDecoder(null,0,undefined,async()=>{})).resolves.toEqual({itemId:null,decoderId:null,firstVideoConfirmed:false})
    expect(commands.filter(command=>['load','take','releaseProgramOutputs'].includes(command.cmd))).toHaveLength(0)
    await expect(transport.prepareHeldDecoder(null,73,undefined,async()=>{})).rejects.toThrow('idle')
  })
  // NOT_RUN: mocked wire/cursor only, not proof of native frames or publishing.
  it('retoma VT somente no programa interno retido, sem liberar publicadores',async()=>{
    const path=join(directory,'resume.mp4');writeFileSync(path,'MOCK_VIDEO_BYTES_NOT_NATIVE_FRAME')
    heldEngine(view([path]));loadDecoderId=33
    const trim={in:0,out:250,contentHash:createHash('sha256').update(readFileSync(path)).digest('hex')}
    await transport.prepareHeldDecoder('0',73,trim,async()=>{})
    await transport.resumeHeldProgram('grade','0',73,trim,async()=>{})
    expect(transport.state()).toMatchObject({onAir:{itemId:'0',elapsed:73}})
    expect(transport.health().programAdmission.held).toBe(true)
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
    expect(commands.some(command=>command.cmd==='releaseProgramOutputs')).toBe(false)
    await expect(transport.resumeHeldProgram('grade','0',73,trim,async()=>{})).rejects.toThrow('sem programa anterior')
  })
  it('retomada interna retida não envia TAKE quando autorização é recusada',async()=>{
    const path=join(directory,'refused-resume.mp4');writeFileSync(path,'MOCK_VIDEO_BYTES_NOT_NATIVE_FRAME')
    heldEngine(view([path]));loadDecoderId=34
    const trim={in:0,out:250,contentHash:createHash('sha256').update(readFileSync(path)).digest('hex')}
    await expect(transport.resumeHeldProgram('grade','0',73,trim,async()=>{throw new Error('admissão recusada')})).rejects.toThrow('admissão recusada')
    expect(commands.some(command=>command.cmd==='take')).toBe(false)
    expect(transport.health().programAdmission.held).toBe(true)
  })
  function confirmRelease(decoderId:number|null=null){
    child.stdin.on('data',data=>{
      const command=JSON.parse(data.toString())
      if(command.cmd==='releaseProgramOutputs')event({event:'programOutputs',held:false,ownerId:command.ownerId,term:command.term,itemId:command.itemId,decoderId,cursor:{elapsed:0,firstVideoConfirmed:false,trim:null}})
    })
  }
  // NOT_RUN: mocked ACK/order only, no encoder/network/physical qualification.
  it('preview release requires admitted program and carries no replacement address',async()=>{
    const owner=heldEngine(view([]),true);confirmRelease()
    await expect(transport.releasePreviewOutput(async()=>{})).rejects.toThrow('admissão de PGM')
    expect(commands.some(command=>command.cmd==='releasePreviewOutput')).toBe(false)
    await transport.releaseProgramOutputs(async()=>{})
    await transport.releasePreviewOutput(async()=>{})
    expect(commands.filter(command=>command.cmd==='releasePreviewOutput')).toEqual([expect.objectContaining({ownerId:owner,term:7})])
    expect(commands.find(command=>command.cmd==='releasePreviewOutput')).not.toHaveProperty('target')
    await expect(transport.releasePreviewOutput(async()=>{})).rejects.toThrow('ainda não enviada')
  })
  it('preparação recusa binário sem confirmação de retenção/decoder',()=>{
    start(view([]),undefined,undefined,undefined,{holdProgramOutputs:true,canRestartEngine:()=>false})
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(transport.health().ready).toBe(false)
  })
  it('liberação exige pedido, concessão, evento nativo e ACK da mesma geração',async()=>{
    const owner=heldEngine();confirmRelease()
    const authorize=vi.fn(async()=>{})
    await expect(transport.releaseProgramOutputs(authorize)).resolves.toEqual({channelId:channel.id,ownerId:owner,term:7,itemId:null,decoderId:null,elapsed:0,firstVideoConfirmed:false})
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(commands.filter(command=>command.cmd==='releaseProgramOutputs')).toEqual([expect.objectContaining({ownerId:owner,term:7,itemId:null,decoderId:null})])
    expect(transport.health().programAdmission).toEqual({supported:true,held:false})
    await expect(transport.releaseProgramOutputs(authorize)).rejects.toThrow('saídas retidas')
    expect(commands.filter(command=>command.cmd==='releaseProgramOutputs')).toHaveLength(1)
  })
  it('ACK sozinho não prova liberação e encerra somente o filho próprio',async()=>{
    heldEngine()
    await expect(transport.releaseProgramOutputs(async()=>{})).rejects.toThrow('confirmação nativa')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(transport.health().ready).toBe(false)
    expect(commands.filter(command=>command.cmd==='releaseProgramOutputs')).toHaveLength(1)
  })
  it('evento de liberação sem posição/corte nativos não confirma admissão',async()=>{
    heldEngine()
    child.stdin.on('data',data=>{
      const command=JSON.parse(data.toString())
      if(command.cmd==='releaseProgramOutputs')event({event:'programOutputs',held:false,ownerId:command.ownerId,term:command.term,itemId:command.itemId,decoderId:command.decoderId})
    })
    await expect(transport.releaseProgramOutputs(async()=>{})).rejects.toThrow()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(transport.health().programAdmission.held).toBe(true)
  })
  it('perda de autorização antes do envio mantém saídas retidas',async()=>{
    heldEngine()
    await expect(transport.releaseProgramOutputs(async()=>{throw new Error('SESSION_REVOKED')})).rejects.toThrow('SESSION_REVOKED')
    expect(commands.filter(command=>command.cmd==='releaseProgramOutputs')).toHaveLength(0)
    expect(child.kill).not.toHaveBeenCalled();expect(transport.health().programAdmission.held).toBe(true)
  })
  it('perda de autorização após liberação preserva incerteza e impede replay',async()=>{
    heldEngine();confirmRelease();let calls=0
    await expect(transport.releaseProgramOutputs(async()=>{if(++calls===2)throw new Error('SESSION_REVOKED')})).rejects.toThrow('SESSION_REVOKED')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(transport.fenceBinding()).toBeNull()
    await expect(transport.releaseProgramOutputs(async()=>{})).rejects.toThrow()
    expect(commands.filter(command=>command.cmd==='releaseProgramOutputs')).toHaveLength(1)
  })
  it('evento sem pedido e evento de decoder distinto não liberam PGM',async()=>{
    const owner=heldEngine()
    event({event:'programOutputs',held:false,ownerId:owner,term:7,itemId:null,decoderId:null})
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(transport.health().programAdmission.held).toBe(true)
  })
  it('decoder divergente durante liberação encerra a preparação',async()=>{
    heldEngine();confirmRelease(99)
    await expect(transport.releaseProgramOutputs(async()=>{})).rejects.toThrow()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(transport.health().programAdmission.held).toBe(true)
  })
  it('grafismo confirmado reconfere autoridade na fila nativa antes de enviar',async()=>{
    start(view([]));const before=commands.length
    await expect(transport.graphicConfirmed('<svg/>',0,()=>{throw new Error('SESSION_REVOKED')})).rejects.toThrow('SESSION_REVOKED')
    expect(commands).toHaveLength(before)
    await transport.graphicConfirmed('<svg/>',0)
    expect(commands.filter(command=>command.cmd==='graphic')).toHaveLength(1)
  })
  it('geração do publisher atravessa transporte e saída nativa notifica sem fontes',()=>{
    const snapshots:Array<{ready:boolean;count:number;generation?:number}>=[]
    start(view([]),undefined,undefined,undefined,{canRestartEngine:()=>false,onSignalObservation:()=>snapshots.push({ready:transport.health().ready,count:transport.publishers().length,generation:transport.publishers()[0]?.generation})})
    event({event:'publisher',outputId:'primary',url:'srt://private',health:'failed',attempts:1,delivered:100000,generation:10})
    event({event:'publisher',outputId:'primary',url:'srt://private',health:'onAir',attempts:0,delivered:1,generation:11})
    expect(snapshots.map(row=>row.generation)).toEqual([10,11])
    for(const generation of [-1,0.5,Number.MAX_SAFE_INTEGER+1]){
      event({event:'publisher',outputId:'primary',url:'srt://private',health:'onAir',attempts:0,delivered:1,generation})
      expect(transport.publishers()[0]?.generation).toBeUndefined()
    }
    expect(transport.state().liveSources).toEqual([])
    child.emit('exit',1,null)
    expect(snapshots.at(-1)).toEqual({ready:false,count:0,generation:undefined})
  })
  it('observação nativa captura publisher failed/onAir síncronos sem esperar polling',()=>{
    const states:string[]=[]
    start(view([]),undefined,undefined,undefined,{onSignalObservation:()=>states.push(transport.publishers()[0]!.health)})
    event({event:'publisher',outputId:'primary',url:'srt://private',health:'failed',attempts:1,delivered:10})
    event({event:'publisher',outputId:'primary',url:'srt://private',health:'onAir',attempts:0,delivered:11})
    expect(states).toEqual(['failed','onAir'])
  })
  it('callback usa telemetria aceita da fonte selecionada e rejeita evento de item antigo',async()=>{
    const value=view(['live']),states:string[]=[]
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value,undefined,undefined,undefined,{onSignalObservation:()=>states.push(transport.state().liveSources[0]?.busSignals?.pgm?.status??'UNKNOWN')})
    await transport.take('grade','0');states.length=0
    const signal={width:320,height:180,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:0,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:100,arrivalJitterMs:1}
    event({event:'sourceTelemetry',itemId:'discarded-item',bus:'pgm',signal});expect(states).toEqual([])
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',signal:{...signal,videoPresent:false,videoAgeMs:2500}})
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',signal})
    expect(states).toEqual(['NO_VIDEO','SIGNAL_OK']);expect(transport.state().onAir?.itemId).toBe('0')
    states.length=0
    event({event:'sourceLost',itemId:'0',reason:'fixture loss'})
    event({event:'sourceReady',itemId:'0',bus:'pgm'})
    expect(states).not.toContain('SIGNAL_OK');expect(states.at(-1)).toBe('UNKNOWN')
    expect(transport.state().liveSources[0]?.measurements?.pgm).toBeUndefined()
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',signal});expect(states.at(-1)).toBe('SIGNAL_OK')
  })
  it('preserva identidade de publishers distintos no mesmo destino',()=>{
    start(view([]))
    for(const outputId of ['primary','backup'])event({event:'publisher',outputId,url:'rtmp://host/shared',health:'onAir',attempts:0,delivered:1})
    expect(transport.publishers().map(row=>row.outputId)).toEqual(['primary','backup'])
    event({event:'publisher',outputId:'primary',url:'rtmp://host/new-target',health:'retrying',attempts:1,delivered:0})
    expect(transport.publishers()).toHaveLength(2)
    expect(transport.publishers()[0]).toMatchObject({outputId:'primary',url:'rtmp://host/new-target',health:'retrying'})
  })
  it('recuperação exata conserva classe de recusa nativa, sem transformar em timeout genérico',async()=>{
    const file=join(directory,'refused-live-fixture.mkv');writeFileSync(file,'unit fixture, not decoded')
    const value=view([file])
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:CAM',autoNext:false},asset:null})
    start(value);rejectTakeAck=true
    const recovery=transport.recover('grade','0',49)
    await expect(recovery).rejects.toBeInstanceOf(EngineCommandRejected)
    await expect(recovery).rejects.toThrow('Nenhum item reproduzível')
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
  })
  it('recuperação live comunica recusa tardia apenas do decoder PGM desta tentativa',async()=>{
    const file=join(directory,'late-live-fixture.mkv');writeFileSync(file,'unit fixture, not decoded')
    const value=view([file]),rejected=vi.fn()
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:CAM'},asset:null})
    start(value)
    Object.assign((transport as unknown as {options:object}).options,{onRecoveryRejected:rejected})
    event({event:'ready',channelId:channel.id,decoderIdentity:true})
    holdLoad=true;holdLiveTake=true
    const recovery=transport.recover('grade','0',49)
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'))
    event({event:'state',armed:'0',armedDecoderId:77});ack(commands.at(-1)!.id)
    await recovery
    for(const fault of [{bus:'pvw',decoderId:77},{bus:'pgm',decoderId:78}])event({event:'itemError',itemId:'0',message:'refused',...fault})
    expect(rejected).not.toHaveBeenCalled()
    event({event:'itemError',itemId:'0',bus:'pgm',decoderId:77,message:'definitive refusal'})
    expect(rejected).toHaveBeenCalledWith({rundownId:'grade',itemId:'0',frames:49},expect.any(EngineCommandRejected))
    event({event:'itemError',itemId:'0',bus:'pgm',decoderId:77,message:'duplicate'})
    expect(rejected).toHaveBeenCalledTimes(1)
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
  })
  it('recuperação live conserva identidade após ACK até o primeiro PGM confirmado',async()=>{
    const file=join(directory,'live-recovery-fixture.mkv');writeFileSync(file,'unit fixture, not decoded')
    const value=view([file]),confirmed=vi.fn()
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:CAM'},asset:null})
    start(value,confirmed);holdLiveTake=true
    await transport.recover('grade','0',49)
    expect(confirmed).not.toHaveBeenCalled();expect(transport.health().ready).toBe(false)
    onAir='0';event({event:'state',onAir})
    expect(confirmed).toHaveBeenCalledWith('0',49,true,null)
    expect(transport.state().onAir?.elapsed).toBe(49);expect(transport.health().ready).toBe(true)
  })
  it('estado nativo publica duração montada sem retornar ao nominal do item',async()=>{
    const file=join(directory,'mounted-duration.mp4');writeFileSync(file,'video');const value=view([file]);Object.assign(value.schedule.items[0]!,{duration:75});start(value)
    await transport.take('grade','0');Object.assign(value.schedule.items[0]!,{duration:250,state:'ON_AIR'})
    event({event:'position',itemId:'0',frames:50,duration:75})
    expect(transport.state().onAir).toMatchObject({elapsed:50,mountedDuration:75})
  })
  it('cópia por SHA durante recuperação conserva corte salvo e cursor no novo preroll',async()=>{
    const original=join(directory,'saved-original.mkv'),cached=join(directory,'saved-copy.mkv');writeFileSync(original,'video');writeFileSync(cached,'video')
    const value=view([original]);start(value);holdLoad=true
    const saved={in:0,out:75,contentHash:value.items[0]!.asset!.contentHash!},recovery=transport.recover('grade','0',25,saved)
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'))
    Object.assign(value.items[0]!.asset!,{path:cached});holdLoad=false;armed='0';event({event:'state',onAir,armed});ack(commands.at(-1)!.id)
    await recovery
    expect(commands.filter(row=>row.cmd==='load').map(row=>({path:row.item?.path,trimOut:row.item?.trimOut}))).toEqual([{path:original,trimOut:75},{path:cached,trimOut:75}])
    expect(commands.filter(row=>row.cmd==='take')).toHaveLength(1)
    expect(transport.state()).toMatchObject({programTrim:saved,onAir:{itemId:'0',elapsed:25}})
  })
  it('restaura corte salvo mesmo quando o timing atual calculou outra duração',async()=>{
    const file=join(directory,'saved-crop.mp4');writeFileSync(file,'video');const value=view([file]);start(value)
    const saved={in:0,out:75,contentHash:value.items[0]!.asset!.contentHash!}
    await transport.recover('grade','0',25,saved)
    expect(commands.find(row=>row.cmd==='load')?.item).toMatchObject({trimIn:0,trimOut:75,startOffsetFrames:25})
    expect(transport.state().programTrim).toEqual(saved)
  })
  it('recuperação não calcula novo corte quando não há corte confirmado',async()=>{
    const file=join(directory,'no-saved-crop.mp4');writeFileSync(file,'video');start(view([file]))
    await expect(transport.recover('grade','0',25)).rejects.toThrow('Não há corte confirmado')
    expect(commands.some(row=>row.cmd==='load'||row.cmd==='take')).toBe(false)
  })
  it('checkpoint com cursor fora do corte ou SHA trocado não envia LOAD/TAKE',async()=>{
    const file=join(directory,'bad-saved-crop.mp4');writeFileSync(file,'video');const value=view([file]);start(value)
    const saved={in:0,out:75,contentHash:value.items[0]!.asset!.contentHash!}
    await expect(transport.recover('grade','0',75,saved)).rejects.toThrow('Cursor fora')
    await expect(transport.recover('grade','0',25,{...saved,contentHash:'b'.repeat(64)})).rejects.toThrow('versão da mídia')
    expect(commands.some(row=>row.cmd==='load'||row.cmd==='take')).toBe(false)
  })
  it('reprojeção pelo relógio durante preroll não invalida corte preparado',async()=>{
    const file=join(directory,'clock-preroll.mp4');writeFileSync(file,'video');const value=view([file]);Object.assign(value.schedule.items[0]!,{duration:75})
    start(value)
    child.stdin.on('data',(data:Buffer)=>{if(JSON.parse(data.toString()).cmd==='load')Object.assign(value.schedule.items[0]!,{duration:50})})
    await transport.take('grade','0')
    expect(transport.state().onAir?.itemId).toBe('0')
    expect(commands.find(row=>row.cmd==='load')?.item?.trimOut).toBe(75)
  })
  it('TAKE executa corte visto no CUE mesmo após relógio reprojetar duração',async()=>{
    const file=join(directory,'clock-cue.mp4');writeFileSync(file,'video');const value=view([file]);Object.assign(value.schedule.items[0]!,{duration:75});start(value)
    await transport.cue({kind:'ITEM',id:'0'})
    Object.assign(value.schedule.items[0]!,{duration:50})
    await transport.take('grade','0')
    expect(commands.find(row=>row.cmd==='load')?.item?.trimOut).toBe(75)
    expect(transport.state().onAir?.itemId).toBe('0')
  })
  it('envia duração resolvida ao decoder sem reescrever corte nominal',async()=>{
    const file=join(directory,'auto-trim.mp4');writeFileSync(file,'video');const value=view([file])
    Object.assign(value.schedule.items[0]!,{duration:75});start(value)
    await transport.take('grade','0')
    expect(commands.find(row=>row.cmd==='load')?.item).toMatchObject({trimIn:0,trimOut:75})
    expect(value.items[0]!.trim.out).toBe(250)
  })
  it('filler expandido monta duração do timing, não o nominal',async()=>{
    const file=join(directory,'auto-stretch.mp4');writeFileSync(file,'video');const value=view([file])
    Object.assign(value.schedule.items[0]!,{duration:300});start(value);await transport.take('grade','0')
    expect(commands.find(row=>row.cmd==='load')?.item?.trimOut).toBe(300)
  })
  it('corte montado do PGM permanece fixo quando a projeção é recalculada',async()=>{
    const file=join(directory,'pin.mp4');writeFileSync(file,'video');const value=view([file]);Object.assign(value.schedule.items[0]!,{duration:75})
    start(value);await transport.take('grade','0')
    Object.assign(value.schedule.items[0]!,{state:'ON_AIR',duration:250})
    await transport.cue({kind:'ITEM',id:'0'})
    expect([...commands].reverse().find(row=>row.cmd==='preview')?.item?.trimOut).toBe(75)
  })
  it('horário de início permanece fixo enquanto relógio e posição avançam',async()=>{
    const file=join(directory,'stable-start.mp4');writeFileSync(file,'video');start(view([file]))
    await transport.take('grade','0');const origin=transport.state().onAir!.startedAt,instant=Date.now()
    vi.useFakeTimers({toFake:['Date']})
    try{
      vi.setSystemTime(instant+251);event({event:'position',itemId:'0',frames:6})
      expect(transport.state().onAir).toMatchObject({startedAt:origin,elapsed:6})
      vi.setSystemTime(instant+1251);event({event:'position',itemId:'0',frames:31});transport.tick()
      expect(transport.state().onAir).toMatchObject({startedAt:origin,elapsed:31})
    }finally{vi.useRealTimers()}
  })
  it('seek explícito recalcula origem uma vez e novo TAKE cria outra ocorrência',async()=>{
    const file=join(directory,'seek-start.mp4');writeFileSync(file,'video');start(view([file]))
    await transport.take('grade','0');const instant=Date.now()
    vi.useFakeTimers({toFake:['Date']})
    try{
      vi.setSystemTime(instant+1000);await transport.seek('pgm',125)
      const origin=framesSinceMidnight(new Date(),channel.rate)-125
      expect(transport.state().onAir!.startedAt).toBe(origin)
      vi.setSystemTime(instant+2001);event({event:'position',itemId:'0',frames:150})
      expect(transport.state().onAir!.startedAt).toBe(origin)
      await transport.take('grade','0')
      expect(transport.state().onAir!.startedAt).toBe(framesSinceMidnight(new Date(),channel.rate))
      expect(transport.state().onAir!.startedAt).not.toBe(origin)
    }finally{vi.useRealTimers()}
  })
  it('posse recusada antes de spawn não abre processo nem envia configuração privada',()=>{
    const reserve=vi.fn();expect(()=>start(view([]),undefined,undefined,undefined,{assertExecutionOwned:()=>{throw new Error('NOT_OWNER')},beforeProcessStart:reserve})).toThrow('NOT_OWNER')
    expect(spawn).not.toHaveBeenCalled();expect(reserve).not.toHaveBeenCalled();expect(commands).toHaveLength(0)
  })
  it('rejeição síncrona do spawn libera somente a reserva desta geração',()=>{
    const reserve=vi.fn(),exit=vi.fn();vi.mocked(spawn).mockImplementationOnce(()=>{throw new Error('INVALID_SPAWN')})
    expect(()=>start(view([]),undefined,undefined,undefined,{beforeProcessStart:reserve,onProcessExited:exit})).toThrow('INVALID_SPAWN')
    expect(reserve).toHaveBeenCalledTimes(1);expect(exit).toHaveBeenCalledWith(null,reserve.mock.calls[0]![0])
  })
  it('falha na confirmação de PID mantém listener de saída e não envia configuração',()=>{
    Object.assign(child,{pid:501});const exit=vi.fn(),reserve=vi.fn(),startup=vi.fn();child.stdin.on('data',startup)
    expect(()=>start(view([]),undefined,undefined,undefined,{beforeProcessStart:reserve,onProcessStarted:()=>{throw new Error('PID_LEDGER_FAILURE')},onProcessExited:exit})).toThrow('PID_LEDGER_FAILURE')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(startup).not.toHaveBeenCalled();expect(exit).not.toHaveBeenCalled()
    child.emit('exit',1,null);expect(exit).toHaveBeenCalledWith(501,reserve.mock.calls[0]![0])
  })
  it('erro com PID não comprova morte; saída real após close mantém token desta geração',()=>{
    Object.assign(child,{pid:501});const reserve=vi.fn(),exit=vi.fn()
    start(view([]),undefined,undefined,undefined,{beforeProcessStart:reserve,onProcessExited:exit,canRestartEngine:()=>false})
    child.emit('error',new Error('IPC_FAILURE'));transport.watchdog();expect(exit).not.toHaveBeenCalled();expect(spawn).toHaveBeenCalledTimes(1)
    transport.close();child.emit('exit',1,null);expect(exit).toHaveBeenCalledWith(501,reserve.mock.calls[0]![0])
  })
  it('posse perdida enquanto espera Ready não envia comando após a confirmação',async()=>{
    let owned=true;transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:['null'],preview:null,bitrateKbps:500,assertExecutionOwned:()=>{if(!owned)throw new Error('OWNER_CHANGED')}})
    const pending=transport.reconfigureOutput({id:'out',kind:'srt',target:'srt://localhost:9000'}),rejected=expect(pending).rejects.toThrow('OWNER_CHANGED')
    await new Promise(resolve=>setTimeout(resolve,10));owned=false;event({event:'ready',channelId:channel.id});await rejected;expect(commands).toHaveLength(0)
  })
  it('posse perdida após preroll impede TAKE e mantém programa anterior',async()=>{
    let owned=true;const path=join(directory,'owned.mp4');writeFileSync(path,'video')
    start(view([path]),undefined,undefined,undefined,{assertExecutionOwned:()=>{if(!owned)throw new Error('OWNER_CHANGED')}})
    holdLoad=true;const taking=transport.take('grade','0'),rejected=expect(taking).rejects.toThrow('OWNER_CHANGED')
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'));owned=false;armed='0';event({event:'state',onAir,armed});ack(commands.at(-1)!.id);await rejected
    expect(commands.some(command=>command.cmd==='take')).toBe(false);expect(transport.state().onAir).toBeNull()
  })
  it('fila reserva comando antes do primeiro microtask e libera após sucesso/erro',async()=>{
    start(view([]))
    const before=transport.commandRevision(),first=transport.cue(null),second=transport.cue(null)
    expect(transport.hasPendingCommand()).toBe(true)
    expect(transport.commandRevision()).toBe(before+2)
    await Promise.all([first,second]);expect(transport.hasPendingCommand()).toBe(false)
    transport.close()
    const failed=transport.cue(null)
    expect(transport.hasPendingCommand()).toBe(true)
    await expect(failed).rejects.toThrow('indisponível')
    expect(transport.hasPendingCommand()).toBe(false);expect(transport.commandRevision()).toBe(before+3)
  })
  it('QC abre a fonte no decodificador próprio: PVW/PGM intactos e CUE do Master não derruba o QC',async()=>{
    transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:['null'],preview:'srt://local/pvw',qcPreview:'srt://local/qc',bitrateKbps:500})
    event({event:'ready',channelId:channel.id})
    await transport.cue({kind:'SOURCE',source:'omt:MASTER'})
    const before=transport.state(),count=commands.length
    await expect(transport.qcMonitor('ndi:ESTÚDIO',true)).rejects.toThrow('não está aberta')
    await transport.openQcSource('ndi:ESTÚDIO');await transport.openQcSource('ndi:ESTÚDIO')
    await transport.qcMonitor('ndi:ESTÚDIO',true)
    expect(commands.slice(count)).toMatchObject([{cmd:'qcSource',item:{itemId:'qc:ndi:ESTÚDIO',source:'ndi:ESTÚDIO'}},{cmd:'qcMonitor',itemId:'qc:ndi:ESTÚDIO',on:true}])
    expect(commands.slice(count).some(command=>['preview','load','take'].includes(String(command.cmd)))).toBe(false)
    expect(transport.state()).toMatchObject({preview:before.preview,onAir:before.onAir,playing:before.playing,preparedItemId:before.preparedItemId})
    // A Master CUE afterwards keeps the QC source open and monitorable.
    await transport.cue({kind:'SOURCE',source:'omt:NOVA'})
    expect(transport.qcSource()).toBe('ndi:ESTÚDIO')
    await transport.qcMonitor('ndi:ESTÚDIO',true)
    await transport.openQcSource(null)
    expect(commands.at(-1)).toMatchObject({cmd:'qcSource',item:null});expect(transport.qcSource()).toBeNull()
    await expect(transport.qcMonitor('ndi:ESTÚDIO',true)).rejects.toThrow('não está aberta')
  })
  it('QC em qualidade indisponível não finge sucesso no transporte sem destino dedicado',async()=>{
    start(view([]));await transport.cue({kind:'SOURCE',source:'ndi:ESTÚDIO'})
    const count=commands.length
    await expect(transport.openQcSource('ndi:ESTÚDIO')).rejects.toThrow('indisponível')
    await expect(transport.qcMonitor('ndi:ESTÚDIO',true)).rejects.toThrow('indisponível')
    expect(commands).toHaveLength(count)
  })
  it('saída inesperada do engine deixa relatório com código e últimas linhas',async()=>{
    const crashes=join(directory,'engine-crashes')
    transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:['null'],preview:null,bitrateKbps:500,crashReportDirectory:crashes})
    event({event:'ready',channelId:channel.id})
    child.stderr.write("thread '<unnamed>' panicked at src/channel.rs:77:9:\nsinal sumiu\n")
    await new Promise(resolve=>setImmediate(resolve))
    child.emit('exit',3221226505,null)
    const files=readdirSync(crashes);expect(files).toHaveLength(1)
    const report=readFileSync(join(crashes,files[0]!),'utf8')
    expect(report).toContain('0xC0000409');expect(report).toContain('panicked at src/channel.rs:77:9');expect(report).toContain('sinal sumiu')
    expect(transport.health().error).toContain('0xC0000409')
  })
  it('comando antes de Ready não começa timeout de decoder nem mata partida fria aos 30s',async()=>{
    vi.useFakeTimers()
    transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:['null'],preview:null,bitrateKbps:500})
    const pending=transport.reconfigureOutput({id:'out',kind:'srt',target:'srt://localhost:9000'})
    await vi.advanceTimersByTimeAsync(35_000)
    expect(commands).toHaveLength(0);expect(child.kill).not.toHaveBeenCalled();expect(transport.health().ready).toBe(false)
    event({event:'ready',channelId:channel.id});await pending
    expect(commands.at(-1)?.cmd).toBe('replaceOutput');expect(child.kill).not.toHaveBeenCalled()
  })
  it('partida que nunca confirma Ready tem prazo finito e recusa todas as ordens aguardando',async()=>{
    vi.useFakeTimers()
    transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:['null'],preview:null,bitrateKbps:500})
    const pending=transport.reconfigureOutput({id:'out',kind:'srt',target:'srt://localhost:9000'}),rejected=expect(pending).rejects.toThrow('90 segundos')
    await vi.advanceTimersByTimeAsync(90_000);await rejected
    expect(commands).toHaveLength(0);expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(transport.health().ready).toBe(false)
  })
  it('CUE solicitado durante discovery aguarda Ready real sem enviar decoder ou confirmar sinal',async()=>{
    const file=join(directory,'cold.mp4');writeFileSync(file,'video')
    transport=new EngineTransport(channel,()=>view([file]),()=>null,{binary:'fake-engine',outputs:['null'],preview:null,bitrateKbps:500})
    const preparing=transport.cue({kind:'ITEM',id:'0'})
    await new Promise(resolve=>setTimeout(resolve,10))
    expect(commands.filter(command=>command.cmd==='preview')).toHaveLength(0);expect(transport.health().ready).toBe(false)
    event({event:'ready',channelId:channel.id});await preparing
    expect(commands.some(command=>command.cmd==='preview')).toBe(true)
  })
  it('queda enquanto aguarda Ready recusa comando e não o reenvia ao processo substituto',async()=>{
    transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:['null'],preview:null,bitrateKbps:500})
    const waiting=transport.reconfigureOutput({id:'out',kind:'srt',target:'srt://localhost:9000'}),rejected=expect(waiting).rejects.toThrow('encerrou')
    await new Promise(resolve=>setTimeout(resolve,10));child.emit('exit',1,null);await rejected
    expect(commands).toHaveLength(0);expect(transport.health().ready).toBe(false)
  })
  it('cerca usa dono privado por processo e nonce nativo, não timer ou credencial nos argumentos',async()=>{
    const lease=vi.fn().mockResolvedValue({term:7,ttlMs:5000}),startup:Array<any>=[]
    child.stdin.on('data',data=>startup.push(JSON.parse(data.toString())));start(view([]),undefined,undefined,undefined,{fenceLease:lease})
    const owner=startup[0].fenceOwner;expect(owner).toMatch(/^[a-f0-9-]{36}$/)
    expect(JSON.stringify(vi.mocked(spawn).mock.calls[0])).not.toContain(owner)
    event({event:'fenceRequest',ownerId:'other',nonce:1});expect(lease).not.toHaveBeenCalled()
    event({event:'fenceRequest',ownerId:owner,nonce:1});await vi.waitFor(()=>expect(commands.some(command=>command.cmd==='fenceGrant')).toBe(true))
    expect(lease).toHaveBeenCalledWith(owner,1);expect(startup.find(command=>command.cmd==='fenceGrant')).toMatchObject({ownerId:owner,nonce:1,term:7,ttlMs:5000})
    event({event:'fenceApplied',nonce:1,term:7});event({event:'ready',channelId:channel.id})
    expect(transport.health()).toMatchObject({ready:true,fencing:{enabled:true,term:7,nonce:1}})
  })
  it('engine que anuncia ready sem aplicar concessão nativa é recusado',()=>{
    start(view([]),undefined,undefined,undefined,{fenceLease:async()=>({term:1,ttlMs:5000})})
    event({event:'ready',channelId:channel.id});expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(transport.health().ready).toBe(false)
  })
  it('resposta de concessão depois de fechar o transporte não é encaminhada',async()=>{
    let release!:(value:{term:number;ttlMs:number})=>void;const pending=new Promise<{term:number;ttlMs:number}>(resolve=>release=resolve),startup:Array<any>=[]
    child.stdin.on('data',data=>startup.push(JSON.parse(data.toString())));start(view([]),undefined,undefined,undefined,{fenceLease:()=>pending})
    event({event:'fenceRequest',ownerId:startup[0].fenceOwner,nonce:1});transport.close();release({term:1,ttlMs:5000})
    await new Promise(resolve=>setTimeout(resolve,10));expect(commands.some(command=>command.cmd==='fenceGrant')).toBe(false)
  })
  it('inserção NEXT prepara arquivo sem TAKE nem apagar CUE',async()=>{
    const file=join(directory,'pgm.mp4');writeFileSync(file,'video');const value=view([file]);start(value)
    await transport.cue({kind:'ITEM',id:'0'});const original=transport.state().preview
    await transport.insertOperational(async controls=>controls.prepare(value,'0',()=>true))
    expect(commands.some(command=>command.cmd==='take')).toBe(false);expect(transport.state().preview).toEqual(original)
  })
  it('inserção NOW de live espera identidade real de PGM; ACK de conexão não comita',async()=>{
    const file=join(directory,'pgm.mp4');writeFileSync(file,'video');const original=view([file]);start(original);await transport.take('grade','0')
    const candidate=view(['live']);Object.assign(candidate.items[0]!,{item:{...candidate.items[0]!.item,id:'urgent',type:'LIVE',sourceRef:'omt:ESTÚDIO',durationOverride:250},asset:null})
    const commit=vi.fn(()=>Object.assign(original,candidate)),beforeTake=vi.fn();holdLiveTake=true
    const taking=transport.insertOperational(async controls=>controls.take(candidate,'urgent',()=>true,beforeTake,commit))
    await vi.waitFor(()=>expect(commands.filter(command=>command.cmd==='take')).toHaveLength(2))
    expect(commit).not.toHaveBeenCalled();expect(transport.state().onAir?.itemId).toBe('0');expect(transport.hasPendingCommand()).toBe(true)
    onAir='urgent';armed=undefined;event({event:'state',onAir,armed});await taking
    expect(commit).toHaveBeenCalledTimes(1);expect(beforeTake).toHaveBeenCalledTimes(1);expect(transport.state().onAir?.itemId).toBe('urgent')
    expect(transport.state().liveSources?.find(signal=>signal.source==='omt:ESTÚDIO')?.state).toBe('ON_PGM')
  })
  it('falha de live depois de ACK cancela entrada pendente e não comita outra revisão',async()=>{
    const file=join(directory,'pgm.mp4');writeFileSync(file,'video');start(view([file]));await transport.take('grade','0')
    const candidate=view(['live']);Object.assign(candidate.items[0]!,{item:{...candidate.items[0]!.item,id:'urgent',type:'LIVE',sourceRef:'ndi:CAM'},asset:null})
    const commit=vi.fn();holdLiveTake=true
    const taking=transport.insertOperational(async controls=>controls.take(candidate,'urgent',()=>true,()=>{},commit)),result=expect(taking).rejects.toThrow('sem sinal')
    await vi.waitFor(()=>expect(commands.filter(command=>command.cmd==='take')).toHaveLength(2))
    event({event:'itemError',itemId:'urgent',message:'sem sinal'});await result
    expect(commit).not.toHaveBeenCalled();expect(commands.filter(command=>command.cmd==='cancelTake')).toHaveLength(1);expect(transport.state().onAir?.itemId).toBe('0')
  })
  it('retorno registra intenção antes do TAKE e confirmação antes da limpeza PVW',async()=>{
    const path=join(directory,'retorno.mp4');writeFileSync(path,'video');start(view([path]))
    const phases:string[]=[],validate=vi.fn(()=>phases.push('validate'))
    child.stdin.on('data',data=>{const command=JSON.parse(data.toString());if(command.cmd==='take')expect(phases.at(-1)).toBe('switching');if(command.cmd==='preview')expect(phases.at(-1)).toBe('confirmed')})
    await transport.takeWithLifecycle('grade','0',143,{validate,beforeTake:()=>phases.push('switching'),confirmed:native=>{expect(native).toBe(true);expect(transport.state().onAir?.itemId).toBe('0');phases.push('confirmed')}})
    expect(validate).toHaveBeenCalledTimes(2)
    expect(commands.find(command=>command.cmd==='load')?.item).toMatchObject({startOffsetFrames:143})
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
  })
  it('revogação após preroll preserva PGM e nunca troca para outro candidato',async()=>{
    const path=join(directory,'retorno.mp4');writeFileSync(path,'video');start(view([path]));holdLoad=true
    const confirmed=vi.fn(),beforeTake=vi.fn(()=>{throw new Error('permissão revogada')})
    const taking=transport.takeWithLifecycle('grade','0',143,{validate:()=>{},beforeTake,confirmed}),result=expect(taking).rejects.toThrow('permissão revogada')
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'));armed='0';event({event:'state',onAir,armed});ack(commands.at(-1)!.id)
    await result;expect(beforeTake).toHaveBeenCalledTimes(1);expect(confirmed).not.toHaveBeenCalled();expect(commands.some(command=>command.cmd==='take')).toBe(false)
  })
  it('ACK recusado após despacho não confirma nem repete retorno',async()=>{
    const path=join(directory,'retorno.mp4');writeFileSync(path,'video');start(view([path]));rejectTakeAck=true
    const beforeTake=vi.fn(),confirmed=vi.fn()
    await expect(transport.takeWithLifecycle('grade','0',143,{validate:()=>{},beforeTake,confirmed})).rejects.toThrow('decoder recusou')
    expect(beforeTake).toHaveBeenCalledTimes(1);expect(confirmed).not.toHaveBeenCalled();expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
  })
  it('pendência durante preroll bloqueia novo TAKE normal antes do despacho',async()=>{
    const path=join(directory,'pgm.mp4');writeFileSync(path,'video');let permitted=true
    start(view([path]),undefined,undefined,undefined,{canStartProgram:()=>permitted});holdLoad=true
    const taking=transport.take('grade','0'),result=expect(taking).rejects.toThrow('inconclusivo')
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'));permitted=false;armed='0';event({event:'state',onAir,armed});ack(commands.at(-1)!.id)
    await result;expect(commands.some(command=>command.cmd==='take')).toBe(false)
    await expect(transport.take('grade','0')).rejects.toThrow('inconclusivo')
    expect(commands).toHaveLength(1)
  })
  it('watchdog usa destino confirmado, não uma tentativa sem commit',async()=>{
    const bootstraps:unknown[]=[]
    child.stdin.on('data',data=>{const value=JSON.parse(data.toString());if(!value.cmd)bootstraps.push(value)})
    const old={id:'out',kind:'srt' as const,target:'srt://localhost:9000'},confirmed={...old,target:'srt://localhost:9001'}
    transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:[JSON.stringify(old)],preview:null,bitrateKbps:500})
    event({event:'ready',channelId:channel.id})
    await transport.mutateConfiguration(async apply=>{await apply(confirmed);transport.commitOutputProfile(confirmed)})
    await transport.reconfigureOutput({...old,target:'srt://localhost:9999'}) // ACK alone is not DB commit.
    child.emit('exit',1,null)
    let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now)
    transport.watchdog();now+=10_000;transport.watchdog()
    expect(bootstraps).toEqual([{outputs:[JSON.stringify(old)],preview:null},{outputs:[JSON.stringify(confirmed)],preview:null}])
    expect(()=>transport.commitOutputProfile({...old,id:'absent'})).toThrow('não pertence')
  })
  it('configuração incerta bloqueia restart de publishers; nova decisão explícita permite restart',()=>{
    let permitted=true
    transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:['null'],preview:null,bitrateKbps:500,canRestartEngine:()=>permitted})
    const before=vi.mocked(spawn).mock.calls.length
    child.emit('exit',1,null);permitted=false
    let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now)
    transport.watchdog();now+=100_000;transport.watchdog();expect(vi.mocked(spawn).mock.calls).toHaveLength(before)
    permitted=true;transport.watchdog();now+=10_000;transport.watchdog();expect(vi.mocked(spawn).mock.calls).toHaveLength(before+1)
  })
  it('publicação obrigatória sem SHA verificável não usa presença de arquivo como aprovação',async()=>{
    const path=join(directory,'sem-versao.mkv');writeFileSync(path,'video')
    const value=view([path]);Object.assign(value.rundown,{publicationRequired:true})
    Object.assign(value.items[0]!.asset!,{contentHash:undefined})
    start(value);await expect(transport.take('grade','0')).rejects.toThrow('sem SHA válido')
    expect(commands).toHaveLength(0);expect(transport.state().onAir).toBeNull()
  })
  it('uma publicação já ativada continua exigindo SHA mesmo após limpar o flag editorial',async()=>{
    const path=join(directory,'publicado-sem-versao.mkv');writeFileSync(path,'video')
    const value=view([path]);Object.assign(value.rundown,{publicationRequired:false});Object.assign(value.items[0]!.asset!,{contentHash:undefined})
    start(value,undefined,()=>value,()=> 'revision-activated')
    await expect(transport.take('grade','0')).rejects.toMatchObject({statusCode:409,code:'MEDIA_VERSION_CHANGED',message:expect.stringContaining('sem SHA válido')})
    expect(commands).toHaveLength(0)
  })
  it('bloqueia SHA alterado após CUE/preroll sem novo TAKE nem alteração de PGM', async () => {
    const first=join(directory,'PGM.mkv'),second=join(directory,'APROVAÇÃO-ÇÃÓ.mkv')
    writeFileSync(first,'programa');writeFileSync(second,'original')
    const value=view([first,second]);Object.assign(value.items[1]!.asset!,{contentHash:createHash('sha256').update('original').digest('hex')})
    start(value);await transport.take('grade','0');await transport.cue({kind:'ITEM',id:'1'})
    writeFileSync(second,'alterado')
    const count=commands.length
    await expect(transport.take('grade','1')).rejects.toMatchObject({statusCode:409,code:'MEDIA_VERSION_CHANGED',message:expect.stringContaining('versão publicada')})
    expect(commands).toHaveLength(count);expect(transport.state().onAir?.itemId).toBe('0')
    await expect(transport.cue({kind:'ITEM',id:'1'})).rejects.toThrow('versão publicada')
    writeFileSync(second,'original');await transport.cue({kind:'ITEM',id:'1'});holdLoad=true
    const take=transport.take('grade','1'),result=expect(take).rejects.toThrow('versão publicada')
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'))
    writeFileSync(second,'alterado');armed='1';event({event:'state',onAir,armed});ack(commands.at(-1)!.id)
    await result;expect(transport.state().onAir?.itemId).toBe('0')
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
    holdLoad=false;writeFileSync(second,'original');await transport.cue({kind:'ITEM',id:'1'});await transport.take('grade','1')
    expect(transport.state().onAir?.itemId).toBe('1')
  })
  it('restaurar os mesmos bytes não reutiliza decoder preparado em outro estado do arquivo',async()=>{
    const first=join(directory,'pgm.mkv'),second=join(directory,'mutante.mkv')
    writeFileSync(first,'programa');writeFileSync(second,'original')
    const value=view([first,second]);Object.assign(value.items[1]!.asset!,{contentHash:createHash('sha256').update('original').digest('hex')})
    start(value);await transport.take('grade','0');holdLoad=true
    const action=transport.take('grade','1'),result=expect(action).rejects.toThrow('alterado durante o preroll')
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'))
    writeFileSync(second,'alterado');writeFileSync(second,'original')
    armed='1';event({event:'state',onAir,armed});ack(commands.at(-1)!.id)
    await result;expect(transport.state().onAir?.itemId).toBe('0')
    const loads=commands.filter(command=>command.cmd==='load').length
    holdLoad=false;await transport.take('grade','1')
    expect(commands.filter(command=>command.cmd==='load')).toHaveLength(loads+1)
    await transport.cue({kind:'ITEM',id:'1'});writeFileSync(second,'original')
    await expect(transport.take('grade','1')).rejects.toThrow('mudou após o CUE')
  })
  it('mudança do SHA publicado após CUE exige novo CUE mesmo no mesmo caminho',async()=>{
    const path=join(directory,'arquivo.mkv');writeFileSync(path,'original')
    const value=view([path]);Object.assign(value.items[0]!.asset!,{contentHash:createHash('sha256').update('original').digest('hex')})
    start(value);await transport.cue({kind:'ITEM',id:'0'})
    writeFileSync(path,'alterado');Object.assign(value.items[0]!.asset!,{contentHash:createHash('sha256').update('alterado').digest('hex')})
    const count=commands.length;await expect(transport.take('grade','0')).rejects.toThrow('mudou após o CUE')
    expect(commands).toHaveLength(count);await transport.cue({kind:'ITEM',id:'0'});await transport.take('grade','0')
    expect(transport.state().onAir?.itemId).toBe('0')
  })
  it('playlist alternativa com arquivo substituído durante preroll não comita nem corta',async()=>{
    const original=join(directory,'pgm.mkv'),backup=join(directory,'reserva.mkv')
    writeFileSync(original,'programa');writeFileSync(backup,'original')
    start(view([original]));await transport.take('grade','0');const candidate=alternate(backup)
    Object.assign(candidate.items[0]!.asset!,{contentHash:createHash('sha256').update('original').digest('hex')})
    holdLoad=true;const commit=vi.fn(),action=transport.takeFromPlaylist(candidate,'backup-item',commit,()=>true)
    const result=expect(action).rejects.toThrow('versão publicada')
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'))
    writeFileSync(backup,'alterado');armed='backup-item';event({event:'state',onAir,armed});ack(commands.at(-1)!.id)
    await result;expect(commit).not.toHaveBeenCalled();expect(transport.state().onAir?.itemId).toBe('0')
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
  })
  it('envia matriz de arquivo/live e alteração de roteamento exige novo CUE',async()=>{
    const good=join(directory,'4ch.mkv');writeFileSync(good,'video')
    const value=view([good]);Object.assign(value.items[0]!,{audio:{mode:'MANUAL',gainDb:0,measured:null,routing:{mode:'STEREO_3_4'}}})
    start(value);await transport.cue({kind:'ITEM',id:'0'})
    expect(commands.at(-1)).toMatchObject({cmd:'preview',item:{audioRouting:{mode:'STEREO_3_4'}}})
    Object.assign(value.items[0]!,{audio:{mode:'MANUAL',gainDb:0,measured:null,routing:{mode:'LEFT_ONLY'}}})
    await expect(transport.take('grade','0')).rejects.toThrow('mudou após o CUE')
    await transport.cue({kind:'ITEM',id:'0'});await transport.take('grade','0')
    expect(commands.find(command=>command.cmd==='load')).toMatchObject({item:{audioRouting:{mode:'LEFT_ONLY'}}})
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:QA',audioTrack:1}})
    await transport.cue({kind:'ITEM',id:'0'})
    expect(commands.at(-1)).toMatchObject({item:{source:'ndi:QA',audioTrack:1,audioRouting:{mode:'LEFT_ONLY'}}})
  })
  it('caminho do GStreamer sem barra final ainda aponta para a pasta bin', () => {
    vi.stubEnv('GSTREAMER_1_0_ROOT_MSVC_X86_64', directory)
    start(view([]))
    if (process.platform === 'win32') expect(vi.mocked(spawn).mock.calls[0]![2]?.env?.PATH?.split(';')[0]).toBe(join(directory,'bin'))
  })
  it('envia pares auxiliares explícitos e mudança após CUE impede TAKE',async()=>{
    const good=join(directory,'embedded.mkv');writeFileSync(good,'video')
    const value=view([good]);Object.assign(value.items[0]!,{audio:{mode:'OFF',gainDb:0,measured:null,auxiliaryPairs:[{outputPair:2,inputPair:2,gainDb:-6}]}})
    transport=new EngineTransport({...channel,audioChannels:8},()=>value,()=>null,{binary:'fake-engine',outputs:['null'],preview:null,bitrateKbps:500})
    event({event:'ready',channelId:channel.id})
    expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('--audio-channels');expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain('8')
    await transport.cue({kind:'ITEM',id:'0'})
    expect(commands.at(-1)).toMatchObject({item:{auxiliaryPairs:[{outputPair:2,inputPair:2,gainDb:-6}]}})
    Object.assign(value.items[0]!,{audio:{mode:'OFF',gainDb:0,measured:null,auxiliaryPairs:[{outputPair:2,inputPair:1,gainDb:0}]}})
    await expect(transport.take('grade','0')).rejects.toThrow('mudou após o CUE')
    await transport.cue({kind:'ITEM',id:'0'});await transport.take('grade','0')
    expect(commands.find(c=>c.cmd==='load')).toMatchObject({item:{auxiliaryPairs:[{outputPair:2,inputPair:1,gainDb:0}]}})
  })
  it('configuração de saída aguarda seu ACK antes do commit e não reentra na fila', async () => {
    start(view([]))
    let committed = false
    await transport.mutateConfiguration(async apply => {
      expect(commands).toHaveLength(0)
      await apply({ id: 'out', kind: 'srt', target: 'srt://127.0.0.1:9000' })
      expect(commands.at(-1)?.cmd).toBe('replaceOutput')
      committed = true
    })
    expect(committed).toBe(true)
    expect(commands.map(command => command.cmd)).toEqual(['replaceOutput'])
  })
  it('configuração recusada pelo engine não chega ao commit', async () => {
    start(view([])); child.stdin.removeAllListeners('data')
    child.stdin.on('data', (data: Buffer) => { const command = JSON.parse(data.toString()); commands.push(command); queueMicrotask(() => ack(command.id, false)) })
    const commit = vi.fn()
    await expect(transport.mutateConfiguration(async apply => {
      await apply({ id: 'out', kind: 'srt', target: 'srt://127.0.0.1:9000' }); commit()
    })).rejects.toThrow('decoder recusou')
    expect(commit).not.toHaveBeenCalled()
  })
  it('live aguardando quadro impede o trabalho de configuração antes de qualquer alteração', async () => {
    const value = view(['live']); Object.assign(value.items[0]!, { item: { ...value.items[0]!.item, type: 'LIVE', sourceRef: 'ndi:CAM' }, asset: null })
    start(value); holdLiveTake = true; await transport.take('grade', '0')
    const work = vi.fn(async () => 'configurado')
    await expect(transport.mutateConfiguration(work)).rejects.toThrow('aguardando confirmação')
    expect(work).not.toHaveBeenCalled()
  })
  it('retirar o runtime na fila impede que comandos antigos alcancem o engine encerrado', async () => {
    const file = join(directory, 'primeiro.mkv'); writeFileSync(file, 'video')
    start(view([file])); await transport.take('grade', '0')
    let release!: () => void
    const retiring = transport.mutatePlaylist(async () => { await new Promise<void>(resolve => { release = resolve }); transport.close(); return 'retirado' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const count = commands.length, oldCue = transport.cue({ kind: 'ITEM', id: '0' })
    const rejected = expect(oldCue).rejects.toThrow('indisponível')
    release(); expect(await retiring).toBe('retirado'); await rejected
    expect(commands.slice(count).map(command => command.cmd)).toEqual(['shutdown'])
    expect(transport.health().ready).toBe(false)
  })
  it('retomada repete apenas preroll quando surge cópia verificada do mesmo hash, sem cortar para caminho antigo', async () => {
    const original = join(directory, 'original.mkv'), cached = join(directory, 'copia.mkv')
    writeFileSync(original, 'video'); writeFileSync(cached, 'video')
    const value = view([original]); Object.assign(value.items[0]!.asset!, { contentHash: createHash('sha256').update('video').digest('hex') })
    start(value); holdLoad = true
    const take = transport.take('grade', '0', 125)
    await vi.waitFor(() => expect(commands.at(-1)?.cmd).toBe('load'))
    Object.assign(value.items[0]!.asset!, { path: cached }); holdLoad = false
    armed = '0'; event({ event: 'state', onAir, armed }); ack(commands.at(-1)!.id)
    await take
    expect(commands.filter(command => command.cmd === 'load').map(command => command.item?.path)).toEqual([original, cached])
    expect(commands.filter(command => command.cmd === 'take')).toHaveLength(1)
    expect(transport.state().onAir).toMatchObject({ itemId: '0', elapsed: 125 })
  })
  it('não leva ao PGM cortes novos de um item cujo CUE ainda representa o contrato anterior', async () => {
    const first = join(directory, 'primeiro.mkv'), second = join(directory, 'segundo.mkv')
    writeFileSync(first, 'video'); writeFileSync(second, 'video')
    const value = view([first, second]); start(value); await transport.take('grade', '0'); await transport.cue({ kind: 'ITEM', id: '1' })
    Object.assign(value.items[1]!.trim, { in: 100, out: 200 })
    const count = commands.length
    await expect(transport.take('grade', '1')).rejects.toThrow('mudou após o CUE')
    expect(commands).toHaveLength(count); expect(transport.state().onAir?.itemId).toBe('0')
    await transport.cue({ kind: 'ITEM', id: '1' }); await transport.take('grade', '1')
    expect(transport.state().onAir?.itemId).toBe('1')
  })
  it('publicação aguarda TAKE e bloqueia novo comando até instalar a revisão', async () => {
    const first = join(directory, 'primeiro.mkv'), second = join(directory, 'segundo.mkv')
    writeFileSync(first, 'video'); writeFileSync(second, 'video')
    start(view([first, second])); await transport.take('grade', '0')
    holdLoad = true
    const take = transport.take('grade', '1')
    await vi.waitFor(() => expect(commands.at(-1)?.cmd).toBe('load'))
    let release!: () => void
    const mutation = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }); return 'revisão instalada' })
    const published = transport.mutatePlaylist(mutation)
    expect(mutation).not.toHaveBeenCalled()
    armed = '1'; event({ event: 'state', onAir, armed }); ack(commands.at(-1)!.id)
    await take; await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
    expect(transport.state().onAir?.itemId).toBe('1')
    const count = commands.length, cue = transport.cue(null)
    await Promise.resolve(); expect(commands).toHaveLength(count)
    release(); expect(await published).toBe('revisão instalada'); await cue
    expect(commands.at(-1)?.cmd).toBe('preview')
  })
  it('ACK de live pendente não libera alteração de playlist; CUE cancela e libera', async () => {
    const value = view(['live']); Object.assign(value.items[0]!, { item: { ...value.items[0]!.item, type: 'LIVE', sourceRef: 'ndi:CAM' }, asset: null })
    start(value); holdLiveTake = true; await transport.take('grade', '0')
    const mutation = vi.fn(async () => 'publicado')
    await expect(transport.mutatePlaylist(mutation)).rejects.toThrow('aguardando confirmação')
    expect(mutation).not.toHaveBeenCalled()
    expect(await transport.mutatePlaylist(async () => 'grade futura publicada', () => false)).toBe('grade futura publicada')
    expect(transport.state().onAir).toBeNull()
    await transport.cue(null)
    expect(await transport.mutatePlaylist(mutation)).toBe('publicado')
  })
  it('mudança de revisão durante preroll recusa corte mesmo com mídia igual', async () => {
    const first = join(directory, 'primeiro.mkv'), second = join(directory, 'segundo.mkv')
    writeFileSync(first, 'video'); writeFileSync(second, 'video')
    let revision = 'rev1'; const value = view([first, second])
    start(value, undefined, () => value, () => revision); await transport.take('grade', '0')
    holdLoad = true; const take = transport.take('grade', '1')
    const result = expect(take).rejects.toMatchObject({statusCode:409,message:expect.stringContaining('revisão ou a mídia mudou')})
    await vi.waitFor(() => expect(commands.at(-1)?.cmd).toBe('load'))
    revision = 'rev2'; armed = '1'; event({ event: 'state', onAir, armed }); ack(commands.at(-1)!.id)
    await result
    expect(transport.state().onAir?.itemId).toBe('0')
    expect(commands.filter(command => command.cmd === 'take')).toHaveLength(1)
  })
  function alternate(path: string): RundownView {
    const candidate = view([path], true)
    Object.assign(candidate.rundown, { id: 'backup-grade' })
    Object.assign(candidate.items[0]!.item, { id: 'backup-item' })
    Object.assign(candidate.schedule.items[0]!, { id: 'backup-item' })
    return candidate
  }
  it('prepara outra playlist sem trocar plano/PGM/CUE e instala antes do as-run confirmado', async () => {
    const original = join(directory, 'original.mkv'), backup = join(directory, 'reserva.mkv')
    writeFileSync(original, 'video'); writeFileSync(backup, 'video')
    let active = view([original])
    const candidate = alternate(backup), confirmed = vi.fn<NonNullable<ConstructorParameters<typeof EngineTransport>[3]['onTakeConfirmed']>>(() => {
      if (onAir === 'backup-item') expect(active).toBe(candidate)
    })
    start(active, confirmed, () => active)
    await transport.take('grade', '0'); await transport.cue({ kind: 'ITEM', id: '0' })
    event({ event: 'position', itemId: '0', frames: 125, duration: 250 })
    holdLoad = true
    const commit = vi.fn(() => { active = candidate })
    const action = transport.takeFromPlaylist(candidate, 'backup-item', commit, () => active.rundown.id === 'grade')
    await vi.waitFor(() => expect(commands.at(-1)?.cmd).toBe('load'))
    expect(active.rundown.id).toBe('grade'); expect(commit).not.toHaveBeenCalled()
    expect(transport.state()).toMatchObject({ rundownId: 'grade', onAir: { itemId: '0' }, preview: { kind: 'ITEM', id: '0' } })
    event({ event: 'position', itemId: '0', frames: 143, duration: 250 })
    armed = 'backup-item'; event({ event: 'state', onAir, armed }); ack(commands.at(-1)!.id)
    await action
    expect(commit).toHaveBeenCalledTimes(1)
    expect(confirmed.mock.calls.at(-1)?.[3]).toMatchObject({ itemId: '0', frames: 143, reason: 'CONTINGENCY' })
    expect(transport.state()).toMatchObject({ rundownId: 'backup-grade', onAir: { itemId: 'backup-item' }, preview: null })
  })
  it('arquivo alternativo recusado preserva o plano publicado, o PGM e o CUE', async () => {
    const original = join(directory, 'original.mkv'), bad = join(directory, 'reserva-corrompida.mkv')
    writeFileSync(original, 'video'); writeFileSync(bad, 'bad')
    start(view([original])); await transport.take('grade', '0'); await transport.cue({ kind: 'ITEM', id: '0' })
    const commit = vi.fn(); rejectLoad = bad
    const takes = commands.filter(command => command.cmd === 'take').length
    await expect(transport.takeFromPlaylist(alternate(bad), 'backup-item', commit, () => true)).rejects.toThrow('decoder recusou')
    expect(commit).not.toHaveBeenCalled()
    expect(commands.filter(command => command.cmd === 'take')).toHaveLength(takes)
    expect(transport.state()).toMatchObject({ rundownId: 'grade', onAir: { itemId: '0' }, preview: { kind: 'ITEM', id: '0' } })
  })
  it('mudança de publicação durante o preroll impede o corte para uma preparação obsoleta', async () => {
    const original = join(directory, 'original.mkv'), backup = join(directory, 'reserva.mkv')
    writeFileSync(original, 'video'); writeFileSync(backup, 'video')
    start(view([original])); await transport.take('grade', '0'); holdLoad = true
    let current = true
    const commit = vi.fn(), action = transport.takeFromPlaylist(alternate(backup), 'backup-item', commit, () => current)
    const rejection = expect(action).rejects.toThrow('mudou durante o preroll')
    await vi.waitFor(() => expect(commands.at(-1)?.cmd).toBe('load'))
    current = false; armed = 'backup-item'; event({ event: 'state', onAir, armed }); ack(commands.at(-1)!.id)
    await rejection
    expect(commit).not.toHaveBeenCalled(); expect(transport.state().onAir?.itemId).toBe('0')
    expect(commands.filter(command => command.cmd === 'take')).toHaveLength(1)
  })
  it('ACK sem identidade no PGM não ativa a playlist alternativa', async () => {
    const original = join(directory, 'original.mkv'), backup = join(directory, 'reserva.mkv')
    writeFileSync(original, 'video'); writeFileSync(backup, 'video')
    start(view([original])); await transport.take('grade', '0'); holdLiveTake = true
    const commit = vi.fn()
    await expect(transport.takeFromPlaylist(alternate(backup), 'backup-item', commit, () => true)).rejects.toThrow('sem confirmação')
    expect(commit).not.toHaveBeenCalled(); expect(transport.state()).toMatchObject({ rundownId: 'grade', onAir: { itemId: '0' } })
  })
  it('confirmação física de identidade prevalece sobre ACK recusado após o corte', async () => {
    const backup = join(directory, 'reserva.mkv'); writeFileSync(backup, 'video')
    const candidate = alternate(backup); start(view([])); rejectTakeAck = true
    const commit = vi.fn()
    await transport.takeFromPlaylist(candidate, 'backup-item', commit, () => true)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(transport.state()).toMatchObject({ rundownId: 'backup-grade', onAir: { itemId: 'backup-item' } })
  })
  it('fonte live e playlist de outro canal não são aceitas pela preparação de arquivos', async () => {
    const candidate = alternate('live')
    Object.assign(candidate.items[0]!, { item: { ...candidate.items[0]!.item, sourceRef: 'ndi:CAM' }, asset: null })
    start(view([])); const commit = vi.fn()
    await expect(transport.takeFromPlaylist(candidate, 'backup-item', commit, () => true)).rejects.toThrow('arquivo de vídeo aprovado')
    Object.assign(candidate.rundown, { channelId: 'outro-canal' })
    await expect(transport.takeFromPlaylist(candidate, 'backup-item', commit, () => true)).rejects.toThrow('outro canal')
    expect(commands).toHaveLength(0); expect(commit).not.toHaveBeenCalled()
  })
  it('identidade já no PGM não é confundida com confirmação de uma nova playlist', async () => {
    const file = join(directory, 'original.mkv'); writeFileSync(file, 'video')
    const current = view([file]); start(current); await transport.take('grade', '0')
    const commit = vi.fn(), count = commands.length
    await expect(transport.takeFromPlaylist(current, '0', commit, () => true)).rejects.toThrow('já está no PGM')
    expect(commands).toHaveLength(count); expect(commit).not.toHaveBeenCalled()
  })
  it('registra a posição anterior e distingue TAKE manual de fim natural',async()=>{
    const first=join(directory,'primeiro.mkv'),second=join(directory,'segundo.mkv')
    writeFileSync(first,'video');writeFileSync(second,'video')
    const confirmed=vi.fn()
    start(view([first,second]),confirmed)
    await transport.take('grade','0');event({event:'position',itemId:'0',frames:125,duration:250})
    await transport.take('grade','1')
    expect(confirmed.mock.calls[1]?.[3]).toMatchObject({itemId:'0',frames:125,reason:'TAKE'})
    await transport.take('grade','0');event({event:'position',itemId:'0',frames:250,duration:250});event({event:'eos',itemId:'0'})
    await vi.waitFor(()=>expect(confirmed.mock.calls.at(-1)?.[0]).toBe('1'))
    expect(confirmed.mock.calls.at(-1)?.[3]).toMatchObject({itemId:'0',frames:250,reason:'EOS'})
  })
  it('confirma o corte para live com a última posição do VT, não o instante do ACK',async()=>{
    const first=join(directory,'atual.mkv');writeFileSync(first,'video')
    const value=view([first,'live']),confirmed=vi.fn()
    Object.assign(value.items[1]!,{item:{...value.items[1]!.item,type:'LIVE',sourceRef:'ndi:CAM'},asset:null})
    start(value,confirmed);await transport.take('grade','0')
    event({event:'position',itemId:'0',frames:100,duration:250})
    holdLiveTake=true;await transport.take('grade','1')
    expect(confirmed).toHaveBeenCalledTimes(1)
    event({event:'position',itemId:'0',frames:145,duration:250})
    onAir='1';event({event:'state',onAir})
    expect(confirmed.mock.calls[1]?.[3]).toMatchObject({itemId:'0',frames:145,reason:'TAKE'})
  })
  it('erro assíncrono do áudio da live cancela o TAKE pendente sem reiniciar nem substituir o PGM',async()=>{
    const first=join(directory,'atual.mkv');writeFileSync(first,'video')
    const value=view([first,'live']),confirmed=vi.fn()
    Object.assign(value.items[1]!,{item:{...value.items[1]!.item,type:'LIVE',sourceRef:'ndi:CAM'},asset:null})
    start(value,confirmed);await transport.take('grade','0');holdLiveTake=true
    await transport.take('grade','1');expect(transport.hasPendingCommand()).toBe(true)
    event({event:'itemError',itemId:'1',bus:'pgm',message:'par auxiliar indisponível; PGM anterior preservado'})
    armed=undefined;event({event:'state',onAir:'0'})
    expect(transport.hasPendingCommand()).toBe(false)
    expect(transport.state().onAir?.itemId).toBe('0');expect(confirmed).toHaveBeenCalledTimes(1)
    expect(child.kill).not.toHaveBeenCalled();expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
    holdLiveTake=false;await transport.take('grade','1')
    expect(transport.state().onAir?.itemId).toBe('1');expect(confirmed).toHaveBeenCalledTimes(2)
  })
  it('recalcula a duração ao vivo publicada sem antecipar a saída e respeita operação manual', async () => {
    const next = join(directory, 'proximo.mkv'); writeFileSync(next, 'video')
    const value = view(['live', next])
    Object.assign(value.items[0]!, { item: { ...value.items[0]!.item, type: 'LIVE', sourceRef: 'ndi:CAM', durationOverride: 250, liveAutoFollowOnEnd: true }, asset: null })
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
    start(value); event({ event: 'ready', channelId: channel.id }); await transport.take('grade', '0')
    Object.assign(value.items[0]!.item, { durationOverride: 500 })
    now += 11000; transport.tick()
    expect(transport.state().onAir?.itemId).toBe('0')
    Object.assign(value.items[0]!.item, { liveAutoFollowOnEnd: false })
    now += 30000; transport.tick()
    expect(transport.state().onAir?.itemId).toBe('0')
    Object.assign(value.items[0]!.item, { liveAutoFollowOnEnd: true })
    transport.tick()
    await vi.waitFor(() => expect(transport.state().onAir?.itemId).toBe('1'))
  })
  it('TAKE manual de arquivo ausente não abre outro item silenciosamente', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video')
    start(view([join(directory, 'sumiu.mkv'), good]))
    await expect(transport.take('grade', '0')).rejects.toThrow('Arquivo indisponível')
    expect(commands).toHaveLength(0)
    await transport.take('grade', '1')
    expect(commands.filter((c) => c.cmd === 'load').map((c) => c.item?.itemId)).toEqual(['1'])
    // Nothing was armed in PVW: there is no preview to consume or clear.
    expect(commands.map((c) => c.cmd)).toEqual(['load', 'take'])
    expect(transport.state().onAir?.itemId).toBe('1')
  })
  it('avanço automático da grade não apaga o ao vivo armado pelo operador no PVW; TAKE dele consome o PVW', async () => {
    const a = join(directory, 'a.mkv'), b = join(directory, 'b.mkv'); writeFileSync(a, 'video'); writeFileSync(b, 'video')
    start(view([a, b]))
    await transport.take('grade', '0')
    await transport.cue({ kind: 'SOURCE', source: 'ndi:VMIX', title: 'vMix' })
    expect(transport.state().preview).toMatchObject({ kind: 'SOURCE', source: 'ndi:VMIX' })
    const before = commands.length
    event({ event: 'eos', itemId: '0' })
    await vi.waitFor(() => expect(transport.state().onAir?.itemId).toBe('1'))
    expect(commands.slice(before).map((c) => c.cmd)).not.toContain('preview')
    expect(transport.state().preview).toMatchObject({ kind: 'SOURCE', source: 'ndi:VMIX' })
  })
  it('não anuncia no ar nem dispara take enquanto load está pendente', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video'); holdLoad = true
    start(view([good]))
    const action = transport.take('grade', '0')
    await vi.waitFor(() => expect(commands).toHaveLength(1))
    expect(transport.state().onAir).toBeNull()
    armed = '0'; event({ event: 'state', armed }); ack(commands[0]!.id)
    await action
    expect(transport.state().onAir?.itemId).toBe('0')
  })
  it('recusa do decoder não dispara TAKE manual no item seguinte', async () => {
    const bad = join(directory, 'corrompido.mkv'); const good = join(directory, 'bom.mkv')
    writeFileSync(bad, 'x'); writeFileSync(good, 'video'); rejectLoad = bad
    start(view([bad, good], true)); await expect(transport.take('grade', '0')).rejects.toThrow('decoder recusou')
    expect(commands.map((c) => c.cmd)).toEqual(['load'])
    await transport.take('grade', '1')
    expect(transport.state().onAir?.itemId).toBe('1')
  })
  it('avanço automático continua pulando arquivos ausentes e preserva ordem de load/TAKE', async () => {
    const first = join(directory, 'atual.mkv'), good = join(directory, 'seguinte.mkv')
    writeFileSync(first, 'video'); writeFileSync(good, 'video')
    start(view([first, join(directory, 'ausente.mkv'), good])); await transport.take('grade', '0')
    event({ event: 'eos', itemId: '0' })
    await vi.waitFor(() => expect(transport.state().onAir?.itemId).toBe('2'))
    expect(commands.filter(command => command.cmd === 'load').map(command => command.item?.itemId)).toEqual(['0', '2'])
  })
  it('live de horário fixo tem prioridade sobre VT, mas só troca quando há quadro confirmado', async () => {
    const first = join(directory, 'atual.mkv'); writeFileSync(first, 'video')
    const value = view([first, 'live']), date = new Date(), at = framesSinceMidnight(date, channel.rate) + 25
    Object.assign(value.items[1]!, { item: { ...value.items[1]!.item, type: 'LIVE', anchor: { kind: 'FIXED', at }, sourceRef: 'ndi:CAM', title: 'Live', durationOverride: 500 }, asset: null })
    let now = date.getTime(); vi.spyOn(Date, 'now').mockImplementation(() => now)
    start(value); event({ event: 'ready', channelId: channel.id }); await transport.take('grade', '0')
    event({ event: 'position', itemId: '0', frames: 100, duration: 250 })
    holdLiveTake = true; now += 1500; transport.tick()
    await vi.waitFor(() => expect(priorityEvents[0]?.kind).toBe('REQUESTED'))
    await vi.waitFor(() => expect(commands.filter(command => command.cmd === 'take')).toHaveLength(2))
    expect(transport.state().onAir?.itemId).toBe('0')
    expect(priorityEvents.some(event => event.kind === 'CONFIRMED')).toBe(false)
    event({ event: 'position', itemId: '0', frames: 140, duration: 250 })
    onAir = '1'; event({ event: 'state', onAir })
    expect(transport.state().onAir?.itemId).toBe('1')
    expect(priorityEvents.at(-1)).toMatchObject({ kind: 'CONFIRMED', previousItemId: '0', previousFrames: 140, itemId: '1' })
    now += 1000; transport.tick()
    expect(priorityEvents.filter(event => event.kind === 'REQUESTED')).toHaveLength(1)
  })
  it('âncora da grade >24h prepara antes da meia-noite e corta depois somente após quadro confirmado', async () => {
    const first = join(directory, 'virada.mkv'); writeFileSync(first, 'video')
    const value = view([first, 'live'])
    Object.assign(value.rundown,{date:'2026-09-30'})
    Object.assign(value.items[1]!,{item:{...value.items[1]!.item,type:'LIVE',anchor:{kind:'HARD_TIME',at:24*3600*25+25},sourceRef:'omt:VIRADA',durationOverride:500},asset:null})
    let now = new Date(2026,8,30,23,59,58).getTime(); vi.spyOn(Date,'now').mockImplementation(()=>now)
    start(value); event({event:'ready',channelId:channel.id}); await transport.take('grade','0')
    await transport.cue({kind:'ITEM',id:'0'}); transport.tick()
    await vi.waitFor(()=>expect(commands.filter(command=>command.cmd==='load').some(command=>command.item?.itemId==='1')).toBe(true))
    expect(priorityEvents).toHaveLength(0)
    holdLiveTake=true; now += 3500; transport.tick()
    await vi.waitFor(()=>expect(priorityEvents[0]?.kind).toBe('REQUESTED'))
    await vi.waitFor(()=>expect(commands.filter(command=>command.cmd==='take')).toHaveLength(2))
    expect(transport.state().onAir?.itemId).toBe('0')
    expect(transport.state().preview).toEqual({kind:'ITEM',id:'0'})
    onAir='1'; event({event:'state',onAir})
    expect(priorityEvents.at(-1)?.kind).toBe('CONFIRMED')
    now += 24*3600_000; transport.tick()
    expect(priorityEvents.filter(event=>event.kind==='REQUESTED')).toHaveLength(1)
  })
  it('grade de ontem não dispara novamente o live às mesmas horas de hoje', async () => {
    const first = join(directory,'ontem.mkv'); writeFileSync(first,'video')
    const value = view([first,'live']); Object.assign(value.rundown,{date:'2026-09-30'})
    Object.assign(value.items[1]!,{item:{...value.items[1]!.item,type:'LIVE',anchor:{kind:'FIXED',at:12*3600*25},sourceRef:'ndi:ONTEM'},asset:null})
    let now=new Date(2026,9,1,11,59,59).getTime();vi.spyOn(Date,'now').mockImplementation(()=>now)
    start(value);event({event:'ready',channelId:channel.id});await transport.take('grade','0')
    now+=1500;transport.tick();await new Promise(resolve=>setTimeout(resolve,10))
    expect(priorityEvents).toHaveLength(0);expect(transport.state().onAir?.itemId).toBe('0')
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
  })
  it('live prioritária recusada preserva VT e não corta para outro arquivo', async () => {
    const first = join(directory, 'atual.mkv'), last = join(directory, 'outro.mkv'); writeFileSync(first, 'video'); writeFileSync(last, 'video')
    const value = view([first, 'live', last]), date = new Date(), at = framesSinceMidnight(date, channel.rate) + 25
    Object.assign(value.items[1]!, { item: { ...value.items[1]!.item, type: 'LIVE', anchor: { kind: 'HARD_TIME', at }, sourceRef: 'ndi:CAM', title: 'Live' }, asset: null })
    let now = date.getTime(); vi.spyOn(Date, 'now').mockImplementation(() => now)
    start(value); event({ event: 'ready', channelId: channel.id }); await transport.take('grade', '0')
    rejectLoad = ''; now += 1500; transport.tick()
    await vi.waitFor(() => expect(priorityEvents.at(-1)?.kind).toBe('FAILED'))
    expect(transport.state().onAir?.itemId).toBe('0')
    expect(commands.filter(command => command.cmd === 'take')).toHaveLength(1)
    expect(commands.filter(command => command.cmd === 'load').some(command => command.item?.itemId === '2')).toBe(false)
  })
  it('EOS entre grades prepara A/B e só instala a próxima revisão quando o PGM confirma o arquivo', async () => {
    const first=join(directory,'origem.mkv'),next=join(directory,'destino.mkv');writeFileSync(first,'video');writeFileSync(next,'video')
    const source=view([first]),target=view([next]);Object.assign(target.rundown,{id:'next-grade',channelId:channel.id})
    Object.assign(target.items[0]!.item,{id:'next-item'});Object.assign(target.schedule.items[0]!,{id:'next-item'})
    let current=source,revision='source';const committed=vi.fn(()=>{current=target;revision='target'}),beforeTake=vi.fn(),failed=vi.fn(),confirmed=vi.fn()
    start(source,confirmed,()=>current,()=>revision,{onPreparePlaylistEnd:async()=>({view:target,itemId:'next-item',stillCurrent:()=>true}),onPlaylistEnd:async()=>({kind:'TAKE',view:target,itemId:'next-item',stillCurrent:()=>true,commit:committed,beforeTake,failed})})
    event({event:'ready',channelId:channel.id});await transport.take('grade','0');await transport.cue({kind:'ITEM',id:'0'})
    event({event:'position',itemId:'0',frames:200,duration:250});transport.tick()
    await vi.waitFor(()=>expect(transport.state().preparedItemId).toBe('next-item'))
    expect(committed).not.toHaveBeenCalled();expect(beforeTake).not.toHaveBeenCalled()
    holdFileTake=true;event({event:'eos',itemId:'0'})
    await vi.waitFor(()=>expect(beforeTake).toHaveBeenCalledOnce())
    expect(transport.state().onAir?.itemId).toBe('0');expect(transport.state().preview).toEqual({kind:'ITEM',id:'0'})
    expect(committed).not.toHaveBeenCalled()
    onAir='next-item';event({event:'state',onAir});ack(commands.filter(command=>command.cmd==='take').at(-1)!.id)
    await vi.waitFor(()=>expect(transport.state().rundownId).toBe('next-grade'))
    expect(committed).toHaveBeenCalledOnce();expect(failed).not.toHaveBeenCalled()
    expect(commands.filter(command=>command.cmd==='load'&&command.item?.itemId==='next-item')).toHaveLength(1)
    expect(confirmed.mock.calls.at(-1)?.[3]).toMatchObject({itemId:'0',frames:200,reason:'PLAYLIST_BOUNDARY'})
    expect(commands.some(command=>command.cmd==='stop')).toBe(false)
  })
  it('falha ou cancelamento da próxima edição preserva PGM e não tenta outro vídeo nem STOP',async()=>{
    const first=join(directory,'origem.mkv'),next=join(directory,'destino.mkv');writeFileSync(first,'video');writeFileSync(next,'video')
    const source=view([first]),target=view([next]);Object.assign(target.rundown,{id:'next-grade'});Object.assign(target.items[0]!.item,{id:'next-item'});Object.assign(target.schedule.items[0]!,{id:'next-item'})
    const committed=vi.fn(),beforeTake=vi.fn(),failed=vi.fn()
    start(source,undefined,undefined,undefined,{onPlaylistEnd:async()=>({kind:'TAKE',view:target,itemId:'next-item',stillCurrent:()=>true,commit:committed,beforeTake,failed})})
    await transport.take('grade','0');rejectLoad=next;event({event:'eos',itemId:'0'})
    await vi.waitFor(()=>expect(failed).toHaveBeenCalledOnce())
    expect(transport.state().onAir?.itemId).toBe('0');expect(committed).not.toHaveBeenCalled();expect(beforeTake).not.toHaveBeenCalled()
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
    expect(commands.some(command=>command.cmd==='stop')).toBe(false)
  })
  it('ACK sem PGM confirmado deixa a passagem incerta; HOLD não repete TAKE no próximo EOS',async()=>{
    const first=join(directory,'origem.mkv'),next=join(directory,'destino.mkv');writeFileSync(first,'video');writeFileSync(next,'video')
    const source=view([first]),target=view([next]);Object.assign(target.rundown,{id:'next-grade'});Object.assign(target.items[0]!.item,{id:'next-item'});Object.assign(target.schedule.items[0]!,{id:'next-item'})
    let uncertain=false;const commit=vi.fn(),failed=vi.fn(()=>{uncertain=true})
    start(source,undefined,undefined,undefined,{onPlaylistEnd:async()=>uncertain?{kind:'HOLD',reason:'resultado incerto'}:{kind:'TAKE',view:target,itemId:'next-item',stillCurrent:()=>true,commit,beforeTake:()=>{},failed}})
    await transport.take('grade','0');holdLiveTake=true;event({event:'eos',itemId:'0'})
    await vi.waitFor(()=>expect(failed).toHaveBeenCalledOnce());expect(commit).not.toHaveBeenCalled()
    event({event:'eos',itemId:'0'});await new Promise(resolve=>setTimeout(resolve,10))
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(2);expect(transport.state().onAir?.itemId).toBe('0')
    expect(commands.some(command=>command.cmd==='stop')).toBe(false)
  })
  it('hold manual e loop não são fronteira de grade nem chamam a autorização de virada',async()=>{
    const first=join(directory,'origem.mkv');writeFileSync(first,'video')
    const source=view([first]);Object.assign(source.items[0]!.item,{autoNext:false});const boundary=vi.fn(async()=>null)
    start(source,undefined,undefined,undefined,{onPlaylistEnd:boundary});await transport.take('grade','0')
    event({event:'eos',itemId:'0'});await new Promise(resolve=>setTimeout(resolve,10));expect(boundary).not.toHaveBeenCalled()
  })
  it('grade em loop sem arquivos termina a tentativa sem loop de comandos', async () => {
    start(view([join(directory, 'ausente.mkv')], true))
    await expect(transport.take('grade', '0')).rejects.toThrow('Nenhum item reproduzível')
    expect(commands).toHaveLength(0)
    expect(transport.state().playing).toBe(false)
  })
  it('erro ao iniciar executável não derruba o servidor', () => {
    start(view([])); child.emit('error', new Error('ENOENT'))
    expect(transport.health().error).toContain('ENOENT')
  })
  it('não mata engine em preroll só porque o relatório de quadros está bloqueado', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video'); holdLoad = true
    start(view([good])); event({ event: 'output', frames: 100 }); transport.watchdog()
    const action = transport.take('grade', '0')
    await vi.waitFor(() => expect(commands).toHaveLength(1))
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
    for (let i = 0; i < 100; i++) { now += 50; transport.watchdog() }
    expect(child.kill).not.toHaveBeenCalled()
    armed = '0'; event({ event: 'state', armed }); ack(commands[0]!.id); await action
  })
  it('faz preroll do próximo item e avança sem reabrir o arquivo', async () => {
    const first = join(directory, 'primeiro.mkv'); const second = join(directory, 'segundo.mkv')
    writeFileSync(first, 'video'); writeFileSync(second, 'video')
    start(view([first, second]))
    event({ event: 'ready', channelId: channel.id })
    await transport.take('grade', '0')

    transport.tick()
    await vi.waitFor(() => expect(transport.state().preparedItemId).toBe('1'))
    expect(commands.filter((command) => command.cmd === 'load').map((command) => command.item?.itemId)).toEqual(['0', '1'])

    event({ event: 'eos', itemId: '0' })
    await vi.waitFor(() => expect(transport.state().onAir?.itemId).toBe('1'))
    expect(commands.filter((command) => command.cmd === 'load').map((command) => command.item?.itemId)).toEqual(['0', '1'])
  })

  it('envia seek ao engine e atualiza a posição real do programa e preview', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video')
    start(view([good])); await transport.take('grade', '0')
    await transport.seek('pgm', 125)
    expect(commands.at(-1)).toMatchObject({ cmd: 'seek', bus: 'pgm', frames: 125 })
    expect(transport.state().onAir?.elapsed).toBe(125)
    await transport.cue({ kind: 'ITEM', id: '0' })
    event({ event: 'previewPosition', itemId: '0', frames: 50, duration: 250 })
    expect(transport.state().previewPosition).toEqual({ frames: 50, duration: 250 })
  })
  it('estado PVW não certifica frame sem identidade de decoder no ACK legado',async()=>{
    const good=join(directory,'pvw.mkv');writeFileSync(good,'video')
    start(view([good]));await transport.cue({kind:'ITEM',id:'0'})
    event({event:'previewFrame',itemId:'0',decoderId:7,delivered:true,ageMs:0,pausedFile:true})
    expect(transport.state().previewFrame).toBeNull()
  })
  it('estado PVW vincula geração, recusa antiga e expira sem novos eventos',async()=>{
    const good=join(directory,'pvw-identity.mkv');writeFileSync(good,'video')
    start(view([good]));event({event:'ready',channelId:channel.id,decoderIdentity:true});holdPreview=true
    let now=1000;vi.spyOn(performance,'now').mockImplementation(()=>now)
    const first=transport.cue({kind:'ITEM',id:'0'})
    await vi.waitFor(()=>expect(commands.filter(c=>c.cmd==='preview')).toHaveLength(1))
    event({event:'ack',id:commands.at(-1)!.id,ok:true,decoderId:7});await first
    event({event:'previewFrame',itemId:'0',decoderId:7,delivered:true,ageMs:10,pausedFile:false})
    expect(transport.state().previewFrame).toMatchObject({decoderId:7,delivered:true})
    now=3001;expect(transport.state().previewFrame).toBeNull()
    const clear=transport.cue(null)
    await vi.waitFor(()=>expect(commands.filter(c=>c.cmd==='preview')).toHaveLength(2))
    ack(commands.at(-1)!.id);await clear
    event({event:'previewFrame',itemId:'0',decoderId:7,delivered:true,ageMs:0,pausedFile:false})
    expect(transport.state().previewFrame).toBeNull()
    const reopened=transport.cue({kind:'ITEM',id:'0'})
    await vi.waitFor(()=>expect(commands.filter(c=>c.cmd==='preview')).toHaveLength(3))
    event({event:'ack',id:commands.at(-1)!.id,ok:true,decoderId:8});await reopened
    event({event:'previewFrame',itemId:'0',decoderId:7,delivered:true,ageMs:0,pausedFile:false})
    expect(transport.state().previewFrame).toBeNull()
    event({event:'previewFrame',itemId:'0',decoderId:8,delivered:true,ageMs:0,pausedFile:false})
    expect(transport.state().previewFrame).toMatchObject({decoderId:8,delivered:true})
  })

  it('recupera cursor antes do TAKE e conserva os cortes originais', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video')
    const base = view([good]); const value = { ...base, items: [{ ...base.items[0]!, trim: { in: 100, out: 350 } }] }
    start(value)
    await transport.take('grade', '0', 125)
    expect(commands[0]).toMatchObject({ cmd: 'load', item: { itemId: '0', trimIn: 100, trimOut: 350, startOffsetFrames: 125 } })
    expect(commands[1]).toMatchObject({ cmd: 'take' })
    expect(transport.state().onAir?.elapsed).toBe(125)
  })

  it('não aplica cursor do arquivo ausente ao próximo VT válido', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video')
    start(view([join(directory, 'sumiu.mkv'), good]))
    await expect(transport.take('grade', '0', 125)).rejects.toThrow('Arquivo indisponível')
    expect(commands).toHaveLength(0)
    await transport.take('grade', '1')
    expect(commands.find((command) => command.cmd === 'load')?.item).not.toHaveProperty('startOffsetFrames')
    expect(transport.state().onAir?.elapsed).toBe(0)
  })
  it('watchdog reabre o mesmo VT no cursor real antes de confirmar recuperação', async () => {
    const good = join(directory, 'bom.mkv'); writeFileSync(good, 'video')
    start(view([good])); event({ event: 'ready', channelId: channel.id })
    await transport.take('grade', '0')
    event({ event: 'position', itemId: '0', frames: 143, duration: 250 })
    child.emit('exit', 1, null)
    expect(transport.state().onAir).toBeNull()
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now)
    transport.watchdog(); now += 10_000; transport.watchdog()
    event({ event: 'ready', channelId: channel.id })
    await vi.waitFor(() => expect(transport.state().onAir?.elapsed).toBe(143))
    expect(commands.filter((command) => command.cmd === 'load').at(-1)).toMatchObject({ item: { startOffsetFrames: 143 } })
    expect(transport.health().ready).toBe(true)
  })
  it('watchdog não repete o PGM anterior se a virada ficou incerta, mesmo mudando a guarda na fila',async()=>{
    const good=join(directory,'bom.mkv');writeFileSync(good,'video')
    const value=view([good]);let permitted=true
    start(value,undefined,()=>value,undefined,{canRecoverProgram:()=>permitted})
    await transport.take('grade','0');permitted=false
    child.emit('exit',1,null)
    let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now)
    transport.watchdog();now+=10_000;transport.watchdog()
    event({event:'ready',channelId:channel.id})
    await vi.waitFor(()=>expect(transport.health().error).toContain('Recuperação automática bloqueada'))
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
    expect(transport.state().onAir).toBeNull();expect(transport.health().ready).toBe(false)
    permitted=true;const recovery=transport.recover('grade','0',1);permitted=false
    await expect(recovery).rejects.toThrow('bloqueada')
    expect(commands.filter(command=>command.cmd==='take')).toHaveLength(1)
    await transport.stop();expect(transport.health().ready).toBe(true)
  })

  it('arma uma fonte ao vivo no preview e leva exatamente essa fonte ao PGM no TAKE', async () => {
    const live = {
      ...view(['']),
      items: [{
        item: { id: 'live-1', sourceRef: 'srt://127.0.0.1:9000?mode=listener', type: 'LIVE', autoNext: false },
        asset: null,
        trim: { in: 0, out: 0 },
        gainDb: 0,
      }],
      schedule: { items: [{ id: 'live-1', state: 'SCHEDULED', duration: 1500 }] },
    } as unknown as RundownView
    start(live)

    await transport.cue({ kind: 'ITEM', id: 'live-1' })
    expect(commands.at(-1)).toMatchObject({ cmd: 'preview', item: { itemId: 'live-1', source: 'srt://127.0.0.1:9000?mode=listener' } })
    expect(transport.state().preview).toEqual({ kind: 'ITEM', id: 'live-1' })

    await transport.take('grade', 'live-1')
    expect(commands.filter((command) => command.cmd === 'take')).toHaveLength(1)
    expect(transport.state().onAir?.itemId).toBe('live-1')
  })

  it('mantém PVW enquanto TAKE live aguarda o primeiro quadro e só confirma no estado do PGM', async () => {
    const live = {
      ...view(['']),
      items: [{ item: { id: 'live-1', sourceRef: 'ndi:ESTUDIO', type: 'LIVE', autoNext: false }, asset: null, trim: { in: 0, out: 0 }, gainDb: 0 }],
      schedule: { items: [{ id: 'live-1', state: 'SCHEDULED', duration: 1500 }] },
    } as unknown as RundownView
    start(live); holdLiveTake = true
    await transport.cue({ kind: 'ITEM', id: 'live-1' })
    await transport.take('grade', 'live-1')
    expect(transport.state().onAir).toBeNull()
    expect(transport.state().preview).toEqual({ kind: 'ITEM', id: 'live-1' })

    onAir = 'live-1'; armed = undefined; event({ event: 'state', onAir, armed })
    await vi.waitFor(() => expect(transport.state().onAir?.itemId).toBe('live-1'))
    expect(transport.state().preview).toBeNull()
  })

  it('cancela TAKE live pendente ao escolher outra fonte no PVW', async () => {
    const live = {
      ...view(['']),
      items: [{ item: { id: 'live-1', sourceRef: 'ndi:ESTUDIO', type: 'LIVE', autoNext: false }, asset: null, trim: { in: 0, out: 0 }, gainDb: 0 }],
      schedule: { items: [{ id: 'live-1', state: 'SCHEDULED', duration: 1500 }] },
    } as unknown as RundownView
    start(live); holdLiveTake = true
    await transport.take('grade', 'live-1')
    await transport.cue({ kind: 'SOURCE', source: 'ndi:OUTRA-FONTE', title: 'Outra fonte' })
    expect(commands.map((command) => command.cmd)).toContain('cancelTake')
    expect(transport.state().preview).toEqual({ kind: 'SOURCE', source: 'ndi:OUTRA-FONTE', title: 'Outra fonte' })
  })

  it('abre uma fonte direta no PVW sem tratá-la como asset do MAM', async () => {
    start(view([]))
    await transport.cue({ kind: 'SOURCE', source: 'ndi:ESTUDIO (vMix - Output 1)', title: 'Estúdio' })
    expect(commands.at(-1)).toMatchObject({
      cmd: 'preview', item: { itemId: 'source:ndi:ESTUDIO (vMix - Output 1)', source: 'ndi:ESTUDIO (vMix - Output 1)' },
    })
    expect(transport.state().preview).toEqual({ kind: 'SOURCE', source: 'ndi:ESTUDIO (vMix - Output 1)', title: 'Estúdio' })
  })

  it('encaminha a fonte OMT descoberta ao engine para diagnóstico ou recepção', async () => {
    start(view([]))
    await transport.cue({ kind: 'SOURCE', source: 'omt:nmos-camera-a', title: 'Câmera OMT' })
    expect(commands.at(-1)).toMatchObject({
      cmd: 'preview', item: { itemId: 'source:omt:nmos-camera-a', source: 'omt:nmos-camera-a' },
    })
    expect(transport.state().preview).toEqual({ kind: 'SOURCE', source: 'omt:nmos-camera-a', title: 'Câmera OMT' })
  })

  it('só declara sinal pronto quando o engine confirma o primeiro quadro', async () => {
    start(view([]))
    await transport.cue({ kind: 'SOURCE', source: 'ndi:ESTUDIO', title: 'Estúdio' })
    expect(transport.state().liveSources[0]).toMatchObject({
      source: 'ndi:ESTUDIO', state: 'CUEING',
    })

    event({ event: 'sourceReady', itemId: 'source:ndi:ESTUDIO', bus: 'pvw' })
    expect(transport.state().liveSources[0]).toMatchObject({
      source: 'ndi:ESTUDIO', state: 'PVW_READY', message: null,
    })

    event({ event: 'itemError', itemId: 'source:ndi:ESTUDIO', bus:'pvw', message: 'sem pacotes por 2 s' })
    expect(transport.state().liveSources[0]).toMatchObject({
      state: 'FAILED', message: 'sem pacotes por 2 s',
    })
  })
  it('mantém CUEING antes do primeiro quadro, sem esconder ausência medida nem declarar pronto', async () => {
    start(view([]))
    await transport.cue({kind:'SOURCE',source:'ndi:ESTUDIO',title:'Estúdio'})
    const signal={width:null,height:null,rateNum:null,rateDen:null,interlaceMode:null,audioChannels:null,sampleRate:null,videoAgeMs:null,audioAgeMs:null,videoPresent:false,audioPresent:false,receivedFrames:0,arrivalJitterMs:null}
    event({event:'sourceTelemetry',itemId:'source:ndi:ESTUDIO',bus:'pvw',signal})
    expect(transport.state().liveSources[0]).toMatchObject({state:'CUEING',busStates:{pvw:'CUEING'},busSignals:{pvw:{status:'NO_VIDEO',videoRecent:false,audioRecent:false}}})
    expect(transport.state().onAir).toBeNull()
    event({event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw'})
    expect(transport.state().liveSources[0]).toMatchObject({state:'LOST',busStates:{pvw:'LOST'},busSignals:{pvw:{status:'NO_VIDEO',videoRecent:false}}})
    event({event:'itemError',itemId:'source:ndi:ESTUDIO',bus:'pvw',message:'Falha real'})
    expect(transport.state().liveSources[0]).toMatchObject({state:'FAILED',message:'Falha real'})
  })
  it('não deixa sinal verde de PVW antigo nem PGM depois de STOP ou queda do engine', async () => {
    const value = view(['live'])
    Object.assign(value.items[0]!, { item: { ...value.items[0]!.item, type: 'LIVE', sourceRef: 'ndi:ESTUDIO', durationOverride: 250 }, asset: null })
    start(value)
    await transport.cue({ kind: 'SOURCE', source: 'ndi:ESTUDIO' })
    event({ event: 'sourceReady', itemId: 'source:ndi:ESTUDIO', bus: 'pvw' })
    expect(transport.state().liveSources[0]?.state).toBe('PVW_READY')
    await transport.cue({ kind: 'SOURCE', source: 'omt:OUTRA' })
    expect(transport.state().liveSources.find(signal => signal.source === 'ndi:ESTUDIO')?.state).toBe('IDLE')
    await transport.take('grade', '0')
    expect(transport.state().liveSources.find(signal => signal.source === 'ndi:ESTUDIO')?.state).toBe('ON_PGM')
    await transport.stop()
    expect(transport.state().liveSources.find(signal => signal.source === 'ndi:ESTUDIO')?.state).toBe('IDLE')
    await transport.take('grade', '0')
    child.emit('exit', 1, null)
    expect(transport.state().liveSources.find(signal => signal.source === 'ndi:ESTUDIO')?.state).toBe('LOST')
  })
  it('PGM e PVW da mesma fonte têm disponibilidade independente e metadados reais podem ficar obsoletos', async () => {
    const value = view(['live'])
    Object.assign(value.items[0]!, { item: { ...value.items[0]!.item, type: 'LIVE', sourceRef: 'ndi:ESTUDIO', durationOverride: 250 }, asset: null })
    start(value)
    await transport.take('grade', '0')
    await transport.cue({ kind: 'SOURCE', source: 'ndi:ESTUDIO' })
    expect(transport.state().liveSources[0]).toMatchObject({ state: 'ON_PGM', busStates: { pgm: 'ON_PGM', pvw: 'CUEING' } })
    const signal = { width:1920,height:1080,rateNum:30000,rateDen:1001,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:10,audioAgeMs:20,videoPresent:true,audioPresent:true,receivedFrames:25,arrivalJitterMs:1.5 }
    event({ event:'sourceTelemetry',itemId:'0',bus:'pgm',signal })
    event({ event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw' })
    event({ event:'sourceTelemetry',itemId:'source:ndi:ESTUDIO',bus:'pvw',signal:{ ...signal,audioPresent:false,audioAgeMs:null,videoAgeMs:2500,videoPresent:false } })
    expect(transport.state().liveSources[0]).toMatchObject({ state:'ON_PGM',busStates:{pgm:'ON_PGM',pvw:'LOST'},busItemIds:{pgm:'0',pvw:'source:ndi:ESTUDIO'},measurements:{pgm:{width:1920,audioPresent:true},pvw:{audioPresent:false}} })
    let now = Date.now(); vi.spyOn(Date,'now').mockImplementation(() => now)
    now += 3000
    expect(transport.state().liveSources[0]).toMatchObject({ state:'LOST',busStates:{pgm:'LOST',pvw:'LOST'} })
    expect(transport.state().onAir?.itemId).toBe('0') // Diagnosis is not an implicit TAKE.
    child.emit('exit',1,null)
    expect(transport.state().liveSources[0]?.state).toBe('LOST')
  })

  it('soma idade da medição à do buffer e recupera sem trocar o item de PGM', async () => {
    const value=view(['live'])
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value);await transport.take('grade','0')
    const signal={width:1920,height:1080,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:1500,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:25,arrivalJitterMs:0}
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',signal})
    expect(transport.state().liveSources[0]?.state).toBe('ON_PGM')
    const captured=Date.parse(transport.state().liveSources[0]!.measurements!.pgm!.sampledAt)
    vi.spyOn(Date,'now').mockReturnValue(captured+600)
    expect(transport.state().liveSources[0]?.state).toBe('LOST')
    expect(transport.state().onAir?.itemId).toBe('0')
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',signal:{...signal,videoAgeMs:0}})
    const recovered=Date.parse(transport.state().liveSources[0]!.measurements!.pgm!.sampledAt)
    vi.mocked(Date.now).mockReturnValue(recovered)
    expect(transport.state().liveSources[0]?.state).toBe('ON_PGM')
    expect(transport.state().onAir?.itemId).toBe('0')
    vi.mocked(Date.now).mockReturnValue(recovered-1)
    expect(transport.state().liveSources[0]?.state).toBe('LOST')
  })

  it('troca somente o publisher de uma saída de rede sem comandar stop ou load', async () => {
    start(view([]))
    await transport.reconfigureOutput({
      id: 'destino-rtmp', kind: 'rtmp', target: 'rtmp://cdn.example/live', bitrateKbps: 4000,
    })
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({
      cmd: 'replaceOutput', outputId: 'destino-rtmp',
      output: { id: 'destino-rtmp', kind: 'rtmp', target: 'rtmp://cdn.example/live' },
    })
  })

  it('descarta ready/telemetria de QC antigo quando outro item da mesma fonte ocupa PVW', async () => {
    const value=view(['live'])
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value)
    await transport.cue({kind:'SOURCE',source:'ndi:ESTUDIO'})
    const signal={width:1920,height:1080,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:0,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:25,arrivalJitterMs:0}
    event({event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw'})
    event({event:'sourceTelemetry',itemId:'source:ndi:ESTUDIO',bus:'pvw',signal})
    await transport.cue({kind:'ITEM',id:'0'})
    event({event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw'})
    event({event:'sourceTelemetry',itemId:'source:ndi:ESTUDIO',bus:'pvw',signal})
    expect(transport.state().liveSources[0]).toMatchObject({busStates:{pvw:'CUEING'},busSignals:{pvw:{status:'CONNECTING',videoRecent:false}}})
    expect(transport.state().liveSources[0]!.measurements!.pvw).toBeUndefined()
    event({event:'sourceReady',itemId:'0',bus:'pvw'})
    event({event:'sourceTelemetry',itemId:'0',bus:'pvw',signal})
    expect(transport.state().liveSources[0]).toMatchObject({busSignals:{pvw:{status:'SIGNAL_OK',videoRecent:true,audioRecent:true}}})
  })
  it('perfil live atualizado na visão muda aviso sem reabrir decoder ou alterar PVW',async()=>{
    const value=view([])
    start(value)
    await transport.cue({kind:'SOURCE',source:'ndi:ESTUDIO'})
    event({event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw'})
    event({event:'sourceTelemetry',itemId:'source:ndi:ESTUDIO',bus:'pvw',signal:{width:1920,height:1080,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:0,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:100,arrivalJitterMs:150}})
    expect(transport.state().liveSources[0]).toMatchObject({busSignals:{pvw:{status:'UNSTABLE'}}})
    const before=commands.length
    Object.assign(value,{channel:{...value.channel,qcProfile:{...DEFAULT_QC_PROFILE,liveSignalPolicy:{arrivalWarningEnabled:true,warningFrameIntervals:5,minimumReceivedFrames:50}}}})
    expect(transport.state()).toMatchObject({preview:{kind:'SOURCE',source:'ndi:ESTUDIO'},liveSources:[{busSignals:{pvw:{status:'SIGNAL_OK'}}}]})
    expect(commands).toHaveLength(before)
  })

  it('TAKE pendente da mesma fonte preserva medição do PGM anterior até confirmação nativa', async () => {
    const value=view(['a','b'])
    for(const row of value.items)Object.assign(row,{item:{...row.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value);await transport.take('grade','0')
    const signal={width:1920,height:1080,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:0,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:25,arrivalJitterMs:0}
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',signal})
    holdLiveTake=true;await transport.take('grade','1')
    event({event:'sourceTelemetry',itemId:'1',bus:'pgm',signal:{...signal,width:640,videoPresent:false}})
    expect(transport.state()).toMatchObject({onAir:{itemId:'0'},liveSources:[{busStates:{pgm:'ON_PGM'},busItemIds:{pgm:'0'},measurements:{pgm:{width:1920}},busSignals:{pgm:{status:'SIGNAL_OK'}}}]})
    event({event:'state',onAir:'1'})
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',signal})
    expect(transport.state().liveSources[0]!.measurements!.pgm).toBeUndefined()
    event({event:'sourceTelemetry',itemId:'1',bus:'pgm',signal:{...signal,audioPresent:false}})
    expect(transport.state()).toMatchObject({onAir:{itemId:'1'},liveSources:[{busSignals:{pgm:{status:'NO_AUDIO',videoRecent:true}}}]})
  })

  it('erro/perda atrasados de QC descartado não alteram novo PVW nem o PGM da mesma fonte',async()=>{
    const value=view(['a','b'])
    for(const row of value.items)Object.assign(row,{item:{...row.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value);await transport.take('grade','0')
    await transport.cue({kind:'SOURCE',source:'ndi:ESTUDIO'})
    await transport.cue({kind:'ITEM',id:'1'})
    event({event:'sourceReady',itemId:'1',bus:'pvw'})
    const before=transport.state(),health=transport.health(),count=commands.length
    event({event:'itemError',itemId:'source:ndi:ESTUDIO',bus:'pvw',message:'decoder anterior caiu'})
    event({event:'sourceLost',itemId:'source:ndi:ESTUDIO',reason:'fonte anterior encerrou'})
    event({event:'itemError',itemId:'1',bus:'pgm',message:'erro no bus errado'})
    expect(transport.state()).toEqual(before);expect(transport.health()).toEqual(health)
    expect(commands).toHaveLength(count)
    event({event:'sourceLost',itemId:'0',reason:'PGM perdeu pacotes'})
    expect(transport.state()).toMatchObject({onAir:{itemId:'0'},preview:{kind:'ITEM',id:'1'},liveSources:[{busStates:{pgm:'LOST',pvw:'PVW_READY'}}]})
    expect(commands).toHaveLength(count) // Loss diagnosis never performs automatic TAKE.
  })

  it('falha do novo TAKE na mesma fonte não atribui FAILED ao PGM anterior',async()=>{
    const value=view(['a','b'])
    for(const row of value.items)Object.assign(row,{item:{...row.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value);await transport.take('grade','0');holdLiveTake=true
    await transport.take('grade','1')
    event({event:'itemError',itemId:'1',bus:'pgm',message:'novo decoder recusado'})
    expect(transport.hasPendingCommand()).toBe(false)
    expect(transport.state()).toMatchObject({onAir:{itemId:'0'},liveSources:[{busStates:{pgm:'ON_PGM'},busItemIds:{pgm:'0'}}]})
    expect(transport.health().error).toContain('novo decoder recusado')
    expect(child.kill).not.toHaveBeenCalled()
  })
  it('timeout de outra abertura do mesmo ID não encerra o PGM nem avança para Próximo',async()=>{
    const value=view(['live','next'])
    for(const row of value.items)Object.assign(row,{item:{...row.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250,autoNext:true},asset:null})
    start(value);event({event:'ready',channelId:channel.id,decoderIdentity:true});loadDecoderId=201
    await transport.take('grade','0')
    event({event:'state',onAir:'0',onAirDecoderId:201})
    const signal={width:640,height:360,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:0,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:25,arrivalJitterMs:0}
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',decoderId:201,signal})
    // The general fake uses one ID for both slots. Keep the actual PGM's
    // decoder stable while a DIFFERENT opening of the same item is armed.
    child.stdin.removeAllListeners('data')
    child.stdin.on('data',(data:Buffer)=>{
      const command=JSON.parse(data.toString());commands.push(command)
      queueMicrotask(()=>{
        if(command.cmd==='load')event({event:'state',onAir:'0',onAirDecoderId:201,armed:command.item?.itemId,armedDecoderId:202})
        ack(command.id)
      })
    })
    holdLiveTake=true;await transport.take('grade','0')
    event({event:'state',onAir:'0',onAirDecoderId:201,armed:'0',armedDecoderId:202})
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',decoderId:201,signal})
    expect(transport.state().liveSources[0]).toMatchObject({busStates:{pgm:'ON_PGM'},busSignals:{pgm:{status:'SIGNAL_OK'}}})
    const before=transport.state(),count=commands.length
    event({event:'itemError',itemId:'0',bus:'pgm',decoderId:202,message:'TAKE cancelado após 10 segundos'})
    await vi.waitFor(()=>expect(transport.hasPendingCommand()).toBe(false))
    expect(commands).toHaveLength(count)
    expect(transport.state()).toMatchObject({onAir:before.onAir,liveSources:[{busStates:{pgm:'ON_PGM'},busSignals:{pgm:{status:'SIGNAL_OK'}}}]})
    expect(transport.health().error).toContain('10 segundos');expect(child.kill).not.toHaveBeenCalled()
  })
  it.each(['manual-in-progress','automatic-already-queued'])('Próximo não enfileira LOAD sobre TAKE manual: %s',async mode=>{
    const value=view(['live','next'])
    for(const row of value.items)Object.assign(row,{item:{...row.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value);event({event:'ready',channelId:channel.id,decoderIdentity:true});loadDecoderId=201
    await transport.take('grade','0')
    child.stdin.removeAllListeners('data')
    child.stdin.on('data',(data:Buffer)=>{
      const command=JSON.parse(data.toString());commands.push(command)
      if(command.cmd==='load'&&holdLoad)return
      queueMicrotask(()=>ack(command.id))
    })
    holdLoad=true;holdLiveTake=true
    if(mode==='automatic-already-queued')transport.tick()
    const taking=transport.take('grade','0')
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('load'))
    const opening=commands.at(-1)!,count=commands.length
    transport.tick()
    expect(transport.state().preparingItemId).toBeNull()
    holdLoad=false;event({event:'state',onAir:'0',onAirDecoderId:201,armed:'0',armedDecoderId:202});ack(opening.id);await taking
    await Promise.resolve();await Promise.resolve()
    expect(commands.slice(count).map(command=>command.cmd)).toEqual(['take'])
    expect(transport.hasPendingCommand()).toBe(true)
    transport.tick();expect(commands.filter(command=>command.cmd==='load'&&command.item?.itemId==='1')).toHaveLength(0)
  })

  it('PVW pertence ao comando atual antes do ACK, não ao binding histórico de outra fonte',async()=>{
    start(view([]))
    await transport.cue({kind:'SOURCE',source:'ndi:ANTIGA'})
    event({event:'sourceReady',itemId:'source:ndi:ANTIGA',bus:'pvw'})
    holdPreview=true
    const opening=transport.cue({kind:'SOURCE',source:'omt:NOVA'})
    await vi.waitFor(()=>expect(commands.at(-1)?.item?.itemId).toBe('source:omt:NOVA'))
    const command=commands.at(-1)!,health=transport.health()
    event({event:'itemError',itemId:'source:ndi:ANTIGA',bus:'pvw',message:'erro antigo'})
    event({event:'sourceReady',itemId:'source:ndi:ANTIGA',bus:'pvw'})
    const signal={width:640,height:360,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:0,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:25,arrivalJitterMs:0}
    event({event:'sourceTelemetry',itemId:'source:ndi:ANTIGA',bus:'pvw',signal})
    expect(transport.health()).toEqual(health)
    expect(transport.state().liveSources.find(row=>row.source==='ndi:ANTIGA')).toMatchObject({state:'IDLE',busSignals:{pvw:{status:'UNMONITORED'}}})
    event({event:'sourceReady',itemId:'source:omt:NOVA',bus:'pvw'})
    event({event:'sourceTelemetry',itemId:'source:omt:NOVA',bus:'pvw',signal})
    ack(command.id);await opening
    expect(transport.state()).toMatchObject({preview:{kind:'SOURCE',source:'omt:NOVA'}})
    expect(transport.state().liveSources.find(row=>row.source==='omt:NOVA')).toMatchObject({busSignals:{pvw:{status:'SIGNAL_OK'}}})
    const clearing=transport.cue(null)
    await vi.waitFor(()=>expect(commands.at(-1)?.item).toBeNull())
    const clear=commands.at(-1)!,before=transport.health()
    event({event:'itemError',itemId:'source:omt:NOVA',bus:'pvw',message:'já descartada'})
    event({event:'sourceTelemetry',itemId:'source:omt:NOVA',bus:'pvw',signal})
    expect(transport.health()).toEqual(before)
    ack(clear.id);await clearing
    expect(transport.state().preview).toBeNull()
  })

  it('park de live instala a mesma posse de PVW e não depende de CUE anterior',async()=>{
    const value=view(['live'])
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value);await transport.park('0')
    event({event:'sourceReady',itemId:'0',bus:'pvw'})
    expect(transport.state()).toMatchObject({preview:{kind:'ITEM',id:'0'},liveSources:[{busStates:{pvw:'PVW_READY'},busItemIds:{pvw:'0'}}]})
    expect(transport.state().onAir).toBeNull()
  })

  it('cadastro selecionado só é confirmado pelo decoder atual e é limpo ao reabrir',async()=>{
    const value=view(['live'])
    Object.assign(value.items[0]!,{item:{...value.items[0]!.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',configuredSourceId:'selected',durationOverride:250},asset:null})
    start(value);event({event:'ready',channelId:channel.id,decoderIdentity:true});holdPreview=true
    const first=transport.cue({kind:'ITEM',id:'0'})
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('preview'))
    expect(commands.at(-1)).toMatchObject({item:{configuredSourceId:'selected'}})
    event({event:'ack',id:commands.at(-1)!.id,ok:true,decoderId:101});await first
    event({event:'sourceReady',itemId:'0',bus:'pvw',decoderId:101,configuredSourceId:'other'})
    expect(transport.state().liveSources[0]?.nativeCatalogBindings?.pvw).toBeUndefined()
    event({event:'sourceReady',itemId:'0',bus:'pvw',decoderId:101,configuredSourceId:'selected'})
    expect(transport.state().liveSources[0]?.nativeCatalogBindings?.pvw).toBe('selected')
    holdPreview=false;await transport.cue(null);holdPreview=true
    const count=commands.length,second=transport.cue({kind:'ITEM',id:'0'})
    await vi.waitFor(()=>expect(commands.length).toBeGreaterThan(count))
    event({event:'ack',id:commands.at(-1)!.id,ok:true,decoderId:102});await second
    event({event:'sourceReady',itemId:'0',bus:'pvw',decoderId:101,configuredSourceId:'selected'})
    expect(transport.state().liveSources[0]?.nativeCatalogBindings?.pvw).toBeUndefined()
    event({event:'sourceReady',itemId:'0',bus:'pvw',decoderId:102,configuredSourceId:'selected'})
    expect(transport.state().liveSources[0]?.nativeCatalogBindings?.pvw).toBe('selected')
  })

  it('mesmo ID reaberto rejeita eventos da encarnação anterior e sem identidade',async()=>{
    start(view([]));event({event:'ready',channelId:channel.id,decoderIdentity:true})
    holdPreview=true
    const first=transport.cue({kind:'SOURCE',source:'ndi:ESTUDIO'})
    await vi.waitFor(()=>expect(commands.at(-1)?.cmd).toBe('preview'))
    event({event:'ack',id:commands.at(-1)!.id,ok:true,decoderId:101});await first
    event({event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw',decoderId:101})
    expect(transport.state().liveSources[0]?.state).toBe('PVW_READY')
    const count=commands.length,second=transport.cue({kind:'SOURCE',source:'ndi:ESTUDIO'})
    await vi.waitFor(()=>expect(commands.length).toBeGreaterThan(count))
    const opening=commands.at(-1)!
    const signal={width:640,height:360,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:0,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:25,arrivalJitterMs:0}
    for(const decoderId of [undefined,101,102]) {
      event({event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw',decoderId})
      event({event:'sourceTelemetry',itemId:'source:ndi:ESTUDIO',bus:'pvw',decoderId,signal})
    }
    expect(transport.state().liveSources[0]?.state).toBe('CUEING')
    event({event:'ack',id:opening.id,ok:true,decoderId:102});await second
    event({event:'itemError',itemId:'source:ndi:ESTUDIO',bus:'pvw',decoderId:101,message:'decoder anterior'})
    event({event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw',decoderId:101})
    event({event:'sourceTelemetry',itemId:'source:ndi:ESTUDIO',bus:'pvw',decoderId:101,signal})
    expect(transport.state().liveSources[0]?.state).toBe('CUEING')
    event({event:'sourceReady',itemId:'source:ndi:ESTUDIO',bus:'pvw',decoderId:102})
    event({event:'sourceTelemetry',itemId:'source:ndi:ESTUDIO',bus:'pvw',decoderId:102,signal})
    expect(transport.state().liveSources[0]).toMatchObject({state:'PVW_READY',busSignals:{pvw:{status:'SIGNAL_OK'}}})
  })

  it('nova encarnação do PGM rejeita perda/medição antiga e falha legítima do TAKE permanece válida',async()=>{
    const value=view(['a','b'])
    for(const row of value.items)Object.assign(row,{item:{...row.item,type:'LIVE',sourceRef:'ndi:ESTUDIO',durationOverride:250},asset:null})
    start(value);event({event:'ready',channelId:channel.id,decoderIdentity:true})
    await transport.take('grade','0')
    event({event:'state',onAir:'0',onAirDecoderId:201})
    const signal={width:640,height:360,rateNum:25,rateDen:1,interlaceMode:'progressive',audioChannels:2,sampleRate:48000,videoAgeMs:0,audioAgeMs:0,videoPresent:true,audioPresent:true,receivedFrames:25,arrivalJitterMs:0}
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',decoderId:201,signal})
    event({event:'state',onAir:'0',onAirDecoderId:202})
    expect(transport.state().liveSources[0]!.measurements!.pgm).toBeUndefined()
    const health=transport.health()
    event({event:'sourceLost',itemId:'0',decoderId:201,reason:'perda anterior'})
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',decoderId:201,signal:{...signal,videoPresent:false}})
    expect(transport.health()).toEqual(health)
    event({event:'sourceTelemetry',itemId:'0',bus:'pgm',decoderId:202,signal})
    holdLiveTake=true;await transport.take('grade','1')
    event({event:'state',onAir:'0',onAirDecoderId:202,armed:'1',armedDecoderId:203})
    event({event:'itemError',itemId:'1',bus:'pgm',decoderId:199,message:'tentativa antiga'})
    expect(transport.hasPendingCommand()).toBe(true)
    event({event:'itemError',itemId:'1',bus:'pgm',decoderId:203,message:'tentativa atual recusada'})
    expect(transport.hasPendingCommand()).toBe(false)
    expect(transport.state().onAir?.itemId).toBe('0')
  })
  it('inspeção pode abrir mídia pendente de QC, mas PGM continua bloqueado', async () => {
    const good = join(directory, 'pendente.mkv'); writeFileSync(good, 'video')
    const base = view([good]); const asset = { ...base.items[0]!.asset!, qcStatus: 'PENDING' as const, ignored: true }
    const value = { ...base, items: [{ ...base.items[0]!, asset }] }
    transport = new EngineTransport(channel, () => value, () => asset,
      { binary: 'fake-engine', outputs: ['null'], preview: null, bitrateKbps: 500 })
    event({event:'ready',channelId:channel.id})
    await transport.cue({ kind: 'ASSET', id: '0' })
    expect(transport.state().preview).toEqual({ kind: 'ASSET', id: '0' })
    await expect(transport.take('grade', '0')).rejects.toThrow('Nenhum item reproduzível')
    expect(transport.state().playing).toBe(false)
    expect(commands.some((command) => command.cmd === 'take')).toBe(false)
  })
  it('reabre o próximo preparado se a revisão alterar os cortes mantendo o ID', async () => {
    const first = join(directory, 'a.mkv'); const next = join(directory, 'b.mkv')
    writeFileSync(first, 'video'); writeFileSync(next, 'video')
    let current = view([first, next])
    transport = new EngineTransport(channel, () => current, () => null,
      { binary: 'fake-engine', outputs: ['null'], preview: null, bitrateKbps: 500 })
    event({ event: 'ready', channelId: channel.id }); await transport.take('grade', '0')
    transport.tick(); await vi.waitFor(() => expect(transport.state().preparedItemId).toBe('1'))
    current = { ...current, items: [current.items[0]!, { ...current.items[1]!, trim: { in: 50, out: 200 } }],schedule:{...current.schedule,items:current.schedule.items.map(row=>row.id==='1'?{...row,duration:150}:row)} }
    event({ event: 'eos', itemId: '0' })
    await vi.waitFor(() => expect(transport.state().onAir?.itemId).toBe('1'))
    const loaded = commands.filter((command) => command.cmd === 'load')
    expect(loaded.map((command) => command.item?.itemId)).toEqual(['0', '1', '1'])
    expect(loaded.at(-1)?.item).toMatchObject({ trimIn: 50, trimOut: 200 })
  })
})

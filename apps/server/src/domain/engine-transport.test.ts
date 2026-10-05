import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { framesSinceMidnight, type Channel } from '@rplayout/protocol'
import type { LivePriorityEvent } from './priority-live.js'
import { EngineTransport } from './engine.js'
import type { RundownView } from './plan.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

const channel = { id: 'channel', name: 'Test', width: 320, height: 180,
  rate: { num: 25, den: 1 }, scan: 'PROGRESSIVE', fieldOrder: 'TFF', ceilingDbtp: -1 } as Channel
let directory: string
let transport: EngineTransport
let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
let commands: Array<{ id: number; cmd: string; item?: { itemId: string; path: string }; bus?: 'pgm' | 'pvw'; frames?: number; itemId?:string; on?:boolean }>
let onAir: string | undefined
let armed: string | undefined
let rejectLoad: string | null
let holdLoad: boolean
let holdLiveTake: boolean
let rejectTakeAck: boolean
let holdFileTake: boolean
let priorityEvents: LivePriorityEvent[]

function event(value: object): void { child.stdout.write(JSON.stringify(value) + '\n') }
function ack(id: number, ok = true): void { event({ event: 'ack', id, ok, error: ok ? undefined : 'decoder recusou o arquivo' }) }
function view(paths: string[], loop = false): RundownView {
  return {
    channel, rundown: { id: 'grade', channelId: channel.id, loop },
    items: paths.map((path, index) => ({ item: { id: String(index), autoNext: true, audioTrack: 0 },
      asset: { id: String(index), path, contentHash:existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):'a'.repeat(64),kind: 'VIDEO', probeError: null }, trim: { in: 0, out: 250 }, gainDb: 0 })),
    schedule: { items: paths.map((_, index) => ({ id: String(index), state: 'SCHEDULED', duration: 250 })) },
  } as unknown as RundownView
}
function start(value: RundownView, onTakeConfirmed?: ConstructorParameters<typeof EngineTransport>[3]['onTakeConfirmed'], currentView = () => value, executionIdentity?: () => string | null, boundary:Pick<ConstructorParameters<typeof EngineTransport>[3],'onPlaylistEnd'|'onPreparePlaylistEnd'|'canRecoverProgram'|'canStartProgram'|'fenceLease'>={}): void {
  transport = new EngineTransport(channel, currentView, () => null,
    { binary: 'fake-engine', outputs: ['null'], preview: null, bitrateKbps: 500, onLivePriority: event => priorityEvents.push(event),onTakeConfirmed, executionIdentity,...boundary })
  // A decoder ACK requires the real process to have built its pipeline first.
  // Lease-specific tests deliberately supply Ready only after FenceApplied.
  if(!boundary.fenceLease)event({event:'ready',channelId:channel.id})
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'playout-transport-'))
  commands = []; onAir = undefined; armed = undefined; rejectLoad = null; holdLoad = false; holdLiveTake = false
  rejectTakeAck = false
  holdFileTake = false
  priorityEvents = []
  child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
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
      if (command.cmd === 'cancelTake') armed = undefined
      if (command.cmd === 'take') { onAir = armed; armed = undefined }
      if (command.cmd === 'stop') onAir = undefined
      event({ event: 'state', onAir, armed })
      ack(command.id, !(command.cmd === 'take' && rejectTakeAck))
    })
  })
})
afterEach(() => { transport?.close(); vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('transporte real confirmado pelo engine', () => {
  it('qualidade do QC usa somente comando ligado à fonte vigente, sem LOAD/TAKE ou outro CUE',async()=>{
    transport=new EngineTransport(channel,()=>view([]),()=>null,{binary:'fake-engine',outputs:['null'],preview:'srt://local/pvw',qcPreview:'srt://local/qc',bitrateKbps:500})
    event({event:'ready',channelId:channel.id})
    await transport.cue({kind:'SOURCE',source:'ndi:ESTÚDIO'})
    const before=transport.state(),count=commands.length
    await transport.qcMonitor('ndi:ESTÚDIO',true);await transport.qcMonitor('ndi:ESTÚDIO',false)
    expect(commands.slice(count)).toMatchObject([{cmd:'qcMonitor',itemId:'source:ndi:ESTÚDIO',on:true},{cmd:'qcMonitor',itemId:'source:ndi:ESTÚDIO',on:false}])
    expect(transport.state()).toMatchObject({preview:before.preview,onAir:before.onAir,playing:before.playing,preparedItemId:before.preparedItemId})
    await transport.cue({kind:'SOURCE',source:'omt:NOVA'})
    const changed=commands.length
    await expect(transport.qcMonitor('ndi:ESTÚDIO',true)).rejects.toThrow('preview ativo')
    expect(commands).toHaveLength(changed)
  })
  it('QC em qualidade indisponível não finge sucesso no transporte sem destino dedicado',async()=>{
    start(view([]));await transport.cue({kind:'SOURCE',source:'ndi:ESTÚDIO'})
    const count=commands.length
    await expect(transport.qcMonitor('ndi:ESTÚDIO',true)).rejects.toThrow('indisponível')
    expect(commands).toHaveLength(count)
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
    const result = expect(take).rejects.toThrow('revisão ou a mídia mudou')
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
    expect(commands.map((c) => c.cmd)).toEqual(['load', 'take', 'preview'])
    expect(transport.state().onAir?.itemId).toBe('1')
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

    event({ event: 'sourceLost', itemId: 'source:ndi:ESTUDIO', reason: 'sem pacotes por 2 s' })
    expect(transport.state().liveSources[0]).toMatchObject({
      state: 'LOST', message: 'sem pacotes por 2 s',
    })
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
    current = { ...current, items: [current.items[0]!, { ...current.items[1]!, trim: { in: 50, out: 200 } }] }
    event({ event: 'eos', itemId: '0' })
    await vi.waitFor(() => expect(transport.state().onAir?.itemId).toBe('1'))
    const loaded = commands.filter((command) => command.cmd === 'load')
    expect(loaded.map((command) => command.item?.itemId)).toEqual(['0', '1', '1'])
    expect(loaded.at(-1)?.item).toMatchObject({ trimIn: 50, trimOut: 200 })
  })
})

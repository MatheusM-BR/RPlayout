import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {spawn} from 'node:child_process'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {MediaMtx} from './mediamtx.js'
import {RelaySupervisor} from './relays.js'
import {DistributionOwnership} from './distribution-ownership.js'
import {writePrivateConfig} from './private-config-file.js'
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),spawn:vi.fn()}))
vi.mock('./private-config-file.js',()=>({writePrivateConfig:vi.fn(async(_path,_content,authorize)=>authorize?.())}))
let db:ReturnType<typeof openDatabase>,guard:DistributionOwnership,media:MediaMtx,relays:RelaySupervisor,children:Child[]
type Child=EventEmitter&{pid:number|undefined;exitCode:null;signalCode:null;killed:boolean;stdin:PassThrough;stdout:PassThrough;stderr:PassThrough;kill:ReturnType<typeof vi.fn>}
const target={id:'out',name:'Fixture',source:'rtsp://127.0.0.1/source',url:'srt://127.0.0.1:9999?passphrase=PRIVATE'}
beforeEach(()=>{
  db=openDatabase(':memory:');guard=new DistributionOwnership(db.db);children=[];vi.mocked(spawn).mockClear();vi.mocked(writePrivateConfig).mockClear()
  vi.mocked(spawn).mockImplementation(()=>{const child=Object.assign(new EventEmitter(),{pid:900001+children.length,exitCode:null,signalCode:null,killed:false,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});children.push(child);return child as unknown as ReturnType<typeof spawn>})
  media=new MediaMtx({binary:'fake-media',configPath:'fixture.yml',bind:'127.0.0.1',logLevel:'warn',ownership:guard});relays=new RelaySupervisor('fake-relay',guard)
})
afterEach(()=>{for(const child of children)child.emit('exit',0,null);media.stop();relays.closeAll();try{guard.close()}catch{}db.sqlite.close();vi.useRealTimers()})
describe('fronteiras de distribuição sem spawn/arquivo ou rede física',()=>{
  it('relay não inicia/reconecta de origem inconclusiva e preserva processo previamente admitido',()=>{
    let ready=false;relays=new RelaySupervisor('fake-relay',guard,()=>ready)
    expect(()=>relays.sync([target])).toThrow('não foi confirmada');relays.tick();expect(spawn).not.toHaveBeenCalled()
    ready=true;relays.sync([target]);const previous=children[0]!;ready=false
    relays.tick(Date.now()+10000);expect(()=>relays.sync([{...target,url:'srt://127.0.0.1:9998'}])).toThrow('não foi confirmada')
    expect(spawn).toHaveBeenCalledTimes(1);expect(previous.kill).not.toHaveBeenCalled()
  })
  it('apply enfileirado perde posse antes de escrever e não publica configuração',async()=>{
    const pending=media.apply([],[]),rejected=expect(pending).rejects.toThrow(/encerr/);guard.close();await rejected;expect(writePrivateConfig).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled()
  })
  it('stop impede apply/watchdog/start e preserva configuração',async()=>{
    media.stop();await expect(media.apply([],[])).rejects.toThrow('encerrado');await expect(media.start()).rejects.toThrow('encerrado');media.watchdog();expect(spawn).not.toHaveBeenCalled();expect(writePrivateConfig).not.toHaveBeenCalled()
  })
  it('erro MediaMTX com PID não autoriza reinício até exit',async()=>{
    await media.start();const old=children[0]!;old.emit('error',new Error('IPC_FAILURE'));media.watchdog();await media.start();expect(spawn).toHaveBeenCalledTimes(1);expect(guard.canSpawn('MEDIAMTX')).toBe(false)
    old.emit('exit',1,null);await media.start();expect(spawn).toHaveBeenCalledTimes(2);old.emit('exit',1,null);expect(media.processId).toBe(children[1]!.pid)
  })
  it('falha de spawn sem PID apos error não mantém recurso falso nem mata child alheio',async()=>{
    vi.mocked(spawn).mockImplementationOnce(()=>{const child=Object.assign(new EventEmitter(),{pid:undefined,exitCode:null,signalCode:null,killed:false,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});children.push(child);return child as unknown as ReturnType<typeof spawn>})
    await media.start();children[0]!.emit('error',new Error('ENOENT'));expect(guard.canSpawn('MEDIAMTX')).toBe(true);await media.start();expect(spawn).toHaveBeenCalledTimes(2)
  })
  it('peer não escreve configuração nem abre mídia/relay',async()=>{
    guard.claim();const peer=new DistributionOwnership(db.db),other=new MediaMtx({binary:'fake',configPath:'fixture.yml',bind:'127.0.0.1',logLevel:'warn',ownership:peer})
    await expect(other.apply([],[])).rejects.toThrow('Outra instância');await expect(other.start()).rejects.toThrow('Outra instância');expect(()=>new RelaySupervisor('fake',peer).sync([target])).toThrow('Outra instância');expect(spawn).not.toHaveBeenCalled();expect(writePrivateConfig).not.toHaveBeenCalled()
  })
  it('relay alterado aguarda exit real antes da nova conexão privada',()=>{
    relays.sync([target]);const old=children[0]!,changed={...target,url:'srt://127.0.0.1:9998'}
    relays.sync([changed]);relays.tick(Date.now()+10000);expect(spawn).toHaveBeenCalledTimes(1);expect(old.kill).toHaveBeenCalledTimes(1)
    old.emit('exit',0,null);relays.tick();expect(spawn).toHaveBeenCalledTimes(2)
    old.emit('exit',0,null);expect(guard.canSpawn('RELAY:out')).toBe(false);expect(relays.status()[0]!.state).toBe('CONECTANDO')
  })
  it('relay fatal/erro com PID não cria duplicado; close não ressuscita por tick',()=>{
    relays.sync([target]);const old=children[0]!;old.emit('error',new Error('IPC_FAILURE'));relays.tick(Date.now()+10000);expect(spawn).toHaveBeenCalledTimes(1)
    relays.closeAll();relays.tick(Date.now()+100000);expect(spawn).toHaveBeenCalledTimes(1);expect(()=>relays.sync([target])).toThrow('encerrado');expect(guard.canSpawn('RELAY:out')).toBe(false)
  })
  it('destino removido permanece protegido até saída e sinais velhos não o reativam',()=>{
    relays.sync([target]);const old=children[0]!;relays.sync([]);old.stdout.write(JSON.stringify({event:'connected'})+'\n');relays.tick();expect(spawn).toHaveBeenCalledTimes(1);expect(guard.canSpawn('RELAY:out')).toBe(false)
    old.emit('exit',0,null);expect(guard.canSpawn('RELAY:out')).toBe(true);expect(relays.status()).toEqual([])
  })
})

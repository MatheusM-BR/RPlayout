import {mkdtempSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,describe,expect,it,vi} from 'vitest'
import Database from 'better-sqlite3'
import {HaReplication,haOptions,type HaOptions,type HaSnapshot} from './ha-replication.js'
const key='ab'.repeat(32),directory=mkdtempSync(join(tmpdir(),'RPlayout-ha-unit-')),owned=new Set<HaReplication>()
afterEach(()=>{for(const node of owned)node.close();owned.clear();vi.restoreAllMocks()})
const config=(role:'PRIMARY'|'STANDBY',file=':memory:'):HaOptions=>({role,clusterId:'test',nodeId:role==='PRIMARY'?'a':'b',peerNodeId:role==='PRIMARY'?'b':'a',key,file,peerUrl:role==='PRIMARY'?'http://127.0.0.1:1234':null})
const snapshot=():HaSnapshot=>({version:1,capturedAt:new Date().toISOString(),channels:[{channelId:'ch',configuration:{source:'srt://camera:1?passphrase=PRIVATE_HA'},revisions:[{id:'pub',payload:{title:'ÇÃO'}}],checkpoint:{value:{itemId:'vt',elapsed:63}},transport:{onAir:{itemId:'vt'}},blockers:{configuration:{state:'UNCERTAIN'}}}],asRun:[{id:'run',channelId:'ch',mediaHash:'a'.repeat(64),startPositionFrames:10,endPositionFrames:63}],journals:[{kind:'INTERRUPTION_COMMAND',phase:'UNCERTAIN'}]})
const node=(options:HaOptions,capture=snapshot,fetcher?:typeof fetch)=>{const result=new HaReplication(options,capture,fetcher);owned.add(result);return result}
function pair(files=false){
  const receiver=node(config('STANDBY',files?join(directory,`b-${Math.random()}.db`):':memory:'))
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>new Response(JSON.stringify(receiver.receive(JSON.parse(String(init!.body)),init!.headers as Record<string,string>)),{status:200}))
  const sender=node(config('PRIMARY',files?join(directory,`a-${Math.random()}.db`):':memory:'),snapshot,fetcher)
  return {receiver,sender,fetcher}
}
describe('espelho HA autenticado, durável, sem autoridade de PGM',()=>{
  it.each(['channels','witness_channels','sqlitex_foreign'])('recusa banco alheio %s antes de mudar journal ou criar tabelas HA',(table)=>{
    const file=join(directory,`foreign-${Math.random()}.db`),foreign=new Database(file)
    try{
      foreign.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY); INSERT INTO ${table} VALUES ('preservar')`)
      const journal=foreign.pragma('journal_mode',{simple:true})
      expect(()=>node(config('STANDBY',file))).toThrow('outro serviço')
      expect(foreign.pragma('journal_mode',{simple:true})).toBe(journal)
      expect(foreign.prepare(`SELECT * FROM ${table}`).all()).toEqual([{id:'preservar'}])
      expect(foreign.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'ha_*'").all()).toEqual([])
    }finally{foreign.close()}
  })
  it('replica edição/checkpoint/as-run com confirmação e sem transportar segredo em claro',async()=>{
    const {sender,receiver,fetcher}=pair();await sender.tick()
    expect(sender.status()).toMatchObject({sequence:1,pending:false,error:null,failoverReady:false,automaticTake:false})
    expect(receiver.mirror()).toMatchObject({channels:[{configuration:{source:'srt://camera:1?passphrase=PRIVATE_HA'},checkpoint:{value:{elapsed:63}}}],asRun:[{id:'run',endPositionFrames:63}]})
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('PRIVATE_HA')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({redirect:'error'});expect(receiver.status()).toMatchObject({mirroredChannels:1,mirroredAsRun:1,failoverReady:false})
  })
  it('ACK perdido reenvia conteúdo original e não avança duas sequências',async()=>{
    const {sender,receiver,fetcher}=pair();fetcher.mockImplementationOnce(async(_url,init)=>{receiver.receive(JSON.parse(String(init!.body)),init!.headers as Record<string,string>);throw new Error('ACK lost')})
    await sender.tick();expect(sender.status()).toMatchObject({pending:true,sequence:0});expect(receiver.status().sequence).toBe(1)
    await sender.tick();expect(sender.status()).toMatchObject({pending:false,sequence:1});expect(receiver.status().sequence).toBe(1)
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
  })
  it('novo processo continua pedido durável pendente; banco reserva/cofre continuam separados',async()=>{
    const {sender,receiver,fetcher}=pair(true),senderOptions=sender.options,receiverOptions=receiver.options
    fetcher.mockImplementationOnce(async(_url,init)=>{receiver.receive(JSON.parse(String(init!.body)),init!.headers as Record<string,string>);throw new Error('unknown')})
    await sender.tick();sender.close();receiver.close()
    expect(readFileSync(receiverOptions.file).toString('utf8')).not.toContain('PRIVATE_HA')
    const restartedReceiver=node(receiverOptions)
    const restarted=node(senderOptions,()=>{throw new Error('Não recapturar pedido pendente')},async(_url,init)=>new Response(JSON.stringify(restartedReceiver.receive(JSON.parse(String(init!.body)),init!.headers as Record<string,string>))))
    await restarted.tick();expect(restarted.status()).toMatchObject({sequence:1,pending:false,error:null});expect(restartedReceiver.mirror()?.asRun).toHaveLength(1)
  })
  it('recusa adulteração, credencial administrativa, contador antigo e relógio superado',async()=>{
    const {sender,receiver,fetcher}=pair();await sender.tick()
    const init=fetcher.mock.calls[0]![1]!,wire=JSON.parse(String(init.body)),headers=init.headers as Record<string,string>
    expect(receiver.authenticate({'x-rplayout-control-token':key})).toBe(false)
    expect(()=>receiver.receive({...wire,ciphertext:wire.ciphertext.slice(0,-8)+'AAAAAAAA'},headers)).toThrow('Envelope HA alterado')
    expect(()=>receiver.receive({...wire,targetId:'other'},headers)).toThrow('par configurado')
    expect(receiver.authenticate({...headers,'x-rplayout-ha-time':String(Date.now()-120_000)})).toBe(false)
    await sender.tick();expect(receiver.status().sequence).toBe(2)
    expect(()=>receiver.receive(wire,headers)).toThrow('fora de ordem');expect(receiver.status().sequence).toBe(2)
  })
  it('não aceita confirmação HTTP forjada nem redirect para outro host',async()=>{
    const {sender,receiver,fetcher}=pair();fetcher.mockResolvedValueOnce(new Response('{"stored":true}'))
    await sender.tick();expect(sender.status()).toMatchObject({sequence:0,pending:true});expect(receiver.status().sequence).toBe(0)
    fetcher.mockRejectedValueOnce(new Error('redirect PRIVATE_URL'))
    await sender.tick();expect(sender.status().error).not.toContain('PRIVATE_');expect(sender.status().pending).toBe(true)
  })
  it('duas chamadas não enviam em paralelo e remetente vivo não perde a posse',async()=>{
    const {sender,fetcher}=pair(true);let release!:()=>void
    const wait=new Promise<void>(r=>release=r),original=fetcher.getMockImplementation()!
    fetcher.mockImplementationOnce(async(...args)=>{await wait;return original(...args)})
    const pending=sender.tick();await sender.tick();expect(fetcher).toHaveBeenCalledTimes(1)
    expect(()=>node(sender.options)).toThrow('Outro remetente HA')
    release();await pending;expect(sender.status().pending).toBe(false)
  })
  it('pareamento, papel ou chave diferentes não reiniciam a identidade do banco',async()=>{
    const {receiver}=pair(true);await receiver.close()
    expect(()=>node({...receiver.options,key:'cd'.repeat(32)})).toThrow('outro pareamento')
    const restored=node(receiver.options);expect(restored.status().sequence).toBe(0)
  })
  it('histórico de canal removido é preservado, não descartado para caber no espelho',async()=>{
    const receiver=node(config('STANDBY'))
    const sender=node(config('PRIMARY'),()=>({...snapshot(),asRun:[{id:'archived-run',channelId:'removed'}]}),async(_u,i)=>new Response(JSON.stringify(receiver.receive(JSON.parse(String(i!.body)),i!.headers as Record<string,string>))))
    await sender.tick();expect(receiver.mirror()?.asRun).toEqual([{id:'archived-run',channelId:'removed'}])
  })
  it('configuração incompleta, mesmo nó, URL privada ou banco principal são recusados',()=>{
    expect(haOptions('main.db',{})).toBeNull()
    expect(()=>haOptions('main.db',{RPLAYOUT_HA_KEY:key})).toThrow('papel HA')
    const env={RPLAYOUT_HA_ROLE:'PRIMARY',RPLAYOUT_HA_CLUSTER:'test',RPLAYOUT_HA_NODE:'a',RPLAYOUT_HA_PEER_NODE:'b',RPLAYOUT_HA_KEY:key,RPLAYOUT_HA_PEER:'http://127.0.0.1:1234'}
    expect(()=>haOptions('main.db',{...env,RPLAYOUT_HA_DB:'main.db'})).toThrow('banco próprio')
    expect(()=>haOptions('main.db',{...env,RPLAYOUT_HA_PEER_NODE:'a'})).toThrow('nós distintos')
    expect(()=>haOptions('main.db',{...env,RPLAYOUT_HA_PEER:'http://user:pass@other'})).toThrow('sem credenciais')
    expect(()=>haOptions('main.db',{...env,RPLAYOUT_HA_WITNESS:'http://witness'})).toThrow('chave própria')
    expect(()=>haOptions('main.db',{...env,RPLAYOUT_HA_WITNESS:'http://witness',RPLAYOUT_HA_WITNESS_KEY:key})).toThrow('distinta')
    expect(haOptions('main.db',{...env,RPLAYOUT_HA_WITNESS:'http://witness',RPLAYOUT_HA_WITNESS_KEY:'cd'.repeat(32)})?.witnessUrl).toBe('http://witness')
  })
})

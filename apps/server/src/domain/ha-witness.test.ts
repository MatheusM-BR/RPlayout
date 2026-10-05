import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import Database from 'better-sqlite3'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {HaWitness,HaLeaseClient,HA_LEASE_MS,type WitnessOptions} from './ha-witness.js'
const key='eb'.repeat(32),owned=new Set<HaWitness>(),clients=new Set<HaLeaseClient>(),directory=mkdtempSync(join(tmpdir(),'RPlayout-witness-unit-'))
const config=(file=':memory:'):WitnessOptions=>({file,clusterId:'cluster',nodes:['a','b'],key})
const witness=(options=config(),clock=()=>performance.now())=>{const value=new HaWitness(options,clock);owned.add(value);return value}
afterEach(()=>{for(const client of clients)client.close();for(const value of owned)value.close();clients.clear();owned.clear();vi.restoreAllMocks()})
const client=(node:string,fetcher:typeof fetch=fetch)=>{const value=new HaLeaseClient('http://witness.invalid',key,'cluster',node,fetcher);clients.add(value);return value}
const fetchFor=(value:HaWitness)=>vi.fn<typeof fetch>(async(_url,init)=>new Response(JSON.stringify(value.request(JSON.parse(String(init!.body))))))

describe('testemunha de concessão curta independente de relógio civil',()=>{
  it.each(['channels','sqlitex_foreign'])('não converte nem muda journal/tabelas de banco alheio %s indicado por engano',(table)=>{
    const file=join(directory,randomUUID()+'.db'),foreign=new Database(file)
    foreign.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY); INSERT INTO ${table} VALUES ('pgm')`)
    const before=foreign.pragma('journal_mode',{simple:true})
    expect(()=>witness(config(file))).toThrow('outro serviço')
    expect(foreign.pragma('journal_mode',{simple:true})).toBe(before)
    expect(foreign.prepare(`SELECT id FROM ${table}`).get()).toEqual({id:'pgm'})
    expect(foreign.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'witness_%'").all()).toEqual([])
    foreign.close()
  })
  it('quarentena inicial, dono exclusivo, renovação e troca somente após expiração',async()=>{
    let clock=0;const value=witness(config(),()=>clock),fetcher=fetchFor(value),a=client('a',fetcher),b=client('b',fetcher),ownerA=randomUUID(),ownerB=randomUUID()
    await expect(a.obtain('ch',ownerA,1)).rejects.toThrow('não confirmada')
    clock=6001;expect(await a.obtain('ch',ownerA,1)).toEqual({term:1,ttlMs:HA_LEASE_MS})
    clock+=2000;await expect(b.obtain('ch',ownerB,1)).rejects.toThrow('não confirmada')
    expect(await a.obtain('ch',ownerA,2)).toMatchObject({term:1})
    clock+=4999;await expect(b.obtain('ch',ownerB,2)).rejects.toThrow('não confirmada')
    clock+=1;expect(await b.obtain('ch',ownerB,3)).toMatchObject({term:2});await expect(a.obtain('ch',ownerA,3)).rejects.toThrow('não confirmada')
  })
  it('repetição não estende lease e nonce antigo não recupera grant expirado',async()=>{
    let clock=6001;const value=witness(config(),()=>clock),fetcher=fetchFor(value),a=client('a',fetcher),owner=randomUUID()
    clock+=6001;await a.obtain('ch',owner,1);const original=JSON.parse(String(fetcher.mock.calls[0]![1]!.body))
    clock+=4000;expect(value.request(original).term).toBe(1)
    clock+=1001;expect(()=>value.request(original)).toThrow('Nonce antigo')
    expect(await a.obtain('ch',owner,2)).toMatchObject({term:2})
  })
  it('reinício preserva termo e espera grant antigo expirar, sem compartilhar processo/banco de PGM',async()=>{
    let clock=0;const options=config(join(directory,randomUUID()+'.db')),value=witness(options,()=>clock),a=client('a',fetchFor(value))
    clock=6001;await a.obtain('ch',randomUUID(),1);value.close()
    const restarted=witness(options,()=>clock),b=client('b',fetchFor(restarted))
    clock+=5000;await expect(b.obtain('ch',randomUUID(),1)).rejects.toThrow('não confirmada')
    clock+=1001;expect(await b.obtain('ch',randomUUID(),1)).toMatchObject({term:2})
  })
  it('mudança de relógio civil não libera outro engine antes do monotônico',async()=>{
    let clock=0;const value=witness(config(),()=>clock),fetcher=fetchFor(value),a=client('a',fetcher),b=client('b',fetcher)
    clock=6001;await a.obtain('ch',randomUUID(),1)
    const wall=Date.now();vi.spyOn(Date,'now').mockReturnValue(wall+24*60*60*1000)
    await expect(b.obtain('ch',randomUUID(),1)).rejects.toThrow('não confirmada')
    clock+=HA_LEASE_MS;expect(await b.obtain('ch',randomUUID(),2)).toMatchObject({term:2})
  })
  it('pares/chave/identidade incorretos e outro árbitro vivo são recusados',async()=>{
    let clock=0;const options=config(join(directory,randomUUID()+'.db')),value=witness(options,()=>clock)
    expect(()=>witness(options,()=>clock)).toThrow('Outra testemunha');clock=6001
    const bad=client('unknown',fetchFor(value));await expect(bad.obtain('ch',randomUUID(),1)).rejects.toThrow('não confirmada')
    value.close();expect(()=>witness({...options,key:'ad'.repeat(32)},()=>clock)).toThrow('outro cluster')
    expect(witness(options,()=>clock).health().quarantined).toBe(true)
  })
  it('resposta forjada, termo menor, replay de outro dono e redirect não viram posse',async()=>{
    let clock=0;const value=witness(config(),()=>clock),normal=fetchFor(value),fetcher=vi.fn<typeof fetch>((...args)=>normal(...args)),a=client('a',fetcher),owner=randomUUID()
    clock=6001;await a.obtain('ch',owner,1)
    fetcher.mockImplementationOnce(async(...args)=>{const response=await normal(...args),receipt=await response.json() as any;receipt.term=500;return new Response(JSON.stringify(receipt))})
    await expect(a.obtain('ch',owner,2)).rejects.toThrow('não confirmada');expect(a.status().leases[0]!.term).toBe(1)
    fetcher.mockRejectedValueOnce(new Error('redirect SECRET_URL'));await expect(a.obtain('ch',owner,3)).rejects.not.toThrow('SECRET_URL')
    expect(fetcher.mock.calls[0]![1]).toMatchObject({redirect:'error'})
  })
  it('canais independentes, fechamento e timeout não concedem autoridade global',async()=>{
    let clock=0;const value=witness(config(),()=>clock),a=client('a',fetchFor(value)),b=client('b',fetchFor(value));clock=6001
    expect(await a.obtain('one',randomUUID(),1)).toMatchObject({term:1});expect(await b.obtain('two',randomUUID(),1)).toMatchObject({term:1})
    a.close();await expect(a.obtain('one',randomUUID(),2)).rejects.toThrow('não confirmada');expect(a.status().physicalOutputValidated).toBe(false)
  })
})

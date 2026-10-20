import {it,expect,afterEach} from 'vitest'
import {randomUUID} from 'node:crypto'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import Database from 'better-sqlite3'
import {HaWitness,HaLeaseClient,HA_LEASE_MS,HA_FENCE_MARGIN_MS} from './ha-witness.js'
import {SecretVault} from './secret-vault.js'
import {witnessControlCanonical} from './ha-witness-control.js'
// NOT_RUN: source batch, no witness deployment, engine or physical output.
const key='da'.repeat(32),controlKey='db'.repeat(32),owned=new Set<HaWitness>(),clients=new Set<HaLeaseClient>()
afterEach(()=>{for(const client of clients)client.close();for(const witness of owned)witness.close();clients.clear();owned.clear()})
function fixture(file=':memory:',selectedControl:string|null=controlKey){
  let now=0
  const options={file,clusterId:'cluster',nodes:['a','b'],key,controlKey:selectedControl}
  const witness=new HaWitness(options,()=>now);owned.add(witness)
  const fetcher:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init!.body));return new Response(JSON.stringify(body.request.purpose==='LEASE'?witness.request(body):witness.controlRequest(body)))}
  const client=(node:string,network=fetcher,secret:string|null=controlKey)=>{const value=new HaLeaseClient('http://witness.invalid',key,'cluster',node,network,secret);clients.add(value);return value}
  const a=client('a'),b=client('b');now=6001
  return {witness,a,b,client,fetcher,options,clock:()=>now,advance:(ms:number)=>{now+=ms}}
}
const command=async(client:HaLeaseClient,targetNodeId:string)=>{const state=await client.assignment('ch');return {requestId:randomUUID(),channelId:'ch',fromNodeId:state.selectedNodeId!,targetNodeId,expectedTerm:state.lastTerm,expectedRevision:state.revision}}
it('lease expiration never re-admits another node; transfer and reverse transfer are explicit',async()=>{
  const f=fixture();await f.a.obtain('ch',randomUUID(),1);f.advance(HA_LEASE_MS)
  await expect(f.b.obtain('ch',randomUUID(),1)).rejects.toThrow()
  expect(await f.b.transfer(await command(f.b,'b'))).toMatchObject({phase:'REFUSED',reason:'LEASE_NOT_EXPIRED'})
  f.advance(HA_FENCE_MARGIN_MS);const move=await command(f.b,'b')
  expect(await f.b.transfer(move)).toMatchObject({phase:'TRANSFERRED',assignmentRevision:2,automaticTake:false,physicalOutputValidated:false})
  await expect(f.a.obtain('ch',randomUUID(),2)).rejects.toThrow();expect(await f.b.obtain('ch',randomUUID(),2)).toMatchObject({term:2})
  f.advance(HA_LEASE_MS+HA_FENCE_MARGIN_MS);await expect(f.a.obtain('ch',randomUUID(),3)).rejects.toThrow()
  expect(await f.a.transfer(await command(f.a,'a'))).toMatchObject({phase:'TRANSFERRED',assignmentRevision:3})
  expect(await f.a.obtain('ch',randomUUID(),4)).toMatchObject({term:3})
})
it('a refusal is terminal for its UUID and cannot become a delayed takeover',async()=>{
  const f=fixture();await f.a.obtain('ch',randomUUID(),1);const request=await command(f.b,'b'),refused=await f.b.transfer(request)
  f.advance(HA_LEASE_MS+HA_FENCE_MARGIN_MS)
  expect(await f.b.transfer(request)).toEqual(refused);expect(await f.b.transferStatus('ch',request.requestId)).toEqual(refused)
  await expect(f.b.transfer({...request,expectedRevision:2})).rejects.toThrow()
  expect(await f.b.assignment('ch')).toMatchObject({selectedNodeId:'a',revision:1})
})
it('lost reply is queried, not replayed; absent query remains nonterminal',async()=>{
  const f=fixture();await f.a.obtain('ch',randomUUID(),1);f.advance(HA_LEASE_MS+HA_FENCE_MARGIN_MS)
  const request=await command(f.b,'b'),lost=f.client('b',async(...args)=>{await f.fetcher(...args);throw new Error('LOST_RESPONSE_SECRET_URL')})
  await expect(lost.transfer(request)).rejects.not.toThrow('SECRET_URL')
  expect(await f.b.transferStatus('ch',request.requestId)).toMatchObject({phase:'TRANSFERRED',assignmentRevision:2})
  expect(await f.b.transferStatus('ch',randomUUID())).toMatchObject({kind:'NOT_FOUND',terminal:false,automaticTake:false})
  expect(f.b.status().leases).toEqual([])
})
it('restart preserves admission/history and does not let the former primary return by itself',async()=>{
  const file=join(mkdtempSync(join(tmpdir(),'RPlayout-witness-admission-')),'witness.db'),f=fixture(file)
  await f.a.obtain('ch',randomUUID(),1);f.advance(HA_LEASE_MS+HA_FENCE_MARGIN_MS);const request=await command(f.b,'b');await f.b.transfer(request);f.witness.close()
  const restarted=new HaWitness(f.options,f.clock);owned.add(restarted);f.advance(HA_LEASE_MS+HA_FENCE_MARGIN_MS)
  const network:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init!.body));return new Response(JSON.stringify(body.request.purpose==='LEASE'?restarted.request(body):restarted.controlRequest(body)))}
  const old=f.client('a',network),selected=f.client('b',network)
  await expect(old.obtain('ch',randomUUID(),1)).rejects.toThrow();expect(await selected.obtain('ch',randomUUID(),1)).toMatchObject({term:2})
  expect(await selected.transferStatus('ch',request.requestId)).toMatchObject({phase:'TRANSFERRED',assignmentRevision:2})
})
it('engine credential cannot control admission and missing control never enables automatic takeover',async()=>{
  const f=fixture();await f.a.obtain('ch',randomUUID(),1)
  const request={version:1 as const,purpose:'ASSIGNMENT' as const,clusterId:'cluster',channelId:'ch',nodeId:'a',requestTime:Date.now()}
  const wire={request,signature:new SecretVault(Buffer.from(key,'hex')).reviewIdentity(witnessControlCanonical(request),'ha-witness-control-request:v1')}
  expect(()=>f.witness.controlRequest(wire)).toThrow('não autenticado')
  const missing=fixture(':memory:',null);await missing.a.obtain('ch',randomUUID(),1);missing.advance(HA_LEASE_MS+HA_FENCE_MARGIN_MS)
  await expect(missing.b.obtain('ch',randomUUID(),1)).rejects.toThrow();await expect(missing.b.assignment('ch')).rejects.toThrow()
  expect(missing.witness.health()).toMatchObject({nodeAdmissionRequired:true,explicitTransferConfigured:false})
})
it('signed results cannot be replaced by a forged channel/phase or another query',async()=>{
  const f=fixture();await f.a.obtain('ch',randomUUID(),1)
  const forged=f.client('b',async(...args)=>{const response=await f.fetcher(...args),data=await response.json() as any;data.result.selectedNodeId='b';return new Response(JSON.stringify(data))})
  await expect(forged.assignment('ch')).rejects.toThrow('sem confirmação válida')
  expect(await f.a.assignment('ch')).toMatchObject({selectedNodeId:'a',revision:1})
})
it('authenticated durable records and the last transfer pointer are required after restart',async()=>{
  const file=join(mkdtempSync(join(tmpdir(),'RPlayout-witness-tamper-')),'witness.db'),f=fixture(file)
  await f.a.obtain('ch',randomUUID(),1);f.advance(HA_LEASE_MS+HA_FENCE_MARGIN_MS);await f.b.transfer(await command(f.b,'b'));f.witness.close()
  const sql=new Database(file)
  try{expect(()=>sql.exec("DELETE FROM witness_transfers")).toThrow('cannot be deleted');sql.exec("UPDATE witness_assignments SET signature='tampered'")}finally{sql.close()}
  expect(()=>new HaWitness(f.options,f.clock)).toThrow('alterada')
})

import {randomUUID} from 'node:crypto'
import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {readDistributionOwner,validateDistributionOwnership} from '../db/distribution-ownership.js'
import {DistributionOwnership} from './distribution-ownership.js'
import {ExecutionOwnership} from './execution-ownership.js'
import {Checkpoints} from './checkpoints.js'
import {validateBackupRestore} from './backup.js'
let db:ReturnType<typeof openDatabase>,a:DistributionOwnership,b:DistributionOwnership,gone:Set<number>
const identity=(pid=101)=>({host:'fixture-host',pid,boot:randomUUID()})
const state=()=>Object.fromEntries(['distribution_owner_runs','distribution_owner_slot','execution_owner_runs','execution_owner_slots','channel_checkpoints','as_run','operator_decisions'].map(table=>[table,db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
beforeEach(()=>{db=openDatabase(':memory:');gone=new Set();a=new DistributionOwnership(db.db,identity(),pid=>gone.has(pid));b=new DistributionOwnership(db.db,identity(102),pid=>gone.has(pid));db.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','CH',25,1,320,180,-23,-1,5,'now')")})
afterEach(()=>{if(db.sqlite.open)db.sqlite.close();vi.useRealTimers()})
describe('posse global antes de configuração, servidor de mídia e relays',()=>{
  it('consulta é privada/estável e não cria posse; claim/auditoria atômicos e idempotentes',()=>{
    const before=state();expect(a.status()).toMatchObject({state:'UNCLAIMED',blocked:false,promotionReady:false,diagnostic:{code:'UNCLAIMED'}});expect(state()).toEqual(before)
    const id=a.claim();expect(a.claim()).toBe(id);expect(a.status()).toMatchObject({ownedHere:true,blocked:false});const saved=state()
    expect(b.status()).toMatchObject({ownedHere:false,blocked:true,diagnostic:{code:'LOCAL_RESOURCES_PROTECTED'}});expect(state()).toEqual(saved)
    for(const secret of[id,a.identity.boot,'pid','signature','children'])expect(JSON.stringify(b.status())).not.toContain(secret)
    expect(db.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='DISTRIBUTION_OWNER_CLAIMED'").get()).toEqual({n:1})
  })
  it.each(['live','remote','reused-pid','pending-spawn','child-live'])('não rouba por prazo ou PID desconhecido: %s',kind=>{
    a.claim();const token=randomUUID();if(kind==='pending-spawn'||kind==='child-live')a.beforeSpawn('MEDIAMTX',token)
    if(kind==='child-live'){a.spawned('MEDIAMTX',501,token);gone.add(101)}
    if(kind==='remote'){gone.add(101);b=new DistributionOwnership(db.db,{...identity(102),host:'other-host'},()=>true)}
    if(kind==='reused-pid')b=new DistributionOwnership(db.db,identity(),()=>false)
    const before=state();vi.useFakeTimers();vi.setSystemTime(new Date('2099-01-01'));expect(()=>b.claim()).toThrow('Outra instância');expect(state()).toEqual(before)
  })
  it('callbacks errados não liberam reserva ou nova geração do mesmo PID',()=>{
    a.claim();const first=randomUUID(),next=randomUUID();a.beforeSpawn('MEDIAMTX',first);a.spawned('MEDIAMTX',501,first)
    expect(()=>a.exited('RELAY:a',501,first)).toThrow('Callback');expect(()=>a.exited('MEDIAMTX',null,first)).toThrow('Callback')
    expect(a.canSpawn('MEDIAMTX')).toBe(false);a.exited('MEDIAMTX',501,first);a.beforeSpawn('MEDIAMTX',next);a.spawned('MEDIAMTX',501,next)
    expect(()=>a.exited('MEDIAMTX',501,first)).toThrow('Callback');expect(a.canSpawn('MEDIAMTX')).toBe(false)
  })
  it('múltiplos recursos distintos convivem; reserva duplicada ou PID repetido não',()=>{
    a.claim();const media=randomUUID(),relay=randomUUID();a.beforeSpawn('MEDIAMTX',media);a.spawned('MEDIAMTX',501,media);a.beforeSpawn('RELAY:a',relay)
    expect(()=>a.beforeSpawn('RELAY:a',randomUUID())).toThrow('segundo');expect(()=>a.spawned('RELAY:a',501,relay)).toThrow('PID');a.spawned('RELAY:a',502,relay)
    expect(Object.values(a.assertOwned().children).map(row=>row.pid).sort()).toEqual([501,502])
  })
  it('shutdown mantém proteção de child até exit real e impede trabalho enfileirado',()=>{
    const id=a.claim(),token=randomUUID();a.beforeSpawn('MEDIAMTX',token);a.spawned('MEDIAMTX',501,token);a.close()
    expect(()=>a.assertOwned(id)).toThrow('encerrou');expect(()=>a.claim()).toThrow('encerrada');expect(()=>b.claim()).toThrow('Outra instância')
    a.exited('MEDIAMTX',501,token);expect(b.claim()).not.toBe(id);expect(()=>a.exited('MEDIAMTX',501,token)).toThrow('Callback')
  })
  it('crash global exige também a parada dos engines anteriores do canal',()=>{
    a.claim();const native=new ExecutionOwnership(db.db,identity(103),pid=>gone.has(pid)).claim('ch'),token=randomUUID();native.beforeSpawn(token);native.spawned(501,token);gone.add(101);gone.add(103)
    expect(()=>b.claim()).toThrow('Outra instância');gone.add(501);expect(b.claim()).toBeTruthy();expect(readDistributionOwner(db.sqlite)?.sequence).toBe(2)
  })
  it('checkpoint legado ainda em PGM impede escrever distribuição antes do claim de canal',()=>{
    new Checkpoints(db.sqlite).write({version:1,channelId:'ch',rundownId:'rd',revisionId:null,itemId:'vt',elapsed:20,playing:true,realEngine:true})
    const before=state();expect(a.status().blocked).toBe(true);expect(()=>a.claim()).toThrow('Outra instância');expect(state()).toEqual(before)
  })
  it('as-run legado desconhecido e ensaio restaurado não autorizam distribuição',()=>{
    db.sqlite.exec("INSERT INTO as_run(id,channel_id,title,type,started_at,actual_start,execution_kind,created_at) VALUES('legacy','ch','VT','VT','now',0,'UNKNOWN','now')")
    expect(()=>a.claim()).toThrow('Outra instância');db.sqlite.exec('DELETE FROM as_run;CREATE TABLE ha_recovery_origin(id INTEGER)');const before=state()
    expect(()=>a.claim()).toThrow('promovida');expect(state()).toEqual(before)
  })
  it('auditoria falha sem deixar manager, run ou slot parcialmente possuídos',()=>{
    db.sqlite.exec("CREATE TRIGGER dist_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='DISTRIBUTION_OWNER_CLAIMED' BEGIN SELECT RAISE(ABORT,'DIST_AUDIT_FIXTURE'); END");const before=state()
    expect(()=>a.claim()).toThrow('DIST_AUDIT_FIXTURE');expect(state()).toEqual(before);db.sqlite.exec('DROP TRIGGER dist_audit_failure');expect(a.claim()).toBeTruthy()
  })
  it('slot/tombstone e marca não podem ser perdidos ou resetados silenciosamente',()=>{
    a.claim();expect(()=>db.sqlite.exec('DELETE FROM distribution_owner_slot')).toThrow('tombstone');expect(()=>db.sqlite.exec('DELETE FROM distribution_owner_runs')).toThrow('history')
    db.sqlite.exec('DELETE FROM schema_migrations WHERE version=33');expect(()=>validateDistributionOwnership(db.sqlite)).toThrow('marca')
  })
  it('segunda conexão/restart/backup mantêm posse e rejeitam payload adulterado',async()=>{
    db.sqlite.close();const file=join(mkdtempSync(join(tmpdir(),'RPlayout-distribution-owner-')),'fixture.db');db=openDatabase(file);a=new DistributionOwnership(db.db,identity(),()=>false);const id=a.claim(),peer=openDatabase(file)
    try{expect(()=>new DistributionOwnership(peer.db,identity(102),()=>false).claim()).toThrow('Outra instância');expect(readDistributionOwner(peer.sqlite)?.id).toBe(id)}finally{peer.sqlite.close()}
    const backup=file+'.backup';await db.sqlite.backup(backup);expect((await validateBackupRestore(backup)).integrity).toBe('ok')
    db.sqlite.close();db=openDatabase(file);expect(readDistributionOwner(db.sqlite)?.id).toBe(id)
    db.sqlite.exec("UPDATE distribution_owner_runs SET signature='INVALID'");expect(()=>validateDistributionOwnership(db.sqlite)).toThrow('adulterado')
  })
})

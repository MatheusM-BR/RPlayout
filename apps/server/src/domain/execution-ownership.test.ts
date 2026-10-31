import {randomUUID} from 'node:crypto'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {getChannel} from '../db/repo.js'
import {readExecutionOwner,validateExecutionOwnership,executionOwnerSignature,readExecutionRun} from '../db/execution-ownership.js'
import {ExecutionOwnership} from './execution-ownership.js'
import {Checkpoints} from './checkpoints.js'
import {AsRun} from './asrun.js'
import {validateBackupRestore} from './backup.js'
let value:ReturnType<typeof openDatabase>,gone:Set<number>,a:ExecutionOwnership,b:ExecutionOwnership
const identities=()=>({host:'fixture-host',pid:101,boot:randomUUID()})
function seed(){for(const id of ['ch','other'])value.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,25,1,320,180,-23,-1,5,?)').run(id,id,'now')}
beforeEach(()=>{value=openDatabase(':memory:');seed();gone=new Set();a=new ExecutionOwnership(value.db,identities(),pid=>gone.has(pid));b=new ExecutionOwnership(value.db,{...identities(),pid:102},pid=>gone.has(pid))})
afterEach(()=>{if(value.sqlite.open)value.sqlite.close();vi.useRealTimers();vi.restoreAllMocks()})
const state=()=>Object.fromEntries(['execution_owner_runs','execution_owner_slots','execution_owner_asrun','channel_checkpoints','as_run','operator_decisions'].map(table=>[table,value.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const cursor={version:1 as const,channelId:'ch',rundownId:'rd',revisionId:'rev',itemId:'vt',elapsed:750,playing:true,realEngine:true}
describe('posse nativa por vida de processo, sem expiração que roube canal',()=>{
  it.each(['active','released','final-only','sealed-only'] as const)('parada %s não confirma que o cursor salvo é o último quadro no ar',kind=>{
    const previous=a.claim('ch');new Checkpoints(value.sqlite,previous).write(cursor)
    if(kind==='released')previous.release()
    if(kind==='final-only')previous.finalRelease()
    if(kind==='sealed-only')previous.sealObservation()
    gone.add(101);const before=state(),status=b.status('ch')
    expect(status).toMatchObject({blocked:false,ownedHere:false,diagnostic:{code:'LOCAL_STOPPED_CHECKPOINT_UNCERTAIN',repairRequired:true}})
    expect(status.diagnostic.message).toContain('pode estar atrás')
    expect(status.diagnostic.message).toContain('não altera nem impede')
    expect(status.diagnostic.message).toContain('sem exigir confirmação do operador')
    expect(state()).toEqual(before)
    for(const key of ['pid','boot','id','signature','enginePids','elapsed'])expect(status).not.toHaveProperty(key)
  })
  it('fechamento durável completo não gera o aviso de cursor inconclusivo',()=>{
    const previous=a.claim('ch');new Checkpoints(value.sqlite,previous).write(cursor)
    previous.sealObservation();previous.finalRelease();const before=state()
    expect(b.status('ch')).toMatchObject({blocked:false,diagnostic:{code:'LOCAL_RELEASE_VERIFIED',repairRequired:false}})
    expect(state()).toEqual(before)
  })
  it('consulta de cursor não altera a recuperação existente nem transforma PID vivo em parada',()=>{
    const previous=a.claim('ch');new Checkpoints(value.sqlite,previous).write(cursor)
    expect(a.status('ch').diagnostic.code).toBe('OWNED_HERE')
    expect(b.status('ch')).toMatchObject({blocked:true,diagnostic:{code:'LOCAL_EXECUTION_PROTECTED'}})
    gone.add(101);expect(b.status('ch').diagnostic.code).toBe('LOCAL_STOPPED_CHECKPOINT_UNCERTAIN')
    expect(b.claim('ch').canRecoverCursorFrom(previous.identity.id)).toBe(true)
  })
  it('sem cursor nativo ativo não presume risco de repetição',()=>{
    const previous=a.claim('ch');new Checkpoints(value.sqlite,previous).write({...cursor,playing:false})
    gone.add(101);const before=state()
    expect(b.status('ch').diagnostic.code).toBe('LOCAL_RELEASE_VERIFIED');expect(state()).toEqual(before)
  })
  it('retém prova de parada da geração anterior antes de abrir processos que reutilizem PIDs',()=>{
    const original=a.claim('ch'),token=randomUUID();original.beforeSpawn(token);original.spawned(501,token)
    gone.add(101);gone.add(501)
    const current=b.claim('ch'),before=state()
    // Original processes were absent at admission. These numbers can now
    // belong to the NEW engine/helpers, not to the stopped predecessor.
    gone.delete(101);gone.delete(501)
    expect(current.canRecoverCursorFrom(original.identity.id)).toBe(true)
    expect(state()).toEqual(before)
    expect(()=>a.claim('ch')).toThrow('Outra instância')
  })
  it('prova local em memória não vale para registro alterado ou novo dono',()=>{
    const original=a.claim('ch'),token=randomUUID();original.beforeSpawn(token);original.spawned(501,token)
    gone.add(101);gone.add(501)
    const current=b.claim('ch')
    gone.delete(101);gone.delete(501)
    const changed={...readExecutionRun(value.sqlite,original.identity.id),observationClosed:true}
    value.sqlite.prepare('UPDATE execution_owner_runs SET payload=?,signature=? WHERE id=?').run(JSON.stringify(changed),executionOwnerSignature(changed),changed.id)
    expect(current.canRecoverCursorFrom(original.identity.id)).toBe(false)
    current.finalRelease()
    const next=b.claim('ch')
    expect(next.canRecoverCursorFrom(original.identity.id)).toBe(false)
  })
  it('checkpoint can cross only signed stopped unresolved predecessors after rollback',()=>{
    const original=a.claim('ch');original.finalRelease()
    const interrupted=a.claim('ch');interrupted.finalRelease()
    const current=a.claim('ch'),before=state()
    expect(current.canRecoverCursorFrom(original.identity.id)).toBe(true)
    expect(current.canRecoverCursorFrom(interrupted.identity.id)).toBe(true)
    expect(current.canRecoverCursorFrom(randomUUID())).toBe(false)
    expect(state()).toEqual(before)
    value.sqlite.prepare("UPDATE execution_owner_runs SET signature='tampered' WHERE id=?").run(original.identity.id)
    expect(()=>current.canRecoverCursorFrom(original.identity.id)).toThrow('adulterado')
  })
  it('committed intermediate predecessor prevents replay of an older cursor',()=>{
    const original=a.claim('ch');original.finalRelease()
    const committed=a.claim('ch');committed.acknowledgeStoppedPredecessor();committed.finalRelease()
    const current=a.claim('ch')
    expect(current.canRecoverCursorFrom(committed.identity.id)).toBe(true)
    expect(current.canRecoverCursorFrom(original.identity.id)).toBe(false)
    current.acknowledgeStoppedPredecessor()
    expect(current.canRecoverCursorFrom(committed.identity.id)).toBe(false)
  })
  it('as-run reconciles the signed unresolved chain, not only its empty immediate predecessor',async()=>{
    const channel=(await getChannel(value.db,'ch'))!,original=a.claim('ch')
    await new AsRun(value.db,channel,'NATIVE',original).follow('vt',null,'rev',0)
    original.finalRelease();const interrupted=a.claim('ch');interrupted.finalRelease()
    const current=a.claim('ch')
    await new AsRun(value.db,channel,'NATIVE',current).followHeldWithCommit('vt',null,'rev',750,()=>current.acknowledgeStoppedPredecessor())
    const rows=value.sqlite.prepare('SELECT id,ended_by,start_position_frames FROM as_run ORDER BY rowid').all() as Array<{id:string;ended_by:string|null;start_position_frames:number}>
    expect(rows).toHaveLength(2);expect(rows[0]?.ended_by).toBe('RESTART');expect(rows[1]).toMatchObject({ended_by:null,start_position_frames:750})
    expect(current.ownsAsRun(rows[1]!.id)).toBe(true)
    expect(value.sqlite.prepare('SELECT count(*) AS n FROM as_run WHERE ended_at IS NULL').get()).toEqual({n:1})
  })
  it('claim e auditoria são atômicos; consulta privada não altera posse ou revela IDs',()=>{
    const lease=a.claim('ch'),before=state();expect(a.status('ch')).toMatchObject({state:'ACTIVE',ownedHere:true,blocked:false});expect(b.status('ch')).toMatchObject({ownedHere:false,blocked:true})
    expect(a.status('ch')).toEqual(a.status('ch'));expect(a.status('ch').diagnostic.code).toBe('OWNED_HERE');expect(state()).toEqual(before)
    for(const key of ['pid','boot','id','signature','enginePids'])expect(a.status('ch')).not.toHaveProperty(key)
    expect(readExecutionOwner(value.sqlite,'ch')?.id).toBe(lease.identity.id);expect(value.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='EXECUTION_OWNER_CLAIMED'").get()).toEqual({n:1})
  })
  it('servidor vivo impede segundo dono mesmo após anos de relógio',()=>{
    a.claim('ch');const before=state();vi.useFakeTimers();vi.setSystemTime(new Date('2099-01-01'))
    expect(()=>b.claim('ch')).toThrow('Outra instância');expect(state()).toEqual(before)
  })
  it.each(['server-live','engine-live','remote','reused-pid','unknown'])('parada não comprovada bloqueia: %s',reason=>{
    const lease=a.claim('ch'),token=randomUUID();lease.beforeSpawn(token);lease.spawned(501,token)
    if(reason==='server-live')gone.add(501)
    if(reason==='engine-live')gone.add(101)
    if(reason==='remote'){gone.add(101);gone.add(501);b=new ExecutionOwnership(value.db,{host:'foreign-host',pid:102,boot:randomUUID()},()=>true)}
    if(reason==='reused-pid'){gone.add(501);b=new ExecutionOwnership(value.db,{...identities(),pid:101},pid=>gone.has(pid))}
    const before=state();expect(()=>b.claim('ch')).toThrow('Outra instância');expect(state()).toEqual(before)
  })
  it('crash local comprovado de servidor e engine permite nova posse, nunca TAKE',()=>{
    const old=a.claim('ch'),token=randomUUID();old.beforeSpawn(token);old.spawned(501,token);gone.add(101);gone.add(501)
    const next=b.claim('ch');expect(next.identity.recoveredRunId).toBe(old.identity.id);expect(next.identity.sequence).toBe(2);expect(next.assertOwned().enginePids).toEqual([])
    expect(()=>old.assertOwned()).toThrow('posse');expect(value.sqlite.prepare('SELECT version FROM execution_owner_slots').get()).toEqual({version:2})
  })
  it('crash entre reserva e PID não é assumido sem processo',()=>{
    a.claim('ch').beforeSpawn(randomUUID());gone.add(101);const before=state()
    expect(()=>b.claim('ch')).toThrow('Outra instância');expect(state()).toEqual(before)
  })
  it('erro/watchdog sem saída confirmada não abre um segundo child próprio',()=>{
    const lease=a.claim('ch'),token=randomUUID();expect(lease.canSpawn()).toBe(true);lease.beforeSpawn(token);expect(lease.canSpawn()).toBe(false);lease.spawned(501,token)
    const before=state();expect(lease.canSpawn()).toBe(false);expect(()=>lease.beforeSpawn(randomUUID())).toThrow('nenhum segundo');expect(state()).toEqual(before)
    lease.exited(501,token);expect(lease.canSpawn()).toBe(true)
  })
  it('erro de spawn da geração certa libera somente sua reserva',()=>{
    const lease=a.claim('ch'),token=randomUUID();lease.beforeSpawn(token);expect(()=>lease.exited(null,randomUUID())).toThrow('geração')
    expect(lease.assertOwned().spawning).toBe(true);lease.exited(null,token);expect(lease.assertOwned().spawning).toBe(false)
  })
  it('callback antigo/duplicado ou PID errado não libera engine novo',()=>{
    const lease=a.claim('ch'),first=randomUUID(),second=randomUUID();lease.beforeSpawn(first);lease.spawned(501,first)
    expect(()=>lease.exited(502,first)).toThrow('geração');lease.exited(501,first);lease.beforeSpawn(second);lease.spawned(501,second)
    expect(()=>lease.exited(501,first)).toThrow('geração');expect(lease.assertOwned().enginePids).toEqual([501])
    expect(()=>lease.spawned(501,second)).toThrow('confirmados')
  })
  it('liberação explícita não prova a morte do child; callback fechado mantém fence',()=>{
    const lease=a.claim('ch'),token=randomUUID();lease.beforeSpawn(token);lease.spawned(501,token);lease.release();expect(()=>a.claim('ch')).toThrow('Outra instância')
    lease.exited(501,token);const next=a.claim('ch');expect(next.identity.sequence).toBe(2);expect(()=>lease.exited(501,token)).toThrow('dono atual')
  })
  it('outra instância no mesmo PID não adota liberação por boot diferente',()=>{
    a.claim('ch').release();const peer=new ExecutionOwnership(value.db,{...a.identity,boot:randomUUID()},()=>false)
    expect(peer.status('ch').blocked).toBe(true);expect(()=>peer.claim('ch')).toThrow('Outra instância')
  })
  it('shutdown explícito libera somente após child terminar e impede criação pendente',()=>{
    const lease=a.claim('ch'),token=randomUUID();lease.beforeSpawn(token);lease.spawned(501,token);a.close()
    expect(()=>a.claim('other')).toThrow('encerrada');expect(()=>b.claim('ch')).toThrow('Outra instância')
    lease.exited(501,token);expect(b.claim('ch').identity.recoveredRunId).toBe(lease.identity.id)
  })
  it('shutdown antigo não libera nova posse de peer',()=>{
    const first=a.claim('ch');gone.add(101);const next=b.claim('ch');a.close();expect(next.assertOwned().finalRelease).toBe(false);expect(()=>first.assertOwned()).toThrow('posse')
  })
  it('falha auditada reverte primeiro claim e transição do slot',()=>{
    value.sqlite.exec("CREATE TRIGGER owner_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='EXECUTION_OWNER_CLAIMED' BEGIN SELECT RAISE(ABORT,'OWNER_AUDIT_FIXTURE'); END")
    const before=state();expect(()=>a.claim('ch')).toThrow('OWNER_AUDIT_FIXTURE');expect(state()).toEqual(before)
    value.sqlite.exec('DROP TRIGGER owner_audit_failure');a.claim('ch').release();const saved=state()
    value.sqlite.exec("CREATE TRIGGER owner_audit_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind='EXECUTION_OWNER_CLAIMED' BEGIN SELECT RAISE(ABORT,'OWNER_AUDIT_FIXTURE'); END")
    expect(()=>a.claim('ch')).toThrow('OWNER_AUDIT_FIXTURE');expect(state()).toEqual(saved)
  })
  it.each(['checkpoint','native-asrun','unknown-asrun','malformed-checkpoint'])('legado não prova parada: %s',kind=>{
    if(kind==='checkpoint')new Checkpoints(value.sqlite).write(cursor)
    if(kind==='malformed-checkpoint')value.sqlite.prepare('INSERT INTO channel_checkpoints VALUES(?,?,?)').run('ch',JSON.stringify({...cursor,playing:'false',realEngine:'false'}),'now')
    if(kind.endsWith('asrun'))value.sqlite.prepare('INSERT INTO as_run(id,channel_id,title,type,started_at,actual_start,execution_kind,created_at) VALUES(?,?,?,?,?,0,?,?)').run('legacy','ch','Legacy','VT','now',kind==='native-asrun'?'NATIVE':'UNKNOWN','now')
    const before=state();expect(()=>a.claim('ch')).toThrow();expect(state()).toEqual(before)
  })
  it('cursor parado legado não inicia programa nem impede primeira posse',()=>{
    new Checkpoints(value.sqlite).write({...cursor,playing:false});expect(a.claim('ch').identity.recoveredRunId).toBeNull()
  })
  it('checkpoint e log estrangeiros não sobrescrevem/encerram PGM nativo',async()=>{
    const lease=a.claim('ch'),channel=(await getChannel(value.db,'ch'))!,recorder=new AsRun(value.db,channel,'NATIVE',lease)
    await recorder.follow('vt',null,'rev',250);new Checkpoints(value.sqlite,lease).write(cursor);const before=state()
    expect(()=>new Checkpoints(value.sqlite).write({...cursor,playing:false,realEngine:false})).toThrow('protegido')
    await expect(new AsRun(value.db,channel,'SIMULATED').follow(null)).rejects.toThrow('dono nativo');expect(state()).toEqual(before)
    expect(()=>new AsRun(value.db,channel,'NATIVE')).toThrow('dono durável')
  })
  it('registro sem posse nunca reconcilia linhas legadas/estrangeiras por canal',async()=>{
    const channel=(await getChannel(value.db,'ch'))!;value.sqlite.exec("INSERT INTO as_run(id,channel_id,title,type,started_at,actual_start,created_at) VALUES('unknown','ch','Legado','VT','now',0,'now')")
    await new AsRun(value.db,channel,'SIMULATED').follow(null);expect(value.sqlite.prepare("SELECT ended_at,ended_by FROM as_run WHERE id='unknown'").get()).toEqual({ended_at:null,ended_by:null})
  })
  it('reconcilia somente predecessor comprovado; runtime vazio conserva seu cursor',async()=>{
    const channel=(await getChannel(value.db,'ch'))!,old=a.claim('ch'),log=new AsRun(value.db,channel,'NATIVE',old)
    await log.follow('vt',null,'rev',250);new Checkpoints(value.sqlite,old).write(cursor);const previous=new Checkpoints(value.sqlite).read('ch')!
    gone.add(101);const current=b.claim('ch'),record=new AsRun(value.db,channel,'NATIVE',current)
    await record.follow(null);expect(value.sqlite.prepare('SELECT ended_by FROM as_run').get()).toEqual({ended_by:'RESTART'})
    const saved=new Checkpoints(value.sqlite,current);expect(()=>saved.write({...cursor,playing:false,itemId:null})).toThrow('Cursor do predecessor');expect(saved.read('ch')).toEqual(previous)
    current.acknowledgeStoppedPredecessor();saved.write({...cursor,playing:false,itemId:null});expect(saved.read('ch')).toMatchObject({playing:false,ownerRunId:current.identity.id})
  })
  it('novo quadro confirmado substitui cursor anterior sem pedir descarte cego',()=>{
    const old=a.claim('ch');new Checkpoints(value.sqlite,old).write(cursor);gone.add(101);const current=b.claim('ch')
    new Checkpoints(value.sqlite,current).write({...cursor,itemId:'new-vt',elapsed:0});expect(new Checkpoints(value.sqlite).read('ch')).toMatchObject({itemId:'new-vt',ownerRunId:current.identity.id})
  })
  it('lease de outro canal e vínculo adulterado não autorizam log/checkpoint',async()=>{
    const lease=a.claim('ch'),other=(await getChannel(value.db,'other'))!
    expect(()=>new Checkpoints(value.sqlite,lease).write({...cursor,channelId:'other'})).toThrow('dono')
    await expect(new AsRun(value.db,other,'NATIVE',lease).follow('vt')).rejects.toThrow('outro canal')
    const channel=(await getChannel(value.db,'ch'))!,log=new AsRun(value.db,channel,'NATIVE',lease);await log.follow('vt')
    value.sqlite.exec("UPDATE execution_owner_asrun SET signature='PRIVATE_CORRUPTED'");const before=state();await expect(log.finish()).rejects.toThrow('não pertence');expect(state()).toEqual(before);expect(()=>validateExecutionOwnership(value.sqlite)).toThrow('adulterado')
  })
  it('assinatura e tombstone recusam payload modificado/ABA e exclusão da posse',()=>{
    const old=a.claim('ch');old.release();const current=a.claim('ch')
    expect(()=>value.sqlite.exec('DELETE FROM execution_owner_slots')).toThrow('tombstone');expect(()=>value.sqlite.exec('DELETE FROM execution_owner_runs')).toThrow('history')
    value.sqlite.prepare('UPDATE execution_owner_slots SET run_id=?').run(old.identity.id);expect(()=>current.assertOwned()).toThrow('incompatíveis');expect(()=>validateExecutionOwnership(value.sqlite)).toThrow('incompatíveis')
  })
  it('trigger de revisão perdido recusa novo claim e reverte slot, run e auditoria',()=>{
    a.claim('ch').release();value.sqlite.exec('DROP TRIGGER execution_owner_slots_revision');const before=state()
    expect(()=>a.claim('ch')).toThrow('incompatíveis');expect(state()).toEqual(before)
    expect(()=>validateExecutionOwnership(value.sqlite)).toThrow('ausente/adulterada')
  })
  it('marca de migração removida não transforma tabela de posse em legado livre',()=>{
    a.claim('ch');value.sqlite.exec('DELETE FROM schema_migrations WHERE version=32')
    expect(()=>validateExecutionOwnership(value.sqlite)).toThrow('sem marca de migração')
  })
  it('referência órfã do as-run em backup é recusada, não ignorada pelo JOIN',()=>{
    const lease=a.claim('ch');value.sqlite.pragma('foreign_keys = OFF')
    value.sqlite.prepare('INSERT INTO execution_owner_asrun VALUES(?,?,?)').run('nonexistent',lease.identity.id,'PRIVATE_INVALID')
    value.sqlite.pragma('foreign_keys = ON');expect(()=>validateExecutionOwnership(value.sqlite)).toThrow('Referência')
  })
  it('identidade desconhecida de outro processo não autoriza sondar seus PIDs localmente',()=>{
    a=new ExecutionOwnership(value.db,{...identities(),host:'unknown-process:'+randomUUID()},()=>false);a.claim('ch')
    const gone=vi.fn(()=>true),peer=new ExecutionOwnership(value.db,{...identities(),host:'unknown-process:'+randomUUID()},gone)
    expect(peer.status('ch')).toMatchObject({ownerLocal:false,blocked:true});expect(()=>peer.claim('ch')).toThrow('Outra instância');expect(gone).not.toHaveBeenCalled()
  })
  it('segunda conexão, restart e backup preservam dono sem assumir morte',async()=>{
    value.sqlite.close();const directory=mkdtempSync(join(tmpdir(),'RPlayout-execution-owner-')),file=join(directory,'qa.db');value=openDatabase(file);seed();a=new ExecutionOwnership(value.db,identities(),()=>false)
    const lease=a.claim('ch'),peer=openDatabase(file)
    try{expect(readExecutionOwner(peer.sqlite,'ch')?.id).toBe(lease.identity.id);expect(()=>new ExecutionOwnership(peer.db,{...identities(),pid:102},()=>false).claim('ch')).toThrow('Outra instância')}finally{peer.sqlite.close()}
    const backup=join(directory,'backup.db');await value.sqlite.backup(backup);expect((await validateBackupRestore(backup)).integrity).toBe('ok')
    value.sqlite.close();value=openDatabase(file);expect(readExecutionOwner(value.sqlite,'ch')?.id).toBe(lease.identity.id)
    value.sqlite.exec("UPDATE execution_owner_runs SET signature='PRIVATE_CORRUPTED'");await expect(validateBackupRestore(file)).rejects.toThrow('adulterado');expect(()=>new ExecutionOwnership(value.db).status('ch')).toThrow('adulterado')
  })
})

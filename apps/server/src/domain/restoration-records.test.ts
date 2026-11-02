import Database from 'better-sqlite3'
import {afterEach,expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm,writeFile,link} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from '../db/client.js'
import {appendRestorationRecord,assertCurrentRestorationReport,migrateRestorationRecords,readRestorationRecords} from '../db/restoration-records.js'
import {installationVault} from './secret-vault.js'
import {backupDatabase} from './backup.js'
import {verifyRestorationManifest} from './restoration-manifest.js'
const connections:Database.Database[]=[],dirs:string[]=[]
afterEach(async()=>{for(const db of connections.splice(0))if(db.open)db.close();for(const path of dirs.splice(0))await rm(path,{recursive:true,force:true})})
function setup(){const sqlite=openDatabase(':memory:').sqlite;connections.push(sqlite);return sqlite}
function receipt(){const stamp=new Date().toISOString(),fingerprint=installationVault(false).fingerprint;return {version:1,requestId:randomUUID(),phase:'QUARANTINED',restoredAt:stamp,backupSha256:'a'.repeat(64),vaultMode:'ORIGINAL_FILE',vaultFingerprint:fingerprint,validation:{integrity:'ok',foreignKeys:'ok',tables:{channels:1},restoredAt:stamp,protectedSecrets:'verified',vaultFingerprint:fingerprint,operationalState:{savedCheckpoints:1,savedPlayingCheckpoints:1,publishedRevisions:2,activeRevisions:1,asRunRecords:2,openAsRunRecords:1,executionResumeAllowed:false}},automaticTake:false,promotionReady:false,mediaCopied:false,originalReferencesPreserved:true}}
it('recibo imutável é preservado; só relatório da restauração mais recente corresponde',()=>{
  const db=setup(),first=receipt(),second=receipt();appendRestorationRecord(db,first);appendRestorationRecord(db,second)
  expect(readRestorationRecords(db)).toEqual([first,second]);expect(()=>assertCurrentRestorationReport(db,first)).toThrow('atual');expect(assertCurrentRestorationReport(db,second)).toEqual(second)
  expect(()=>db.exec("UPDATE restoration_records SET signature='forged'")).toThrow('immutable');expect(()=>db.exec('DELETE FROM restoration_records')).toThrow('deleted')
  expect(()=>appendRestorationRecord(db,second)).toThrow();migrateRestorationRecords(db);expect(readRestorationRecords(db)).toEqual([first,second])
})
it('manifesto de outra restauração com mesma chave/backup não corresponde ao banco',()=>{
  const a=setup(),b=setup(),first=receipt(),second=receipt();appendRestorationRecord(a,first);appendRestorationRecord(b,second)
  expect(()=>assertCurrentRestorationReport(b,first)).toThrow('atual');expect(()=>assertCurrentRestorationReport(a,second)).toThrow('atual')
})
it.each(['promotionReady','automaticTake','mediaCopied'] as const)('recibo não autoriza %s',field=>{expect(()=>appendRestorationRecord(setup(),{...receipt(),[field]:true})).toThrow()})
it('assinatura adulterada e proteção perdida recusam leitura/backup, sem reparar histórico',async()=>{
  const db=setup();appendRestorationRecord(db,receipt());db.exec("DROP TRIGGER restoration_records_update; UPDATE restoration_records SET signature='forged'")
  expect(()=>readRestorationRecords(db)).toThrow('Proteção')
  db.exec("CREATE TRIGGER restoration_records_update BEFORE UPDATE ON restoration_records BEGIN SELECT RAISE(ABORT,'Restoration history is immutable'); END")
  expect(()=>readRestorationRecords(db)).toThrow('inválido')
  const path=await mkdtemp(join(tmpdir(),'RPlayout-receipt-backup-'));dirs.push(path)
  await expect(backupDatabase(db,path)).rejects.toThrow('inválido')
})
it('tabela sem migração e migração sem tabela não são legado válido',()=>{
  const db=setup();db.exec('DELETE FROM schema_migrations WHERE version=43');expect(()=>readRestorationRecords(db)).toThrow('migração')
  db.exec('DROP TABLE restoration_records');expect(readRestorationRecords(db)).toEqual([])
  db.prepare('INSERT INTO schema_migrations VALUES(43,?,?)').run('broken',new Date().toISOString());expect(()=>readRestorationRecords(db)).toThrow('ausente')
})
it('validação de backup conserva recibos assinados e não cria autoridade de promoção',async()=>{
  const db=setup(),report=receipt();appendRestorationRecord(db,report)
  const path=await mkdtemp(join(tmpdir(),'RPlayout-restoration-backup-'));dirs.push(path)
  const saved=await backupDatabase(db,path);expect(saved.validation.tables.restoration_records).toBe(1)
  const copy=new Database(saved.file,{readonly:true});connections.push(copy);expect(assertCurrentRestorationReport(copy,report)).toEqual(report)
})
it('manifesto protegido deve corresponder ao recibo atual e JSON público; consulta não altera o banco',async()=>{
  const db=setup(),report=receipt();appendRestorationRecord(db,report)
  const path=await mkdtemp(join(tmpdir(),'RPlayout-manifest-test-'));dirs.push(path)
  const file=join(path,'restore-quarantine.json'),protectedProvenance=installationVault(false).encrypt(JSON.stringify(report),'backup-restore:v1:report')
  const before=db.prepare('SELECT * FROM restoration_records').all()
  await writeFile(file,JSON.stringify({report,protectedProvenance}))
  expect(await verifyRestorationManifest(db,file)).toEqual(report);expect(db.prepare('SELECT * FROM restoration_records').all()).toEqual(before)
  await writeFile(file,JSON.stringify({report:{...report,backupSha256:'b'.repeat(64)},protectedProvenance}))
  await expect(verifyRestorationManifest(db,file)).rejects.toThrow('público')
  await writeFile(file,JSON.stringify({report,protectedProvenance}));appendRestorationRecord(db,receipt())
  await expect(verifyRestorationManifest(db,file)).rejects.toThrow('atual')
})
it('manifesto com envelope de outro contexto e arquivo hardlinked são recusados',async()=>{
  const db=setup(),report=receipt();appendRestorationRecord(db,report)
  const path=await mkdtemp(join(tmpdir(),'RPlayout-manifest-invalid-'));dirs.push(path)
  const file=join(path,'manifest.json')
  await writeFile(file,JSON.stringify({report,protectedProvenance:installationVault(false).encrypt(JSON.stringify(report),'wrong-context')}))
  await expect(verifyRestorationManifest(db,file)).rejects.toThrow()
  await link(file,join(path,'linked.json'));await expect(verifyRestorationManifest(db,file)).rejects.toThrow('sem links')
})

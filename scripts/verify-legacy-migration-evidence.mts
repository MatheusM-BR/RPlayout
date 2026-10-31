import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'

assert.equal(process.argv.length,3)
const directory=resolve(process.argv[2]!),report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'PASS');assert.equal(report.legacyJobStopped,true)
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(hash(await readFile(join(report.legacy,'apps/server/dist/server.cjs'))),report.legacyHash)
assert.equal(hash(await readFile(join(directory,'legacy-backup.db'))),report.backupHash)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'restored/vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {verifyRestorationManifest}=await import('../apps/server/src/domain/restoration-manifest.js')
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js')
const {readStorageAdmission}=await import('../apps/server/src/db/storage-admission.js')
const SQLite=createRequire(join(report.current,'apps/server/dist/server.cjs'))('better-sqlite3')
const backup=new SQLite(join(directory,'legacy-backup.db'),{readonly:true,fileMustExist:true}),source=new SQLite(join(directory,'source/service.db'),{readonly:true,fileMustExist:true}),target=new SQLite(join(directory,'restored/service.db'),{readonly:true,fileMustExist:true})
let requestId='',oldCount=0,newCount=0,sourceTablesCompared=0
try{
  const old=backup.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all(),now=target.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all()
  assert.equal(old.at(-1).version,45);assert.equal(now.at(-1).version,50)
  assert.deepEqual(source.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all(),old)
  assert.deepEqual(now.slice(0,old.length),old);oldCount=old.length;newCount=now.length
  const sourceTables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  assert.deepEqual(backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(),sourceTables)
  for(const {name}of sourceTables){const quoted='"'+name.replaceAll('"','""')+'"';assert.deepEqual(source.prepare('SELECT * FROM '+quoted+' ORDER BY rowid').all(),backup.prepare('SELECT * FROM '+quoted+' ORDER BY rowid').all());sourceTablesCompared++}
  assert.equal(hash(await readFile(join(directory,'source/vault.json'))),hash(await readFile(join(directory,'restored/vault.json'))))
  const receipt=await verifyRestorationManifest(target,join(directory,'restored/restore-quarantine.json'));requestId=receipt.requestId
  assert.equal(receipt.backupSha256,report.backupHash)
  for(const table of ['channels','rundowns'])assert.deepEqual(target.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),backup.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())
  assert.equal(target.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(target.pragma('foreign_key_check'),[])
  const journal=target.prepare("SELECT kind,payload FROM operator_decisions WHERE kind LIKE 'RESTORED_SCHEMA_MIGRATION_%' ORDER BY rowid").all().map((row:any)=>({kind:row.kind,value:JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))}))
  assert.deepEqual(journal.map((row:any)=>row.kind),['RESTORED_SCHEMA_MIGRATION_STARTED','RESTORED_SCHEMA_MIGRATION_CONFIRMED'])
  assert.equal(journal[0].value.id,journal[1].value.id)
  for(const row of journal){assert.equal(row.value.restorationId,requestId);assert.equal(row.value.automaticTake,false);assert.equal(row.value.promotionReady,false)}
  assert.equal(journal[0].value.facts.before.applied,45);assert.equal(journal[1].value.facts.after.applied,50)
  assert.ok(target.prepare("SELECT 1 FROM sqlite_master WHERE name='ha_recovery_origin'").get())
  assert.equal(readStorageAdmission(target)!.phase,'OPEN')
  assert.equal(target.prepare('SELECT COUNT(*) AS n FROM restored_activation_runs').get().n,0)
  assert.equal(target.prepare('SELECT COUNT(*) AS n FROM backup_upgrade_requests').get().n,0)
}finally{source.close();backup.close();target.close()}
const result={result:'PASS',requestId,oldMigrations:oldCount,newMigrations:newCount,sourceTablesCompared,sourceSchemaAndDataMatchBackup:true,originalBackupHashPreserved:true,vaultBytesPreserved:true,fixtureChannelsAndRundownsPreserved:true,authenticatedMigrationJournal:true,maintenanceReleased:true,quarantinePreserved:true,activationPerformed:false,scope:'Historical binary45 to current50, fixture editorial rows only; no legacy PGM/media/jobs or power-loss qualification'}
await writeFile(join(directory,'assertions-legacy-migration.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))

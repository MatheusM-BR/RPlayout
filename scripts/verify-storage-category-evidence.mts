import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'

// Existing database and encrypted audit only. Never recreate app instances,
// inject requests, change grants/sessions, repair revisions or replay a write.
assert.equal(process.argv.length,3)
const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(process.argv[2]!)
assert.ok(directory.startsWith(join(root,'scratch','storage-category-routes-')))
const report=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(report.result,'PASS');assert.equal(report.directory,directory);assert.equal(report.ownedServicesStopped,true);assert.deepEqual(report.cleanupErrors,[])
for(const key of ['httpTransportValidated','installedBackendValidated','independentBackendProcessesValidated','pgmAndAsRunValidated'])assert.equal(report[key],false)
assert.ok(report.binaries.startsWith(join(root,'scratch','host-history-r88-')))
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
for(const name of ['storage-bridge.cjs','storage-service.cjs'])assert.equal(hash(await readFile(join(report.binaries,name))),report.hashes[name])
assert.equal(report.ownedServicePids.length,3);assert.equal(new Set(report.ownedServicePids).size,3)
for(const pid of report.ownedServicePids){
  assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=0xffffffff);assert.notEqual(pid,process.pid)
  let absent=false;try{process.kill(pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')absent=true;else throw error}
  assert.ok(absent,'Historical own PID exists/was reused; never terminate it')
}
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY;delete process.env.VITEST
const {installationVault}=await import('../apps/server/src/domain/secret-vault.js'),{readServerInstances}=await import('../apps/server/src/db/server-instances.js')
const SQLite=createRequire(new URL('../apps/server/package.json',import.meta.url))('better-sqlite3'),file=join(directory,'Categorias-ação.db'),before=hash(await readFile(file)),db=new SQLite(file,{readonly:true,fileMustExist:true})
let audit:any[],mutationStatuses:string[],instances:any[]
try{
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[])
  const all=db.prepare('SELECT kind,payload,actor_username FROM operator_decisions ORDER BY rowid').all().map((row:any)=>({...row,payload:JSON.parse(installationVault(false).decrypt(row.payload,'operator_decisions.payload'))}))
  audit=all.filter((row:any)=>['CATEGORY_COLOR_CHANGED','CATEGORY_REMOVED'].includes(row.kind))
  assert.deepEqual(audit,report.removal.audit);assert.deepEqual(audit.map(row=>row.kind),['CATEGORY_COLOR_CHANGED','CATEGORY_REMOVED'])
  assert.equal(audit[0].actor_username,'QA-'+report.cas.winner.toUpperCase());assert.equal(audit[1].actor_username,'QA-B')
  for(const row of audit){assert.equal(row.payload.categoryId,'AÇÃO São José Çãó');assert.equal(row.payload.automaticTake,false)}
  assert.equal(audit[0].payload.before.revision,report.cas.originalReview.revision)
  assert.equal(audit[0].payload.after.revision,audit[1].payload.before.revision)
  assert.deepEqual(db.prepare('SELECT * FROM categories').all(),[])
  assert.equal(db.prepare('SELECT version FROM category_revision WHERE singleton=1').get().version,report.removal.removed.revision)
  assert.equal(db.prepare("SELECT category_id FROM media_assets WHERE id='asset'").get().category_id,null)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='a'").get().n,0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id='b'").get().n,1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_access').get().n,0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name='qa_category_audit_failure'").get().n,0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM as_run').get().n,0)
  mutationStatuses=all.filter((row:any)=>row.kind==='API_MUTATION'&&row.payload.route==='/api/categories/:id').map((row:any)=>row.payload.method+':'+row.payload.status).sort()
  assert.deepEqual(mutationStatuses,['PUT:428','PUT:200','PUT:409','PUT:403','PUT:401','DELETE:409','DELETE:200'].sort())
  instances=readServerInstances(db);assert.equal(instances.length,3);assert.ok(instances.every(row=>row.phase==='STORAGE_CLOSED'));assert.equal(new Set(instances.map(row=>row.pid)).size,1)
}finally{db.close()}
assert.equal(hash(await readFile(file)),before)
assert.ok(resolve(report.removal.catalogFile).startsWith(directory+'\\'))
assert.equal(hash(await readFile(report.removal.catalogFile)),report.removal.catalogHash);assert.equal(report.removal.catalogIsPlayableVideo,false)
assert.deepEqual(report.cas.statuses.slice().sort(),[200,409]);assert.equal(report.reconstructed.backendRestartValidated,false)
const result={result:'PASS',directory,scope:'Independent readonly database/schema/audit decryption, signed storage-close records and exit observations; not independent reconstruction of route scheduling, HTTP traffic or login',categoryDomainAuditRecords:audit!.length,apiMutationStatuses:mutationStatuses!,signedStorageClosedInstances:instances!.length,singleParentBackend:true,removedRevision:report.removal.removed.revision,originalCatalogFixturePreserved:true,sessionARevocationPersisted:true,mainDatabaseBytesUnchanged:true,ownStorageServicesStillAbsent:true,httpTransportValidated:false,installedBackendValidated:false,independentBackendProcessesValidated:false,pgmAndAsRunValidated:false}
await writeFile(join(directory,'assertions-storage-category.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({result:'PASS',directory,categoryDomainAuditRecords:result.categoryDomainAuditRecords,signedStorageClosedInstances:result.signedStorageClosedInstances}))

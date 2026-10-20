import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile,realpath,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'

// Read-only receipt of the own stopped UI fixture, not a new browser test.
const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(process.argv[2]??'')
const confirmationMode=process.argv.includes('--confirmation')
// Elevated fixture creation and sandboxed readback can use different TEMP.
// Admit only those explicit local temp roots, never an arbitrary directory.
const allowedTempRoots=[resolve(tmpdir()),resolve('C:/Users/fsda/AppData/Local/Temp')]
assert.ok(allowedTempRoots.some(temp=>directory.startsWith(temp+'\\RPlayout-settings-browser-')))
const fixture=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(fixture.directory,directory);assert.equal(fixture.serverExitObserved,true)
const Db=createRequire(await realpath(join(root,'apps/server/node_modules/better-sqlite3/package.json')))('better-sqlite3')
const db=new Db(join(directory,'service.db'),{readonly:true,fileMustExist:true})
try{
  const count=(table:string)=>db.prepare(`SELECT count(*) n FROM ${table}`).get().n as number
  const audits=db.prepare('SELECT kind,count(*) count FROM operator_decisions GROUP BY kind ORDER BY kind').all() as Array<{kind:string;count:number}>
  const roots=db.prepare('SELECT path FROM media_roots ORDER BY path').all().map((row:{path:string})=>row.path)
  assert.deepEqual(roots,[join(directory,'Acervo São José Çãó'),join(directory,'Inicial')].sort())
  assert.deepEqual(db.prepare('SELECT id,color FROM categories').all(),[{id:'Jornal São José Çãó',color:'#5b8fd6'}])
  assert.equal(audits.find(row=>row.kind==='MEDIA_ROOT_ADDED')?.count,1)
  assert.equal(audits.find(row=>row.kind==='CATEGORY_COLOR_CHANGED')?.count,confirmationMode?3:1)
  assert.equal(audits.find(row=>row.kind==='MEDIA_ROOT_REMOVED'),undefined)
  assert.equal(count('integrations'),0);assert.equal(count('integration_deliveries'),0)
  assert.equal(audits.find(row=>row.kind==='MEDIA_SCAN_QUEUED'),undefined)
  assert.equal(count('as_run'),0);assert.equal(count('live_sources'),0);assert.equal(count('users'),1)
  assert.equal(audits.filter(row=>['USER_CREATED','USER_UPDATED_SESSIONS_REVOKED','USER_ACCESS_CHANGED_SESSIONS_REVOKED','SESSIONS_REVOKED'].includes(row.kind)).length,0)
  await realpath(join(directory,'Acervo São José Çãó','Região Óptica'))
  const result={result:'PASS',directory,scope:confirmationMode?'Read-only receipt after UI consent/stale/reopen and two same-value synthetic peer commits; no removal, webhook, scanner/native video or account edits':'Read-only persisted receipt of stopped settings UI fixture; no concurrent peer, scanner/native video or account edits',rootsRegistered:2,unicodeRootAddedOnce:true,categoryCreatedOnceWithSavedColor:{id:'Jornal São José Çãó',color:'#5b8fd6'},auditCounts:audits,scanQueued:0,asRun:0,liveSources:0,accountMutations:0,integrations:0,deliveries:0,rootRemovals:0,folderStillExists:true,concurrentPeer:confirmationMode?'TWO_SAME_VALUE_COMMITS_OBSERVED':'NOT_RUN_APPROVAL_REVIEW_UNAVAILABLE',serverExitPreviouslyObserved:true}
  await writeFile(join(root,'scratch',confirmationMode?'editorial-confirmation-20261014':'group06-settings-visual-20261014','persisted.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
}finally{db.close()}

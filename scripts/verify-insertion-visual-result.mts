import assert from 'node:assert/strict'
import {resolve,join} from 'node:path'
import {readFile,writeFile} from 'node:fs/promises'
import Database from '../apps/server/node_modules/better-sqlite3/lib/index.js'
import {drizzle} from '../apps/server/node_modules/drizzle-orm/better-sqlite3/index.js'

assert.ok(process.argv[2],'Informe explicitamente a fixture própria')
const directory=resolve(process.argv[2]!),result=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(result.directory,directory);assert.equal(result.browserInsertion,true)
assert.equal(result.result,'VISUAL_FIXTURE_COMPLETED');assert.equal(result.ownedCleanupConfirmed,true)
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {operationalPlaylistRevisions,operatorDecisions}=await import('../apps/server/src/db/schema.js')
const sqlite=new Database(join(directory,'priority.db'),{readonly:true,fileMustExist:true}),db=drizzle(sqlite)
try{
  const revisions=db.select().from(operationalPlaylistRevisions).all().sort((a,b)=>a.revision-b.revision)
  assert.equal(revisions.length,3)
  const commands=db.select().from(operatorDecisions).all().filter(row=>row.kind==='OPERATIONAL_INSERT_COMMAND')
  const commits=db.select().from(operatorDecisions).all().filter(row=>row.kind==='OPERATIONAL_INSERT_COMMITTED')
  assert.equal(commands.length,2);assert.equal(commits.length,2)
  const next=commands.find(row=>row.payload.mode==='NEXT')!.payload,now=commands.find(row=>row.payload.mode==='NOW')!.payload
  for(const run of [next,now]){assert.equal(run.phase,'CONFIRMED');assert.equal(run.actor,'compensation-verifier');assert.equal(run.physicalOutputValidated,false)}
  assert.equal(next.nativeProgramConfirmed,false);assert.equal(now.nativeProgramConfirmed,true)
  assert.equal(next.sourceRevisionId,revisions[0]!.id);assert.equal(next.revisionId,revisions[1]!.id)
  assert.equal(now.sourceRevisionId,revisions[1]!.id);assert.equal(now.revisionId,revisions[2]!.id)
  for(const [index,run]of [next,now].entries()){
    const payload=revisions[index+1]!.payload as any
    assert.equal(payload.operation.kind,'INSERT');assert.equal(payload.operation.requestId,run.requestId)
    assert.equal(payload.items[1].id,run.itemId)
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM rundown_items').get()!.n,8)
  assert.equal((revisions[0]!.payload as any).items.length,8)
  assert.equal((revisions[2]!.payload as any).items.length,10)
  assert.equal(sqlite.prepare('SELECT count(*) n FROM as_run WHERE item_id=?').get(next.itemId)!.n,0)
  const nativeNow=sqlite.prepare('SELECT item_id,revision_id,execution_kind,media_hash,start_position_frames,end_position_frames,ended_by FROM as_run WHERE item_id=?').get(now.itemId) as any
  assert.ok(nativeNow);assert.equal(nativeNow.execution_kind,'NATIVE');assert.equal(nativeNow.revision_id,now.revisionId)
  assert.match(nativeNow.media_hash,/^[a-f0-9]{64}$/i);assert.equal(nativeNow.start_position_frames,0)
  const proof={result:'PASS',directory,revisionCount:3,commands:2,commits:2,next:{requestId:next.requestId,itemId:next.itemId,nativeProgramConfirmed:false,noAsRun:true},now:{requestId:now.requestId,itemId:now.itemId,nativeProgramConfirmed:true,asRun:nativeNow},editorialPreserved:true,scope:'Readonly SQL/native receipts after separately recorded browser interaction; no physical signal qualification.'}
  await writeFile(join(directory,'visual-insertion-persisted.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof))
}finally{sqlite.close()}

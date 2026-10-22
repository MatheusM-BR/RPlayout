import assert from 'node:assert/strict'
import {join,resolve} from 'node:path'
import {writeFile} from 'node:fs/promises'
import Database from '../apps/server/node_modules/better-sqlite3/lib/index.js'
import {drizzle} from '../apps/server/node_modules/drizzle-orm/better-sqlite3/index.js'
const directory=resolve(process.argv[2]??'');assert.ok(process.argv[2],'Provide own visual fixture')
process.env.RPLAYOUT_VAULT_FILE=join(directory,'vault.json');delete process.env.RPLAYOUT_VAULT_KEY
const {operationalPlaylistRevisions}=await import('../apps/server/src/db/schema.js')
const {readOperationalPayload}=await import('../apps/server/src/domain/operational-playlist.js')
const sqlite=new Database(join(directory,'priority.db'),{readonly:true,fileMustExist:true}),db=drizzle(sqlite)
try{
 const revisions=db.select().from(operationalPlaylistRevisions).all().sort((a,b)=>a.revision-b.revision)
 assert.equal(revisions.length,4)
 const original=readOperationalPayload(revisions[0]!.payload),final=readOperationalPayload(revisions.at(-1)!.payload)
 const item=(payload:typeof final,id:string)=>payload.items.find(row=>row.id===id)!
 assert.equal(item(original,'trim-vt').durationOverride,125);assert.equal(item(final,'trim-vt').durationOverride,100)
 assert.ok(item(original,'optional'));assert.equal(final.items.some(row=>row.id==='optional'),false)
 const originalSoft=item(original,'soft').anchor,finalSoft=item(final,'soft').anchor
 assert.equal(originalSoft.kind,'SOFT');assert.equal(finalSoft.kind,'SOFT')
 assert.ok('at' in originalSoft&&'at' in finalSoft);assert.equal(finalSoft.at-originalSoft.at,3000)
 assert.deepEqual(item(final,'mandatory').anchor,item(original,'mandatory').anchor)
 const {order:originalOrder,...originalProtected}=item(original,'protected')
 const {order:finalOrder,...finalProtected}=item(final,'protected')
 assert.equal(finalOrder,originalOrder-1,'Removing preceding optional renumbers, but cannot alter protected content/anchor')
 assert.deepEqual(finalProtected,originalProtected)
 assert.equal(sqlite.prepare('SELECT count(*) n FROM operator_decisions WHERE kind=?').get('OPERATIONAL_COMPENSATION')!.n,3)
 assert.equal(sqlite.prepare('SELECT duration_override frames FROM rundown_items WHERE id=?').get('trim-vt')!.frames,125)
 assert.equal(sqlite.prepare('SELECT count(*) n FROM rundown_items WHERE id=?').get('optional')!.n,1)
 const result={result:'PASS',directory,revisionCount:4,compensationCount:3,trimFrames:[125,100],optionalRemovedFromPublishedOnly:true,softDelayFrames:3000,fixedAnchorPreserved:true,protectedItemPreserved:true,editorialPreserved:true,physicalValidated:false}
 await writeFile(join(directory,'visual-actions-persisted.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{sqlite.close()}

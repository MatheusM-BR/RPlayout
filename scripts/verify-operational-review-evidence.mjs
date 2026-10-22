import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'

const directory=resolve(process.argv[2]??'')
assert.ok(process.argv[2],'Informe explicitamente a pasta da fixture, nunca o banco operacional.')
const result=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(result.result,'FIXTURE_COMPLETED');assert.equal(result.error,null)
assert.equal(result.engineDisabled,true);assert.equal(result.serverExitObserved,true)
assert.equal(result.seedRevisionsUnchanged,true);assert.equal(result.asRun.count,0)
assert.deepEqual(result.revisions.map(row=>row.revision),[1,2,3,4])
const active=result.revisions.filter(row=>row.active);assert.equal(active.length,1)
assert.equal(active[0].revision,4);assert.equal(active[0].payload.restoredFrom.revision,1)
assert.equal(active[0].payload.items[0].title,'Estúdio publicado A')
assert.deepEqual(result.editorial,[{id:'live',title:'Estúdio editorial C'}])
const actions=result.audit.filter(row=>row.actor_username==='publication-verifier')
assert.deepEqual(actions.map(row=>row.kind),['OPERATIONAL_PLAYLIST_PUBLISHED','OPERATIONAL_PLAYLIST_ROLLBACK'])
const writes=result.events.filter(event=>event.method==='POST'&&event.path.includes('/operational-'))
assert.deepEqual(writes.map(event=>[event.path,event.status]),[['/api/rundowns/rd/operational-publish',201],['/api/rundowns/rd/operational-rollback',200]])
const timeouts=[]
for(const event of result.events.filter(event=>event.event==='DELAY_STARTED')){
  const ended=result.events.find(other=>other.path===event.path&&other.event==='CLIENT_CLOSED'&&other.at>event.at)
  assert.ok(ended,'Cada consulta injetada precisa ter conexão encerrada')
  const milliseconds=Date.parse(ended.at)-Date.parse(event.at)
  assert.ok(milliseconds>=9000&&milliseconds<=12000,`${event.path}: ${milliseconds}ms`)
  timeouts.push({path:event.path,milliseconds})
}
assert.equal(timeouts.length,4)
console.log(JSON.stringify({result:'PASS',scope:'Own SQL receipts and readonly gateway cancellation; screenshots/manual UI proof are separate. No native or remote qualification.',directory,seedRevisionsUnchanged:true,onePublication:true,oneRollback:true,activeRevision:4,editorialPreserved:true,asRun:0,timeouts},null,2))

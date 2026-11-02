import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'

// Read-only after-the-fact verification of an isolated native/browser fixture.
// Browser observations are manually recorded visible DOM, not automation replay.
const directory=resolve(process.argv[2]??'')
const read=async name=>JSON.parse(await readFile(join(directory,name),'utf8'))
const result=await read('result.json'),browser=await read('browser-observations.json')
assert.equal(result.result,'FIXTURE_FINISHED');assert.equal(result.error,null)
assert.equal(result.expired,false);assert.equal(result.serviceEngineDisabled,true)
assert.equal(result.serviceExitObserved,true);assert.equal(result.physicalSignalValidated,false)
assert.equal(result.senders.length,4)
for(const sender of result.senders){
  assert.equal(sender.ready,true);assert.equal(sender.exitObserved,true)
  assert.equal(sender.exitCode,0);assert.equal(sender.forcedStop,false)
  assert.deepEqual(sender.errors,[])
  const sources=result.discovery[sender.kind.toLowerCase()].sources
  const fold=value=>sender.kind==='OMT'?value.toLowerCase():value
  assert.ok(sources.some(source=>fold(source.reference).includes(fold(sender.name))&&fold(source.label).includes(fold(sender.name))))
}
for(const key of ['ndiA','ndiB','omtA','omtB']){
  const kind=key.slice(0,3),label=browser[key]
  assert.ok(result.discovery[kind].sources.some(source=>source.label===label&&source.reference===`${kind}:${label}`))
}
const observation=step=>{const rows=browser.observations.filter(row=>row.step===step);assert.equal(rows.length,1,step);return rows[0]}
for(const [step,key] of [
  ['NDI default','ndiA'],['NDI B selected','ndiB'],['NDI reset to discovered A','ndiA'],
  ['NDI after discovery refresh','ndiA'],['OMT default exact native label','omtA'],
  ['OMT B selected','omtB'],['OMT reset exact discovered A','omtA'],
  ['Master NDI B default','ndiB'],['Master OMT A default restored','omtA'],
])assert.equal(observation(step).name,browser[key],step)
assert.equal(observation('NDI default').nameBelowSelection,true)
assert.equal(observation('OMT default exact native label').nameBelowSelection,true)
for(const step of ['NDI manual alias preserved on A','Saved alias reopened','Saved alias preserved on changed draft selection'])assert.equal(observation(step).name,'Estúdio QA ÇÃÓ NDI',step)
assert.equal(observation('OMT manual alias preserved on A').name,'Estúdio QA ÇÃÓ OMT')
assert.equal(observation('Master alias preserved across protocol').name,'Apelido QA Master ÇÃÓ')
assert.deepEqual(observation('OMT saved exact native label').rows,observation('Reload persisted names').rows)
assert.equal(observation('NDI saved').rows.length,1)
assert.equal(observation('Reload persisted names').rows.length,2)
assert.equal(result.liveSources.length,3)
const expected=[
  {name:'Estúdio QA ÇÃÓ NDI',kind:'NDI',targetUrl:`ndi:${browser.ndiA}`},
  {name:browser.omtA,kind:'OMT',targetUrl:`omt:${browser.omtA}`},
  {name:browser.omtB,kind:'OMT',targetUrl:`omt:${browser.omtB}`},
]
for(const row of expected)assert.equal(result.liveSources.filter(source=>source.channelId==='qa'&&Object.entries(row).every(([key,value])=>source[key]===value)).length,1)
assert.deepEqual(observation('Master saved to MAM').names.toSorted(),expected.map(row=>row.name).toSorted())
assert.equal(result.items.length,0);assert.equal(result.asRun.count,0)
const counts=Object.fromEntries(['SESSION_CREATED','LIVE_SOURCE_EDITED','API_MUTATION'].map(kind=>[kind,result.audits.filter(row=>row.kind===kind).length]))
assert.deepEqual(counts,{SESSION_CREATED:1,LIVE_SOURCE_EDITED:4,API_MUTATION:4})
assert.equal(result.audits.length,9);assert.ok(result.audits.every(row=>row.actor==='names-verifier'))
assert.equal(browser.tabClosed,true)
const evidenceHashes={}
for(const file of ['result.json','browser-observations.json',...browser.screenshots])evidenceHashes[file]=createHash('sha256').update(await readFile(join(directory,file))).digest('hex')
const report={result:'PASS',directory,requirement:'3.2 input naming',browserObservationSteps:browser.observations.length,counts,liveSources:3,asRun:0,items:0,ownedSendersStopped:4,forcedStops:0,tabClosed:true,evidenceHashes,serverSha:result.serverSha,engineSha:result.engineSha,devicesSha:result.devicesSha,devicesOverride:result.devicesOverride,webSha:result.webSha,sourceWebOverride:result.sourceWebOverride,physicalSignalValidated:false,limits:browser.limitations}
await writeFile(join(directory,'assertions-names.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))

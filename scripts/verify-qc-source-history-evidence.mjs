import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'

assert.equal(process.argv.length,3,'Pass the owned native QC evidence directory')
const directory=resolve(process.argv[2]),json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'))
const result=await json('result.json'),dom=await json('omt-history-dom.json')
assert.equal(result.result,'FIXTURE_FINISHED');assert.equal(result.error,null);assert.equal(result.expired,false)
assert.equal(result.hashes.web,'8b0d3fcbd44724de835fcbe491531f6a5a0629ea9a688eca520efd76a2499f1d')
assert.equal(result.hashes.engine,'191cd1e112c7afba81896bbf3aa109a100775a7a358b7894faaafbe8d1abdfbc')
assert.equal(result.hashes.server,'a709115f976cc6372f1ffe13d1b9195261ffc217c0ebe2707990477056e0473a')
assert.equal(result.sourceWebOverride,true);assert.equal(result.devicesOverride,false)
assert.ok(result.events.some(row=>row.method==='GET'&&row.path==='/assets/index-BsVZYGz4.js'&&row.status===200),'Browser requested the compiled corrected asset')
assert.equal(result.asRun.count,0);assert.equal(result.items.count,0)
assert.ok(result.snapshots.length>0)
for(const sample of result.snapshots){assert.equal(sample.onAir,null);assert.equal(sample.playing,false)}
for(const kind of ['NDI','OMT']){
  const native=await json(kind.toLowerCase()+'-current-state.json')
  assert.equal(native.onAir,null);assert.equal(native.playing,false)
  assert.equal(native.signal.busStates.pvw,'PVW_READY')
  assert.ok(native.signal.busSignals.pvw.videoRecent&&native.signal.busSignals.pvw.audioRecent)
  assert.equal(native.previewFrame.delivered,true);assert.ok(native.previewFrame.ageMs<2000)
  assert.equal(native.paths.preview.ready,true);assert.deepEqual(native.paths.preview.tracks,['H264','Opus'])
  assert.equal(native.paths.inspection.ready,false);assert.equal(native.paths.inspection.readers,0)
  const ax=await readFile(join(directory,kind.toLowerCase()+'-current-ax.txt'),'utf8')
  assert.match(ax,/Medição PVW · 640×360 · 25.00 fps · áudio 2 ch/)
  assert.match(ax,/PVW PRONTO/);assert.match(ax,/BALANÇO RGB AMOSTRADO/)
}
const ndiSource=result.selectedSources.find(row=>row.kind==='NDI'),omtSource=result.selectedSources.find(row=>row.kind==='OMT')
assert.ok(ndiSource&&omtSource)
const ndi=dom.rows.find(row=>row.details.some(detail=>detail.text===ndiSource.reference)),omt=dom.rows.find(row=>row.details.some(detail=>detail.text===omtSource.reference))
assert.ok(ndi&&omt)
assert.equal(ndi.badge,'NÃO SINTONIZADA');assert.ok(!ndi.badgeClass.includes('text-status-ok'))
assert.match(ndi.text,/Última amostra \(histórica\)/);assert.match(ndi.text,/idade do quadro na coleta:/)
assert.ok(ndi.details.some(row=>row.title.includes('Não confirma vídeo ou áudio atuais')))
assert.equal(omt.badge,'PVW PRONTO');assert.ok(omt.badgeClass.includes('text-status-ok'))
assert.match(omt.text,/Medição PVW/);assert.ok(!omt.text.includes('histórica'))
assert.ok(result.snapshots.some(sample=>sample.preview?.source===omtSource.reference&&sample.liveSources.some(row=>row.source===ndiSource.reference&&row.state==='IDLE'&&row.measurements?.pvw)),'Native state retains a historical NDI sample after OMT selection')
assert.deepEqual(dom.videos,[{width:428,height:240,ready:4,paused:false}])
assert.equal(result.senders.length,2)
for(const sender of result.senders){assert.equal(sender.exitCode,0);assert.equal(sender.forcedStop,false);assert.deepEqual(sender.errors,[])}
for(const key of ['serverExitObserved','carrierStopped','nativeStopped'])assert.equal(result[key],true)
const screenshot=await readFile(join(directory,'omt-history.jpg'))
assert.equal(screenshot[0],0xff);assert.equal(screenshot[1],0xd8)
const report={result:'PASS',scope:'Local native QC browser source-history distinction after NDI to OMT; not physical/remote/soak or full signal fidelity',web:result.hashes.web,ndiBadge:ndi.badge,omtBadge:omt.badge,video:dom.videos[0],asRun:0,items:0,ownProcessesStopped:true,screenshotSha256:createHash('sha256').update(screenshot).digest('hex'),limits:['No PCM/pixel capture repeated: engine unchanged','No frozen-WebSocket browser scenario; expiry logic covered by directed unit tests','Controller browserValidated remains false; this evidence only covers the named UI contract']}
await writeFile(join(directory,'assertions-source-history.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))

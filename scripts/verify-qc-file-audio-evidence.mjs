import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'

// Recheck saved browser observations, not browser internals or a new playback.
// This certifies only the sampled UI contract, never listening/fidelity/soak.
assert.equal(process.argv.length,3,'Pass one owned QC file evidence directory')
const directory=resolve(process.argv[2])
const json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'))
const workflow=await json('result.json')
assert.equal(workflow.result,'COMPILED_WORKFLOW_PASS')
assert.equal(workflow.serverExitObserved,true)
assert.equal(workflow.pgmEngineNotEnabled,true)
assert.equal(workflow.serverSha256,'a709115f976cc6372f1ffe13d1b9195261ffc217c0ebe2707990477056e0473a')
const fixture=workflow.verified.find(item=>item.label==='01-16x9')
assert.ok(fixture?.originalHashVerified)
assert.equal(fixture.qcStatus,'PENDING')
const [original]=await json('original-decoded.json')
const [proxy]=await json('return-proxy-decoded.json')
for(const [sample,raster,mode]of [[original,fixture.sourceRaster,'quality=original'],[proxy,fixture.proxyRaster,'preview=1']]){
  assert.deepEqual([sample.width,sample.height],raster)
  assert.equal(sample.ready,4)
  assert.equal(sample.paused,false)
  assert.ok(sample.time>0)
  assert.ok(sample.src.includes(`/api/assets/${fixture.id}/media?${mode}&hash=${fixture.hash}`))
}
const observations={}
for(const name of ['original-unmuted-running','original-muted-running','original-paused','return-proxy-running']){
  observations[name]=await readFile(join(directory,name+'-ax.txt'),'utf8')
  assert.match(observations[name],/RPLAYOUT pause PARADO/)
  assert.match(observations[name],/SAFE AREAS[^\n]*Value: 0/)
  assert.match(observations[name],/0  OK • 3  PENDENTES/)
}
const peaks={}
for(const name of ['original-unmuted-running','original-muted-running','return-proxy-running']){
  const observation=observations[name]
  assert.match(observation,/button pause, Help: Pausar/)
  assert.match(observation,/MONITORAMENTO  10  Hz/)
  assert.match(observation,/BALANÇO RGB AMOSTRADO/)
  const match=observation.match(/LRA \/ Pico: —  •  (-?\d+) dB/)
  assert.ok(match,'Real peak displayed in '+name)
  peaks[name]=Number(match[1])
  assert.ok(peaks[name]>-40&&peaks[name]<-15,'Synthetic 0.05-amplitude tone is not silence/clipping')
}
assert.match(observations['original-unmuted-running'],/Volume: 80%/)
assert.match(observations['original-muted-running'],/button volume_off/)
assert.match(observations['original-muted-running'],/Volume: 0%/)
assert.ok(Math.abs(peaks['original-unmuted-running']-peaks['original-muted-running'])<=1,'Monitor mute must not silence the pre-fader meter')
assert.match(observations['original-paused'],/button play_arrow, Help: Reproduzir/)
assert.match(observations['original-paused'],/MONITORAMENTO  4  Hz/)
assert.match(observations['original-paused'],/LRA \/ Pico: —  •  —/)
const pausedTime=Number(observations['original-paused'].match(/slider \(settable, float\) Value: [^\n]*Details: ([\d.]+)/)?.[1])
assert.ok(pausedTime>original.time+1,'Playback cursor advanced before pause')
assert.ok(proxy.time>=pausedTime&&proxy.time-pausedTime<1,'Return to proxy preserves sampled pause position')
assert.match(observations['return-proxy-running'],/SCOPES ·  PROXY LEVE/)
const artifacts={}
for(const name of ['original-unmuted-running.jpg','original-muted-running.jpg','return-proxy-running.jpg']){
  const bytes=await readFile(join(directory,name))
  assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8)
  artifacts[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
}
const result={result:'PASS',scope:'Local browser sampled original/proxy audio meter, monitor mute, pause and return position only',fixture:fixture.id,peaks,original,proxy,pausedTime,artifacts,serverExitObserved:true,limits:['No human listening or channel-by-channel PCM capture','Not continuous/soak, remote throughput or CPU/RAM benchmark','No physical output, external live source or installer validation','Workflow browserValidated remains false: the four-file visual suite was not repeated']}
await writeFile(join(directory,'assertions-file-audio.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))

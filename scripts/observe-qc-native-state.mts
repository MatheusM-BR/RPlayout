import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,join,relative} from 'node:path'
const directory=resolve(process.argv[2]??''),label=process.argv[3]??''
assert.match(label,/^[a-z0-9-]+$/)
assert.match(relative(resolve('scratch'),directory),/^qc-native-browser-[a-zA-Z0-9]+$/)
const launch=JSON.parse(await readFile(join(directory,'launch.json'),'utf8'))
assert.equal(launch.directory,directory);assert.ok(['7fd481e0b58a147c553477ec2b9eab397ebad4ed9136f0d2d589b6981b141eb9','191cd1e112c7afba81896bbf3aa109a100775a7a358b7894faaafbe8d1abdfbc'].includes(launch.hashes.engine))
const base=`http://127.0.0.1:${launch.backendPort}`
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username:'qc-native-verifier',password:'Local-QC-native-20261015'}),signal:AbortSignal.timeout(10000)})
assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie)
const get=async(path:string)=>{const response=await fetch(base+path,{headers:{cookie},signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);return response.json() as Promise<any>}
const view=await get('/api/rundowns/rd'),processes=await get('/api/processes')
assert.equal(view.view.rundown.channelId,'qa');assert.equal(view.view.rundown.name,'Empty QC only');assert.equal(view.view.items.length,0)
assert.equal(view.live.transport.onAir,null);assert.equal(view.live.transport.playing,false)
const source=view.live.transport.liveSources.find((row:any)=>row.source===view.live.transport.preview?.source)
const paths:any={}
for(const bus of ['preview','inspection']){
  const path=view.monitors[bus];assert.match(path,/^qa-native-qc\/(pvw|qc)$/)
  const response=await fetch('http://127.0.0.1:9997/v3/paths/get/'+path,{signal:AbortSignal.timeout(5000)});assert.equal(response.status,200)
  const value=await response.json() as any;paths[bus]={path,ready:value.ready,tracks:value.tracks,readers:value.readers?.length??0,bytesReceived:value.bytesReceived,bytesSent:value.bytesSent}
}
const report={at:Date.now(),label,onAir:view.live.transport.onAir,playing:view.live.transport.playing,preview:view.live.transport.preview,previewFrame:view.live.transport.previewFrame,signal:source,processes:processes.processes.filter((row:any)=>row.kind==='ENGINE'&&row.channelId==='qa'),paths}
await writeFile(join(directory,label+'-state.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({label,previewFrame:report.previewFrame,paths}))

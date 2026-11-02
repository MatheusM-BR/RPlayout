import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import Database from '../apps/server/node_modules/better-sqlite3/lib/index.js'

// Read-only measurement of an already completed isolated native fixture.
// Never rerun scan/proxy, open the operational database or start an engine.
const directory=resolve(process.argv[2]??'')
assert.ok(process.argv[2],'Provide the completed QC fixture directory')
const receipt=JSON.parse(await readFile(join(directory,'result.json'),'utf8'))
assert.equal(receipt.result,'COMPILED_WORKFLOW_PASS')
// Historical result.json was written only in finally after waiting for exit,
// but kept that flag only in stdout. New receipts persist it too.
if(receipt.serverExitObserved!==undefined)assert.equal(receipt.serverExitObserved,true)
assert.equal(receipt.pgmEngineNotEnabled,true)
const db=new Database(join(directory,'service.db'),{readonly:true,fileMustExist:true})
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const metrics=[]
try{
  for(const fixture of receipt.verified){
    const row=db.prepare(`SELECT a.path,a.duration_ns,j.output_path,j.output_hash
      FROM media_assets a JOIN media_versions v ON v.asset_id=a.id
      JOIN media_jobs j ON j.version_id=v.id
      WHERE a.id=? AND v.content_hash=? AND j.kind='PROXY' AND j.state='READY'`).get(fixture.id,fixture.hash) as any
    assert.ok(row,'Verified proxy edition must still exist')
    const source=await readFile(row.path),proxy=await readFile(row.output_path)
    assert.equal(sha(source),fixture.hash);assert.equal(sha(proxy),row.output_hash)
    const seconds=Number(row.duration_ns)/1e9;assert.ok(Number.isFinite(seconds)&&seconds>0)
    metrics.push({label:fixture.label,seconds,sourceBytes:source.length,proxyBytes:proxy.length,
      sourceAverageKbps:Math.round(source.length*8/seconds/1000),proxyAverageKbps:Math.round(proxy.length*8/seconds/1000),
      bytesReductionPercent:Math.round((1-proxy.length/source.length)*10000)/100,
      sourceRaster:fixture.sourceRaster,proxyRaster:fixture.proxyRaster})
  }
}finally{db.close()}
const result={result:'MEASURED',directory,metrics,scope:'Stored complete-file payload, not network throughput or browser CPU/RAM',
  remoteValidated:false,liveWhepValidated:false,browserCpuMeasured:false}
await writeFile(join(directory,'preview-budget.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))

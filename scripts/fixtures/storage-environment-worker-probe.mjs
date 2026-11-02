import {isMainThread,workerData,threadId} from 'node:worker_threads'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {dirname,join} from 'node:path'

// Declared QA preload, not a product hook. Observe key PRESENCE only; never
// serialize values. No change to IPC messages, grants, SQL or the environment.
if(!isMainThread&&typeof workerData?.service==='string'){
  const directory=dirname(workerData.service),marker=join(directory,'scope.json')
  if(existsSync(marker)){
    const scope=JSON.parse(readFileSync(marker,'utf8'))
    if(scope.kind==='RPlayout-storage-environment-qa'&&scope.ownerPid===process.pid){
      writeFileSync(join(directory,'worker-environment.json'),JSON.stringify({pid:process.pid,threadId,canaries:Object.fromEntries(scope.canaryKeys.map(key=>[key,Object.keys(process.env).some(name=>name.toUpperCase()===key.toUpperCase())])),runtimeKeys:Object.keys(process.env).sort(),parentStorageFileInherited:Object.keys(process.env).some(key=>key.toUpperCase()==='RPLAYOUT_STORAGE_FILE')},null,2))
    }
  }
}

const {readFileSync,writeFileSync}=require('node:fs')
const {join}=require('node:path')
const {createHash}=require('node:crypto')
// Declared QA entry loader. The exact compiled service runs in THIS process,
// with its ordinary IPC handlers. No proxy/fork, rewritten request or fake ACK.
const scope=JSON.parse(readFileSync(join(__dirname,'scope.json'),'utf8'))
if(scope.kind!=='RPlayout-storage-environment-qa'||!process.send||!process.env.RPLAYOUT_STORAGE_FILE)throw new Error('Own QA scope and private storage IPC required')
const report={stage:'STARTED',loaderPid:process.pid,realPid:process.pid,canaries:Object.fromEntries(scope.canaryKeys.map(key=>[key,Object.keys(process.env).some(name=>name.toUpperCase()===key.toUpperCase())])),runtimeKeys:Object.keys(process.env).sort(),correctDatabase:process.env.RPLAYOUT_STORAGE_FILE===scope.database,realServiceHash:createHash('sha256').update(readFileSync(scope.realService)).digest('hex'),directCompiledModule:true}
const persist=()=>writeFileSync(join(__dirname,'service-environment.json'),JSON.stringify(report,null,2))
persist()
process.on('exit',code=>{report.stage='EXITED';report.exit={code,signal:null};persist()})
require(scope.realService)

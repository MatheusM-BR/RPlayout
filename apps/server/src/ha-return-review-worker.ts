import {parentPort,workerData} from 'node:worker_threads'
import Database from 'better-sqlite3'
import {inspectReturnedDatabase,extractReturnedHistory} from './domain/ha-return-db-review.js'
import {exportProtectedBridge,importProtectedBridge} from './domain/ha-protected-bridge.js'
import {materializeReturnCandidate} from './domain/ha-return-candidate.js'
import {readReturnCandidateOrigin,haReturnCandidateOriginRequest} from './domain/ha-return-candidate-origin.js'
import {materializeBoundReturnCandidate,haReturnBoundCandidateJob} from './domain/ha-return-bound-candidate.js'
import {materializeReturnMediaCandidate,haReturnMediaCandidateJob} from './domain/ha-return-media-candidate.js'
import {lstatSync} from 'node:fs'
import {basename,dirname,resolve} from 'node:path'
let database:Database.Database|null=null
try{
  const mutation=workerData.mode==='EXPORT_BRIDGE'||workerData.mode==='IMPORT_BRIDGE'
  if(mutation||workerData.rekeyed||workerData.candidate||workerData.candidateOrigin||workerData.boundCandidate||workerData.mediaCandidate){
    const file=resolve(workerData.file),name=mutation?(workerData.mode==='EXPORT_BRIDGE'?'returned.db':'rekeyed.db'):workerData.mediaCandidate?'bound.db':workerData.candidateOrigin||workerData.boundCandidate?'candidate.db':'inspection.db',info=lstatSync(file)
    if(workerData.mediaCandidate&&(mutation||workerData.candidate||workerData.candidateOrigin||workerData.boundCandidate||workerData.rekeyed||workerData.records||basename(dirname(file))!=='.ha-execution.private-'+haReturnMediaCandidateJob.parse(workerData.mediaCandidate.job).applicationId))throw new Error('Derivação de mídia incompatível com modo/diretório.')
    if(workerData.boundCandidate&&(mutation||workerData.candidate||workerData.candidateOrigin||workerData.rekeyed||workerData.records||basename(dirname(file))!=='.ha-execution.private-'+haReturnBoundCandidateJob.parse(workerData.boundCandidate.job).candidate.candidateId))throw new Error('Aplicação privada incompatível com modo/diretório.')
    if(workerData.candidateOrigin&&(mutation||workerData.candidate||workerData.rekeyed||basename(dirname(file))!=='.ha-execution.private-'+haReturnCandidateOriginRequest.parse(workerData.candidateOrigin).candidateId))throw new Error('Leitura privada incompatível com modo/diretório.')
    if(file.startsWith('\\\\')||basename(file)!==name||!/^\.ha-execution\.private-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(basename(dirname(file)))||!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('Operação exige derivada privada específica.')
    let cursor=dirname(file)
    for(;;){const parentInfo=lstatSync(cursor);if(!parentInfo.isDirectory()||parentInfo.isSymbolicLink())throw new Error('Link/junção não permitido.');const parent=dirname(cursor);if(parent===cursor)break;cursor=parent}
  }
  database=new Database(workerData.file,{readonly:!mutation,fileMustExist:true})
  const report=workerData.mode==='EXPORT_BRIDGE'?exportProtectedBridge(database,workerData.exportId,workerData.pairingKey):workerData.mode==='IMPORT_BRIDGE'?importProtectedBridge(database,workerData.exportId,workerData.pairingKey,workerData.proof):database.transaction(()=>workerData.mediaCandidate?materializeReturnMediaCandidate(database!,workerData.file,workerData.mediaCandidate.file,workerData.mediaCandidate.job):workerData.boundCandidate?materializeBoundReturnCandidate(database!,workerData.file,workerData.boundCandidate.file,workerData.boundCandidate.job):workerData.candidateOrigin?readReturnCandidateOrigin(database!,workerData.candidateOrigin):workerData.candidate?materializeReturnCandidate(database!,workerData.candidate.file,workerData.candidate.job):workerData.records?extractReturnedHistory(database!,workerData.channelId,workerData.records):inspectReturnedDatabase(database!,workerData.channelId,workerData.baseline,workerData.rekeyed)).deferred()
  parentPort?.postMessage({ok:true,report})
}
catch{parentPort?.postMessage({ok:false})}
finally{database?.close()}

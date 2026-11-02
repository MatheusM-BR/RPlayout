import {dirname,resolve} from 'node:path'
import type {App} from '../app.js'
import type {HaExecutionAdmission} from './ha-execution-admission.js'
import {assertHaExecutionAdmission} from './ha-execution-admission.js'
import {DistributionOwnership} from './distribution-ownership.js'
import {MediaMtx} from './mediamtx.js'
import {MEDIAMTX_BINARY,MEDIAMTX_BIND,MEDIAMTX_LOGLEVEL} from '../config.js'
import {haLocalMediaPaths} from './ha-media-paths.js'
import {operatorDecisions} from '../db/schema.js'
import {randomUUID} from 'node:crypto'

export function createHaOwnedMedia(app:App,admission:HaExecutionAdmission,outputs:Parameters<typeof haLocalMediaPaths>[0],channelId:string,authorize:()=>Promise<void>,signal:AbortSignal){
  assertHaExecutionAdmission(admission);admission.assertHeld()
  if(app.haExecutionAdmission!==admission)throw new Error('Servidor de mídia exige backend copiado próprio.')
  const channels=app.db.$client.prepare('SELECT id FROM channels').all() as {id:string}[]
  if(channels.length!==1||channels[0]?.id!==channelId)throw new Error('Mídia de outro canal/cópia.')
  const plan=haLocalMediaPaths(outputs)
  if(!plan.paths.length)return null
  if(!MEDIAMTX_BINARY)throw new Error('Destinos locais exigem runtime MediaMtx incluído na instalação.')
  const assertLocal=()=>{signal.throwIfAborted();admission.assertHeld()}
  // Cancellation blocks NEW effects, not the owned cleanup needed to release.
  const ownership=new DistributionOwnership(app.db,app.executionOwnership.identity,undefined,admission.hostFence,()=>admission.assertHeld())
  const current=async()=>{assertLocal();await authorize();assertLocal()}
  const media=new MediaMtx({binary:MEDIAMTX_BINARY,configPath:resolve(dirname(admission.copy.file),'mediamtx-ha.yml'),bind:MEDIAMTX_BIND,logLevel:MEDIAMTX_LOGLEVEL,ownership,hostFence:admission.hostFence,requireAppliedConfig:true,assertAdmission:current})
  let preparing:Promise<void>|null=null,stopping:Promise<{ownedMediaProcessesStopped:boolean}>|null=null,closed=false,failed=false,observing=false
  let timer:ReturnType<typeof setInterval>|null=null,pending:Promise<void>|null=null
  return {plan,
    prepare:()=>preparing??=(async()=>{if(closed)throw new Error('Mídia HA encerrada.');await current();ownership.claim();await media.apply([],[],plan.paths);await current();if(closed)throw new Error('Mídia HA encerrada.');await media.startConfirmed();await current()})(),
    ready:()=>!closed&&!failed&&media.readyForPublish,
    state:()=>closed?'STOPPED' as const:failed?'FAILED' as const:media.readyForPublish?'RUNNING' as const:'NOT_READY' as const,
    startObservation:(onLost:(programDependent:boolean)=>void)=>{
      if(closed||failed||observing||!media.readyForPublish)throw new Error('Observação de mídia exige geração própria pronta e única.')
      observing=true
      const tick=()=>{
        if(closed||failed||pending)return
        pending=(async()=>{
          assertLocal()
          if(await media.refreshReadiness()){assertLocal();return}
          throw new Error('Readiness da mídia própria perdida.')
        })().catch(()=>{
          if(closed)return
          failed=true;if(timer)clearInterval(timer);timer=null
          try{admission.assertHeld();app.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@ha',kind:'HA_MEDIA_READINESS_LOST',actorUsername:'@ha',createdAt:new Date().toISOString(),payload:{version:1,promotionId:admission.copy.id,channelId,programDependent:plan.programDependent,automaticRestart:false,physicalOutputValidated:false}}).run()}catch{}
          // No adoption/restart or PGM disruption for monitor-only failure.
          // Callback is synchronous, scoped to the adapter's owned generation.
          try{onLost(plan.programDependent)}catch{}
          try{media.stop()}catch{}
        }).finally(()=>{pending=null})
      }
      timer=setInterval(tick,1000);timer.unref();tick()
    },
    stop:()=>stopping??=(async()=>{closed=true;if(timer)clearInterval(timer);timer=null;const result=await media.stopConfirmed();await pending;if(result.ownedMediaProcessesStopped){try{ownership.close()}catch{return {ownedMediaProcessesStopped:false}}}return result})(),
  }
}

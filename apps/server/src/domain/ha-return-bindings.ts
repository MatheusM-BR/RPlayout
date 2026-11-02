import type Database from 'better-sqlite3'
import {z} from 'zod'
import {HaBindings,HaBindingError,haBindingRequest} from './ha-bindings.js'
import {haReturnCandidateRequest} from './ha-return-candidate-staging.js'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {HaSnapshot} from './ha-replication.js'
import {installationVault} from './secret-vault.js'

export const haReturnBindingRequest=z.object({channelId:z.string().min(1).max(128),candidate:haReturnCandidateRequest,binding:haBindingRequest}).strict().refine(value=>value.channelId===value.candidate.channelId&&value.candidate.channelId===value.binding.channelId,{message:'Vínculo pertence a outro canal.'})
export const haReturnBindingReviewRequest=haReturnCandidateRequest.extend({requestId:z.string().uuid().optional()}).strict()
/** Return plans have their own immutable journal. Source requirements come
 * from selected provenance; outputs ALWAYS come from the current principal. */
export function returnCandidateBindings(db:Database.Database,context:string,origin:ReturnType<typeof readReturnCandidateOrigin>,capture:()=>HaSnapshot,current:()=>void){
  return new HaBindings(db,'return:'+context,()=>{
    current()
    const local=capture().channels.find(row=>row.channelId===origin.job.request.channelId)
    if(!local)throw new HaBindingError(409,'Canal ausente do principal atual; não reutilizar saídas estrangeiras.')
    const localConfig=local.configuration.channel
    if(!localConfig||typeof localConfig!=='object'||Array.isArray(localConfig))throw new HaBindingError(409,'Configuração local incompleta.')
    const config=localConfig as Record<string,unknown>
    if(config.id!==origin.channel.id)throw new HaBindingError(409,'Configuração local pertence a outro canal.')
    if(!Array.isArray(local.configuration.outputs))throw new HaBindingError(409,'Inventário de saídas do principal incompleto; não tratar como vazio.')
    const configuration={channel:{...origin.channel,programSdiDeviceId:config.programSdiDeviceId??null,haReturnCandidateId:origin.job.candidateId,haReturnSelectionId:origin.job.request.planId,haReturnPrimaryConfiguration:localConfig},revision:local.configuration.revision,outputs:local.configuration.outputs,executionRevisionId:origin.job.request.executionRevisionId}
    const snapshot:HaSnapshot={version:1,capturedAt:origin.job.recordedAt,channels:[{channelId:origin.channel.id,configuration,revisions:origin.entries.map(entry=>({...entry.revision,payload:entry.payload,active:true})),checkpoint:origin.originalCursor?{value:origin.originalCursor}:null,transport:null,blockers:{}}],asRun:[],journals:[]}
    const digest=installationVault(false).reviewIdentity(JSON.stringify([origin.job,snapshot.channels]),'ha-return-binding-state:v1')
    current()
    return {sequence:1,digest,snapshot}
  },'RETURN','return-candidate:'+origin.job.candidateId+':'+origin.job.request.planId)
}

import type Database from 'better-sqlite3'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import {haReturnCandidateJob} from './ha-return-candidate.js'
import {installationVault} from './secret-vault.js'
import {readOperationalPayload} from './operational-playlist.js'
import {parseChannelCheckpoint} from './checkpoints.js'

export const haReturnCandidateOriginRequest=z.object({candidateId:z.string().uuid(),planId:z.string().uuid(),channelId:z.string().min(1).max(128)}).strict()
const originSchema=z.object({
  version:z.literal(1),job:haReturnCandidateJob,
  channel:z.object({id:z.string()}).passthrough(),
  entries:z.array(z.object({revision:z.object({id:z.string(),rundownId:z.string()}).passthrough(),payload:z.record(z.unknown())}).strict()).min(1).max(128),
  originalCursor:z.unknown(),intent:z.unknown(),
  revisionIds:z.array(z.tuple([z.string(),z.string()])).min(1).max(128),
  bindingsResolved:z.literal(false),nativePrepared:z.literal(false),authorityTransferred:z.literal(false)
}).strict()

/** Private worker result only: includes foreign paths/endpoints. Never return
 * this value from an HTTP handler or admit this candidate as an active DB. */
export function readReturnCandidateOrigin(db:Database.Database,raw:unknown){
  const request=haReturnCandidateOriginRequest.parse(raw),vault=installationVault(false)
  db.pragma('query_only = ON');db.pragma('trusted_schema = OFF')
  const rows=db.prepare('SELECT id,payload FROM ha_return_candidate_origin LIMIT 2').all() as Array<{id:number;payload:string}>
  const row=rows[0]
  if(rows.length!==1||!row||row.id!==1||typeof row.payload!=='string'||Buffer.byteLength(row.payload)>48*1024*1024)throw new Error('Proveniência privada ausente/incompatível/excessiva.')
  const clear=vault.decrypt(row.payload,'ha-return-candidate-origin:v1:'+request.candidateId)
  if(Buffer.byteLength(clear)>40*1024*1024)throw new Error('Proveniência excede orçamento.')
  const origin=originSchema.parse(JSON.parse(clear)),job=origin.job
  if(job.candidateId!==request.candidateId||job.request.planId!==request.planId||job.request.channelId!==request.channelId||origin.channel.id!==request.channelId||job.vaultFingerprint!==vault.fingerprint)throw new Error('Origem diverge do candidato/canal/cofre.')
  if(origin.entries.length!==job.request.revisionIds.length||origin.revisionIds.length!==origin.entries.length)throw new Error('Inventário incompleto.')
  const entries=origin.entries.map((entry,index)=>{
    const payload=readOperationalPayload(entry.payload),id=job.request.revisionIds[index],mapping=origin.revisionIds[index]
    if(id===undefined||!mapping)throw new Error('Seleção/mapeamento/revisão divergente.')
    const localId='ha-return-local:'+createHash('sha256').update(JSON.stringify([job.candidateId,job.request.planId,id,job.sourceDatabaseHash])).digest('hex')
    if(entry.revision.id!==id||payload.rundown.id!==entry.revision.rundownId||payload.rundown.channelId!==request.channelId||payload.items.length>100000||mapping[0]!==id||mapping[1]!==localId)throw new Error('Seleção/mapeamento/revisão divergente.')
    return {...entry,payload}
  })
  if(!entries.some(entry=>entry.revision.id===job.request.executionRevisionId))throw new Error('Edição de execução ausente.')
  const originalCursor=origin.originalCursor===null?null:parseChannelCheckpoint(origin.originalCursor,request.channelId)
  if(job.request.cursorPolicy==='RECEIVED_LAST_CONFIRMED'&&(!originalCursor||originalCursor.revisionId!==job.request.executionRevisionId))throw new Error('Cursor não corresponde à edição selecionada.')
  return {...origin,entries,originalCursor,operationalReady:false as const,publicationAuthorized:false as const}
}

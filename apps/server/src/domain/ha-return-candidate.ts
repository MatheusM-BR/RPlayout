import type Database from 'better-sqlite3'
import {drizzle} from 'drizzle-orm/better-sqlite3'
import {eq} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import {basename,dirname,resolve} from 'node:path'
import {lstatSync} from 'node:fs'
import {z} from 'zod'
import * as schema from '../db/schema.js'
import {openDatabase} from '../db/client.js'
import {assertSchemaCompatibility} from '../db/schema-compatibility.js'
import {installationVault} from './secret-vault.js'
import {haReturnSelectionRequest} from './ha-return-selection.js'
import {readOperationalPayload} from './operational-playlist.js'
import {Checkpoints,parseChannelCheckpoint} from './checkpoints.js'
import {haResumeIntent} from './ha-recovery-cursor.js'

export const haReturnCandidateJob=z.object({candidateId:z.string().uuid(),request:haReturnSelectionRequest,sourceDatabaseHash:z.string().regex(/^[a-f0-9]{64}$/),vaultFingerprint:z.string().regex(/^[a-f0-9]{64}$/),recordedAt:z.string().datetime()}).strict()
/** Internal private-worker primitive. Target is NEW/empty, never an existing
 * received/rekeyed/active DB. Bindings are deliberately unresolved in this stage. */
export function materializeReturnCandidate(source:Database.Database,targetFile:string,raw:z.infer<typeof haReturnCandidateJob>){
  const job=haReturnCandidateJob.parse(raw),vault=installationVault(false),file=resolve(targetFile),empty=lstatSync(file)
  if(vault.fingerprint!==job.vaultFingerprint||file.startsWith('\\\\')||basename(file)!=='candidate.db'||basename(dirname(file))!=='.ha-execution.private-'+job.candidateId||!empty.isFile()||empty.isSymbolicLink()||empty.nlink!==1||empty.size!==0)throw new Error('Candidato exige arquivo novo privado e cofre correspondente.')
  let cursor=dirname(file)
  for(;;){const info=lstatSync(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Candidato não pode atravessar link/junção.');const parent=dirname(cursor);if(parent===cursor)break;cursor=parent}
  source.pragma('query_only = ON');source.pragma('trusted_schema = OFF');assertSchemaCompatibility(source,true)
  const input=drizzle(source,{schema}),channel=input.select().from(schema.channels).where(eq(schema.channels.id,job.request.channelId)).get()
  if(!channel)throw new Error('Canal selecionado ausente.')
  const entries=job.request.revisionIds.map(id=>{
    const revision=input.select().from(schema.operationalPlaylistRevisions).where(eq(schema.operationalPlaylistRevisions.id,id)).get()
    if(!revision)throw new Error('Edição selecionada ausente.')
    const payload=readOperationalPayload(revision.payload)
    if(payload.rundown.channelId!==channel.id||payload.rundown.id!==revision.rundownId||payload.items.length>100000)throw new Error('Edição de outro canal/grade ou excede limite.')
    return {revision,payload}
  })
  const mapping=new Map(entries.map(({revision})=>[revision.id,'ha-return-local:'+createHash('sha256').update(JSON.stringify([job.candidateId,job.request.planId,revision.id,job.sourceDatabaseHash])).digest('hex')]))
  let bytes=0
  for(const entry of entries){if((bytes+=Buffer.byteLength(JSON.stringify(entry)))>32*1024*1024)throw new Error('Seleção excede orçamento do candidato.')}
  const checkpointRow=source.prepare('SELECT payload,saved_at FROM channel_checkpoints WHERE channel_id=?').get(channel.id) as {payload:string;saved_at:string}|undefined
  const originalCursor=checkpointRow?parseChannelCheckpoint(JSON.parse(checkpointRow.payload),channel.id):null
  if(job.request.cursorPolicy==='RECEIVED_LAST_CONFIRMED'&&(!originalCursor||originalCursor.revisionId!==job.request.executionRevisionId))throw new Error('Cursor recebido não corresponde à seleção.')
  const intent=haResumeIntent(job.request.cursorPolicy==='RECEIVED_LAST_CONFIRMED'?originalCursor:null,channel.id,mapping,checkpointRow?.saved_at??job.recordedAt)
  // Explicit INLINE applies only to this private worker. No fallback to inline
  // is introduced for the production server or its active storage service.
  if(process.env.RPLAYOUT_STORAGE_MODE!=='INLINE')throw new Error('Worker de candidato exige modo privado INLINE explícito.')
  let target:ReturnType<typeof openDatabase>|null=null
  try{
    target=openDatabase(file)
    target.db.transaction(tx=>{
      tx.insert(schema.channels).values({...channel,programSdiDeviceId:null,slateTemplateId:null,archivedAt:job.recordedAt}).run()
      const grades=new Set<string>()
      for(const {revision,payload} of entries){
        if(!grades.has(revision.rundownId)){
          const grade=input.select().from(schema.rundowns).where(eq(schema.rundowns.id,revision.rundownId)).get()
          if(!grade||grade.channelId!==channel.id)throw new Error('Grade selecionada incompatível.')
          tx.insert(schema.rundowns).values({...grade,publicationRequired:true}).run();grades.add(grade.id)
        }
        // Original endpoints/paths/events stay only in encrypted provenance.
        // No foreign resource can be opened by this blocked local variant.
        const blocked={...payload,items:payload.items.map(item=>({...item,configuredSourceId:null,sourceRef:null,liveEndpoint:null,liveConfig:item.liveConfig?{...item.liveConfig,sourceEndpoint:undefined}:item.liveConfig})),assets:(payload.assets??[]).map(asset=>({...asset,path:'',ignored:true,qcStatus:'BLOCKED' as const})),graphics:{templates:[],cues:[]},secondaryEvents:[],haReturnOrigin:{version:1,planId:job.request.planId,sourceRevisionId:revision.id,bindingsResolved:false}}
        tx.insert(schema.operationalPlaylistRevisions).values({...revision,id:mapping.get(revision.id)!,payload:blocked as unknown as Record<string,unknown>}).run()
      }
      const execution=entries.find(entry=>entry.revision.id===job.request.executionRevisionId)!
      new Checkpoints(target!.sqlite).write({version:1,channelId:channel.id,rundownId:execution.revision.rundownId,revisionId:mapping.get(job.request.executionRevisionId)!,itemId:null,elapsed:0,playing:false,realEngine:false})
      target!.sqlite.exec('CREATE TABLE ha_return_candidate_origin(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)')
      target!.sqlite.prepare('INSERT INTO ha_return_candidate_origin VALUES(1,?)').run(vault.encrypt(JSON.stringify({version:1,job,channel,entries,originalCursor,intent,revisionIds:[...mapping],bindingsResolved:false,nativePrepared:false,authorityTransferred:false}),'ha-return-candidate-origin:v1:'+job.candidateId))
    })
    if(target.sqlite.pragma('integrity_check',{simple:true})!=='ok'||(target.sqlite.pragma('foreign_key_check') as unknown[]).length)throw new Error('Candidato não passou na integridade.')
    for(const name of ['output_profiles','live_sources','execution_owner_runs','distribution_owner_runs','as_run'])if((target.sqlite.prepare('SELECT count(*) AS n FROM '+name).get() as {n:number}).n!==0)throw new Error('Candidato contém execução/saídas/histórico indevidos.')
    target.sqlite.pragma('wal_checkpoint(TRUNCATE)');target.sqlite.pragma('journal_mode = DELETE')
    const final=lstatSync(file)
    if(final.dev!==empty.dev||final.ino!==empty.ino||final.nlink!==1)throw new Error('Candidato mudou de identidade.')
    return {version:1 as const,candidateId:job.candidateId,planId:job.request.planId,channelId:channel.id,selectedRevisions:entries.length,vaultFingerprint:vault.fingerprint,channelArchived:true as const,cursorStopped:true as const,foreignOwnershipImported:false as const,bindingsResolved:false as const,nativePrepared:false as const,publicationAuthorized:false as const,authorityTransferred:false as const}
  }finally{target?.sqlite.close()}
}

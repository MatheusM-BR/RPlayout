import type Database from 'better-sqlite3'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import {Checkpoints} from './checkpoints.js'
import {haResumeIntent,stoppedHaCheckpoint,assertHaNativeResumeIntent} from './ha-recovery-cursor.js'
import {readOperationalPayload} from './operational-playlist.js'
import {materializeHaPayload,type LocalMountCheck} from './ha-local-payload.js'
import type {HaBindings} from './ha-bindings.js'
import type {HaRecoveryRequest} from './ha-recovery.js'
import type {HaSnapshot} from './ha-replication.js'
import {resolveTrim,type MediaAsset} from '@rplayout/protocol'
import {assertProgramTrim} from './program-trim.js'
import {prepareHaLocalOutputs} from './ha-local-outputs.js'
import {prepareHaGraphicRecovery} from './ha-graphic-recovery.js'
import {prepareHaSecondaryRecovery} from './ha-secondary-recovery.js'

const requestSchema=z.object({requestId:z.string().uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),channelId:z.string().min(1).max(128),bindingPlanId:z.string().uuid().optional()}).strict()
const sourceSchema=z.object({version:z.literal(1),request:requestSchema,channel:z.unknown(),capturedAt:z.string().datetime(),asRun:z.array(z.record(z.unknown())),journals:z.array(z.record(z.unknown()))}).passthrough()
const cursorSchema=z.object({version:z.literal(1),request:requestSchema,revisionIds:z.array(z.tuple([z.string().min(1),z.string().min(1)])).max(100000),intent:z.unknown()}).strict()
const channelSchema=z.object({id:z.string(),rateNum:z.number().int().positive(),rateDen:z.number().int().positive(),audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)])}).passthrough()
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)

/** Private, read-only bridge from the preparation ledger to native activation.
 * A HTTP caller cannot nominate a workspace or supply an alleged native ACK.
 * This result is NOT an execution grant; the adapter must obtain host/storage
 * admission and native witness fencing, render mixes/graphics and receive live
 * video before enabling the selected outputs. */
export function readHaPromotionCandidate(sql:Database.Database,context:string,request:HaRecoveryRequest,plan:ReturnType<HaBindings['executionBindings']>){
  const read=(table:'ha_recovery_origin'|'ha_recovery_cursor'|'ha_recovery_plan',suffix:string)=>{
    const row=sql.prepare(`SELECT payload FROM ${table} WHERE id=1`).get() as {payload:string}|undefined
    if(!row)throw new Error('Preparação HA anterior/incompleta; refaça a preparação local com novo pedido.')
    return JSON.parse(installationVault(false).decrypt(row.payload,context+suffix)) as unknown
  }
  if(!request.bindingPlanId||request.bindingPlanId!==plan.planId)throw new Error('Candidato HA exige plano local exato.')
  const origin=sourceSchema.parse(read('ha_recovery_origin',':origin')),saved=cursorSchema.parse(read('ha_recovery_cursor',':cursor'))
  const storedPlan=z.object({version:z.literal(1),request:requestSchema,snapshotSequence:z.number().int().positive(),plan:z.unknown(),revisionIds:cursorSchema.shape.revisionIds,mountChecks:z.array(z.unknown()),automaticTake:z.literal(false),promotionReady:z.literal(false)}).strict().parse(read('ha_recovery_plan',':local-plan'))
  for(const recorded of [origin.request,saved.request,storedPlan.request])if(!same(recorded,requestSchema.parse(request)))throw new Error('Preparação/cursor/origem pertencem a outro pedido HA.')
  if(!same(storedPlan.plan,plan)||!same(storedPlan.revisionIds,saved.revisionIds))throw new Error('Plano local ou mapa de edições não corresponde à preparação.')
  const source=origin.channel as HaSnapshot['channels'][number]
  if(!source||source.channelId!==request.channelId||!source.configuration||!Array.isArray(source.revisions))throw new Error('Origem HA não corresponde ao canal escolhido.')
  const channel=channelSchema.parse(source.configuration.channel)
  if(channel.id!==request.channelId)throw new Error('Configuração HA de outro canal.')
  const localChannel=sql.prepare('SELECT id,archived_at,rate_num,rate_den,audio_channels FROM channels WHERE id=?').get(channel.id) as {id:string;archived_at:string|null;rate_num:number;rate_den:number;audio_channels:number}|undefined
  if(!localChannel?.archived_at||localChannel.rate_num!==channel.rateNum||localChannel.rate_den!==channel.rateDen||localChannel.audio_channels!==channel.audioChannels)throw new Error('Candidato HA não está arquivado com a cadência/barramento originais.')
  if((sql.prepare('SELECT count(*) n FROM channels').get() as {n:number}).n!==1||(sql.prepare('SELECT count(*) n FROM output_profiles').get() as {n:number}).n!==0)throw new Error('Preparação HA contém canais/saídas operacionais inesperados.')
  const mapping=new Map(saved.revisionIds)
  if(mapping.size!==saved.revisionIds.length||new Set(mapping.values()).size!==mapping.size)throw new Error('Mapa HA duplicado ou ambíguo.')
  const originalCursor=(source.checkpoint as {value?:unknown}|null)?.value??null
  const intent=haResumeIntent(originalCursor,channel.id,mapping,origin.capturedAt)
  if(!same(saved.intent,intent))throw new Error('Intenção de retomada diverge do cursor original autenticado.')
  const stopped=new Checkpoints(sql).read(channel.id)
  if(!same(stopped,originalCursor===null?null:stoppedHaCheckpoint(originalCursor,channel.id,mapping)))throw new Error('Cursor operacional da preparação foi alterado; nenhuma retomada autorizada.')
  const nativeCursor=assertHaNativeResumeIntent(intent)
  const execution=source.configuration.executionRevisionId
  if(execution!==null&&execution!==undefined&&typeof execution!=='string')throw new Error('Edição em execução na origem HA inválida.')
  const demanded=new Set([execution,...(originalCursor?[(originalCursor as {revisionId?:string}).revisionId,(originalCursor as {contingency?:{revisionId?:string;loopRevisionId?:string}}).contingency?.revisionId,(originalCursor as {contingency?:{loopRevisionId?:string}}).contingency?.loopRevisionId]:[])].filter((id):id is string=>typeof id==='string'))
  const required=source.revisions.filter(row=>row.active===true||demanded.has(String(row.id))).map(row=>String(row.id))
  if(new Set(required).size!==required.length||required.length!==mapping.size||required.some(id=>!mapping.has(id)))throw new Error('Inventário local não cobre todas as edições ativas/em execução/contingência da origem.')
  const rows=sql.prepare('SELECT id,rundown_id,revision,state,active,payload FROM operational_playlist_revisions ORDER BY rowid').all() as {id:string;rundown_id:string;revision:number;state:string;active:number;payload:string}[]
  if(rows.length!==mapping.size)throw new Error('Edições locais não correspondem ao inventário de preparação.')
  const derived=[],checks:LocalMountCheck[]=[],media=new Map<string,{hash:string;path:string}>()
  for(const [sourceId,localId] of mapping){
    const sourceRevision=source.revisions.find(row=>row.id===sourceId),row=rows.find(row=>row.id===localId)
    if(!sourceRevision||!row||sourceRevision.rundownId!==row.rundown_id||sourceRevision.revision!==row.revision||sourceRevision.state!==row.state||Boolean(sourceRevision.active)!==Boolean(row.active))throw new Error('Edição HA ausente, alterada ou de outra grade.')
    const payload=readOperationalPayload(JSON.parse(installationVault(false).decrypt(row.payload,'operational_playlist_revisions.payload')))
    const paths=new Map<string,string>(),assets=new Map<string,MediaAsset>()
    for(const asset of payload.assets??[]){
      if(!/^[a-f0-9]{64}$/i.test(asset.contentHash)||!asset.path)throw new Error('Mídia HA local sem SHA/caminho.')
      const existing=media.get(asset.contentHash)
      if(existing&&existing.path!==asset.path)throw new Error('Mesmo SHA associado a caminhos locais conflitantes.')
      media.set(asset.contentHash,{hash:asset.contentHash,path:asset.path});paths.set(asset.contentHash,asset.path);assets.set(asset.id+':'+asset.contentHash,asset)
    }
    const replay=materializeHaPayload(sourceRevision.payload as Record<string,unknown>,sourceId,plan,paths,assets,{num:channel.rateNum,den:channel.rateDen},channel.audioChannels)
    if(replay.id!==localId||!same(replay.payload,payload))throw new Error('Variante HA não reproduz a edição original e os vínculos autenticados.')
    checks.push(...replay.checks.map(check=>({...check,revisionId:sourceId})))
    derived.push({sourceRevisionId:sourceId,localRevisionId:localId,rundownId:row.rundown_id,payload})
  }
  if(checks.some(check=>check.errors.length))throw new Error('Montagem local HA possui bloqueios; corrija antes da etapa nativa.')
  if(nativeCursor?.playing){
    if(nativeCursor.rate!.num!==channel.rateNum||nativeCursor.rate!.den!==channel.rateDen||nativeCursor.audioChannels!==channel.audioChannels)throw new Error('Cadência/barramento do PGM salvo não corresponde ao canal preparado.')
    const edition=derived.find(row=>row.localRevisionId===nativeCursor.revisionId),item=edition?.payload.items.find(row=>row.id===nativeCursor.itemId)
    if(!edition||!item||edition.rundownId!==nativeCursor.rundownId)throw new Error('PGM salvo sem item/edição local correspondente.')
    const live=Boolean(item.sourceRef||item.liveEndpoint||item.liveConfig?.sourceEndpoint)
    if(!live){
      const asset=edition.payload.assets?.find(row=>row.id===item.mediaId)
      if(!asset||!nativeCursor.programTrim)throw new Error('VT salvo sem corte/versão de mídia comprovados pelo engine nativo.')
      assertProgramTrim({item,asset,trim:resolveTrim(item.trim,asset,{num:channel.rateNum,den:channel.rateDen}).value},nativeCursor.programTrim,nativeCursor.elapsed,{num:channel.rateNum,den:channel.rateDen})
    }else if(nativeCursor.programTrim)throw new Error('Live salvo não pode carregar corte de arquivo.')
  }
  const outputChannel=z.object({id:z.string(),width:z.number().int().positive(),height:z.number().int().positive(),programSdiDeviceId:z.string().nullable().optional()}).parse(source.configuration.channel)
  const localOutputs=prepareHaLocalOutputs(outputChannel,source.configuration.outputs,plan)
  const graphicRecovery=prepareHaGraphicRecovery(source.configuration.graphicRecovery,intent.foreignGraphicReceiptId)
  const currentEdition=nativeCursor?.playing?derived.find(row=>row.localRevisionId===nativeCursor.revisionId):undefined
  const currentItem=currentEdition?.payload.items.find(row=>row.id===nativeCursor!.itemId)
  const scheduledDuration=currentEdition?.payload.schedule.items.find(row=>row.id===nativeCursor!.itemId)?.duration
  const secondaryRecovery=nativeCursor?.playing&&currentEdition&&currentItem?prepareHaSecondaryRecovery(currentEdition.payload.secondaryEvents??[],origin.journals,{channelId:channel.id,executionId:nativeCursor.executionId!,revisionId:currentEdition.sourceRevisionId,itemId:nativeCursor.itemId!,elapsed:nativeCursor.elapsed,duration:nativeCursor.programTrim?nativeCursor.programTrim.out-nativeCursor.programTrim.in:scheduledDuration??0}):null
  return {version:1 as const,request:structuredClone(request),snapshotSequence:storedPlan.snapshotSequence,capturedAt:origin.capturedAt,localOutputs,graphicRecovery,secondaryRecovery,
    channel,plan:structuredClone(plan),intent,nativeCursor,localExecutionRevisionId:typeof execution==='string'?mapping.get(execution)!:null,revisions:derived,media:[...media.values()],mountChecks:checks,primaryBlockers:structuredClone(source.blockers),
    historicalAsRun:structuredClone(origin.asRun),historicalJournals:structuredClone(origin.journals),requiresNativePreparation:true as const,
    automaticTake:false as const,promotionReady:false as const,physicalOutputValidated:false as const}
}

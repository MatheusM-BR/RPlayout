import {parseChannelCheckpoint,type ChannelCheckpoint} from './checkpoints.js'

/** Foreign process IDs/graphic receipts are provenance, never proof that this
 * machine owns an engine or has rendered the primary's last composition. */
function localCheckpoint(value:unknown,channelId:string,revisionIds:ReadonlyMap<string,string>):ChannelCheckpoint {
  const original=parseChannelCheckpoint(value,channelId)
  if(original.liveProgramBinding)throw new Error('Retomada HA de perna alternativa ainda não homologada; grupo8 reservado à v3. Não converter para a fonte original.')
  const revision=(id:string|null)=>{
    if(id===null)return null
    const local=revisionIds.get(id)
    if(!local)throw new Error('Cursor HA referencia edição sem variante local correspondente.')
    return local
  }
  const {ownerRunId:_owner,graphicReceiptId:_receipt,...cursor}=original
  return parseChannelCheckpoint({...cursor,revisionId:revision(original.revisionId),
    contingency:original.contingency?{...original.contingency,revisionId:revision(original.contingency.revisionId),loopRevisionId:revision(original.contingency.loopRevisionId)!}:undefined},channelId)
}

/** Stored operational cursor is explicitly STOPPED. Retaining programTrim
 * here would contradict its schema (a trim is evidence of playing native PGM).
 * The original trim remains in the encrypted origin and separate resume intent. */
export function stoppedHaCheckpoint(value:unknown,channelId:string,revisionIds:ReadonlyMap<string,string>):ChannelCheckpoint {
  const {programTrim:_trim,...cursor}=localCheckpoint(value,channelId,revisionIds)
  return parseChannelCheckpoint({...cursor,playing:false,realEngine:false},channelId)
}

export interface HaResumeIntent {
  version:1
  checkpoint:ChannelCheckpoint|null
  capturedAt:string
  offsetPolicy:'LAST_CONFIRMED_OFFSET'
  foreignOwnerRunId:string|null
  foreignGraphicReceiptId:string|null
  requiresNativeFirstVideo:boolean
  graphicRecoveryRequired:boolean
  automaticTake:false
  promotionReady:false
}

/** An immutable recovery instruction, NOT a grant. Do not extrapolate elapsed
 * frames from wall time: the replicated checkpoint establishes only this offset.
 * A new native engine must confirm the same cut/offset and local signal first. */
export function haResumeIntent(value:unknown|null,channelId:string,revisionIds:ReadonlyMap<string,string>,capturedAt:string):HaResumeIntent {
  if(!Number.isFinite(Date.parse(capturedAt)))throw new Error('Snapshot HA sem instante de captura válido.')
  const original=value===null?null:parseChannelCheckpoint(value,channelId)
  const checkpoint=original?localCheckpoint(original,channelId,revisionIds):null
  return {version:1,checkpoint,capturedAt,offsetPolicy:'LAST_CONFIRMED_OFFSET',foreignOwnerRunId:original?.ownerRunId??null,
    foreignGraphicReceiptId:original?.graphicReceiptId??null,requiresNativeFirstVideo:Boolean(checkpoint?.playing),
    graphicRecoveryRequired:Boolean(original?.graphicReceiptId),automaticTake:false,promotionReady:false}
}

/** Called by the native activation path, never by preparation/query. A legacy
 * simulated/paused/underspecified cursor cannot silently become native PGM. */
export function assertHaNativeResumeIntent(intent:HaResumeIntent):ChannelCheckpoint|null {
  const cursor=intent.checkpoint
  if(!cursor)return null
  parseChannelCheckpoint(cursor)
  if(cursor.ownerRunId||cursor.graphicReceiptId)throw new Error('Intenção HA não pode importar posse/recibo gráfico do predecessor.')
  if(!cursor.realEngine&&(cursor.playing||cursor.itemId))throw new Error('Cursor do primário não comprova execução nativa.')
  if(cursor.realEngine&&!cursor.playing&&cursor.itemId)throw new Error('PGM pausado requer recuperação nativa de quadro congelado, ainda não integrada.')
  if(cursor.playing&&(!cursor.executionId||!cursor.rate||!cursor.audioChannels||!cursor.revisionId))throw new Error('Cursor HA legado sem execução/cadência/barramento/edição; retomada nativa recusada.')
  return structuredClone(cursor)
}

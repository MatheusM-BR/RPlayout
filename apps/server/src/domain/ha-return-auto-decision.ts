import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {audioCutIdentity,hasMatchingAudioMeasurement,resolveAudio,type MediaAsset,type AudioLevel} from '@rplayout/protocol'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {HaReturnMediaReviews} from './ha-return-media-review.js'
import {bindReturnAudioEvidence} from './ha-return-audio-application.js'
import {installationVault} from './secret-vault.js'
import {declaredFileTrim} from './execution-trim.js'

const hash=z.string().regex(/^[a-f0-9]{64}$/),mac=z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const haReturnAutoDecisionRequest=z.object({decisionId:z.string().uuid(),mediaReviewId:z.string().uuid(),channelId:z.string().min(1).max(128),evidenceMac:mac,mountKeys:z.array(hash).min(1).max(1000),reason:z.string().trim().min(5).max(2000)}).strict().refine(v=>new Set(v.mountKeys).size===v.mountKeys.length)
type Origin=ReturnType<typeof readReturnCandidateOrigin>
type Receipt=ReturnType<HaReturnMediaReviews['privateEvidence']>
export const HA_RETURN_AUTO_DECISION_RESERVE=256*1024
export function returnAutoDecisionOptions(origin:Origin,receipt:Receipt){
  const assets=new Map(receipt.evidence.localAssets.map(([key,value])=>[key,value as unknown as MediaAsset])),bound=bindReturnAudioEvidence(origin,assets,receipt.evidence.audio)
  const options=(bound?.evidence.entries??[]).filter(row=>row.mount.role==='MASTER'&&row.mount.mode==='AUTO'&&row.status==='MEASURED'&&origin.entries.some(edition=>edition.revision.id===row.mount.revisionId&&edition.payload.items.some(item=>item.id===row.mount.itemId&&!item.sourceRef&&!item.liveEndpoint&&!item.liveConfig?.sourceEndpoint))).map(row=>({mountKey:row.mount.key,revisionId:row.mount.revisionId,itemId:row.mount.itemId,integratedLufs:row.receipt!.reading.integratedLufs,lra:row.receipt!.reading.lra,truePeakDbtp:row.receipt!.reading.truePeakDbtp}))
  if(options.length>1000)throw new Error('Opções AUTO excedem limite; não truncar como completas.')
  return {version:1 as const,mediaReviewId:receipt.request.mediaReviewId,channelId:receipt.request.channelId,evidenceMac:receipt.result.evidenceMac,options,contingencySupported:false as const,qcApproved:false as const,publicationAuthorized:false as const}
}
/** Proposal only: adoption cannot change MANUAL/OFF or use a different input.
 * The durable decision authorizes a NEW derivative, never mutates publication. */
export function prepareReturnAutoDecision(origin:Origin,receipt:Receipt,raw:unknown){
  const request=haReturnAutoDecisionRequest.parse(raw)
  if(request.mediaReviewId!==receipt.request.mediaReviewId||request.channelId!==receipt.request.channelId||request.channelId!==origin.channel.id||request.evidenceMac!==receipt.result.evidenceMac||!receipt.result.bytesAndDecodeComplete)throw new Error('Decisão AUTO não corresponde à revisão/canal/evidência.')
  const assets=new Map(receipt.evidence.localAssets.map(([key,value])=>[key,value as unknown as MediaAsset])),bound=bindReturnAudioEvidence(origin,assets,receipt.evidence.audio)
  if(!bound)throw new Error('Revisão histórica sem recibos de montagem; nova análise necessária.')
  const byKey=new Map(bound.evidence.entries.map(entry=>[entry.mount.key,entry])),overrides:Array<{revisionId:string;itemId:string;mountKey:string;audio:AudioLevel}>=[]
  for(const key of request.mountKeys){
    const row=byKey.get(key)
    if(!row||row.mount.role!=='MASTER'||row.mount.mode!=='AUTO'||row.status!=='MEASURED'||!row.receipt)throw new Error('Escolha AUTO exige master já AUTO e medição local comprovada.')
    const edition=origin.entries.find(entry=>entry.revision.id===row.mount.revisionId),item=edition?.payload.items.find(item=>item.id===row.mount.itemId),original=item?.mediaId?edition?.payload.assets?.find(asset=>asset.id===item.mediaId):undefined,asset=original?assets.get(original.id+':'+original.contentHash):undefined
    if(!edition||!item||!asset||!edition.payload.rate||item.sourceRef||item.liveEndpoint||item.liveConfig?.sourceEndpoint)throw new Error('AUTO de contingência/live exige contrato próprio; não alterar padrão global da mídia.')
    const cut=audioCutIdentity(declaredFileTrim(item,asset,edition.payload.rate),edition.payload.rate),before=resolveAudio(item.audio,asset,item.audioTrack??0,cut).value
    if(before.mode!=='AUTO')throw new Error('Modo editorial mudou; não converter manual para AUTO.')
    const reading=row.receipt.reading
    const audio:AudioLevel={...before,mode:'AUTO',analysisId:'ha-return-auto:'+createHash('sha256').update(JSON.stringify([request.decisionId,key,request.evidenceMac])).digest('hex'),measured:{integratedLufs:reading.integratedLufs,lra:reading.lra,truePeakDbtp:reading.truePeakDbtp,scope:'TRIM',measuredAt:row.receipt.checkedAt,input:{contentHash:row.mount.contentHash,audioTrack:row.mount.audioTrack,routing:row.mount.routing,trim:row.mount.trim}}}
    if(!hasMatchingAudioMeasurement(audio,asset.contentHash,item.audioTrack??0,cut))throw new Error('Medição AUTO não corresponde à montagem.')
    overrides.push({revisionId:row.mount.revisionId,itemId:item.id,mountKey:key,audio})
  }
  return {request,overrides,reviewDatabaseHash:receipt.result.applicationDatabaseHash,evidenceMac:receipt.result.evidenceMac,publicationAuthorized:false as const,qcApproved:false as const,postGainQualified:false as const,busQualified:false as const}
}
const record=z.object({version:z.literal(1),request:haReturnAutoDecisionRequest,owner:z.string(),actor:z.string().min(1).max(256),recordedAt:z.string().datetime(),reviewDatabaseHash:hash,selectedMounts:z.number().int().min(1).max(1000),phase:z.literal('AUTO_DECISION_RECORDED'),publicationAuthorized:z.literal(false),qcApproved:z.literal(false),postGainQualified:z.literal(false),busQualified:z.literal(false)}).strict().refine(v=>v.selectedMounts===v.request.mountKeys.length)
/** Immutable encrypted intent, no native process or mutation of media/QC/items.
 * Store/API enforce stable actor and current-state checks before recording. */
export class HaReturnAutoDecisions{
  constructor(private readonly db:Database.Database,private readonly context:string,private readonly owner:string){
    db.exec('CREATE TABLE IF NOT EXISTS ha_return_auto_decisions(decision_id TEXT PRIMARY KEY,media_review_id TEXT NOT NULL UNIQUE,channel_id TEXT NOT NULL,payload TEXT NOT NULL)')
    db.exec("CREATE TRIGGER IF NOT EXISTS ha_return_auto_no_update BEFORE UPDATE ON ha_return_auto_decisions BEGIN SELECT RAISE(ABORT,'Auto decision is immutable'); END; CREATE TRIGGER IF NOT EXISTS ha_return_auto_no_delete BEFORE DELETE ON ha_return_auto_decisions BEGIN SELECT RAISE(ABORT,'Auto history cannot be deleted'); END; CREATE TRIGGER IF NOT EXISTS ha_return_auto_no_replace BEFORE INSERT ON ha_return_auto_decisions WHEN EXISTS(SELECT 1 FROM ha_return_auto_decisions WHERE decision_id=NEW.decision_id OR media_review_id=NEW.media_review_id) BEGIN SELECT RAISE(ABORT,'Auto decision cannot be replaced'); END;")
  }
  private key(id:string){return 'ha-return-auto-decision:v1:'+this.context+':'+id}
  reservedBytes(){return (this.db.prepare('SELECT count(*) n FROM ha_return_auto_decisions').get() as {n:number}).n*HA_RETURN_AUTO_DECISION_RESERVE}
  existing(raw:unknown){const request=haReturnAutoDecisionRequest.parse(raw);if(!this.db.prepare('SELECT 1 FROM ha_return_auto_decisions WHERE decision_id=?').get(request.decisionId))return null;const prior=this.query(request.decisionId,request.channelId);if(JSON.stringify(prior.request)!==JSON.stringify(request))throw new Error('UUID AUTO pertence a outra intenção.');return prior}
  query(id:string,channelId:string){
    const row=this.db.prepare('SELECT * FROM ha_return_auto_decisions WHERE decision_id=?').get(z.string().uuid().parse(id)) as {decision_id:string;media_review_id:string;channel_id:string;payload:string}|undefined
    if(!row)throw new Error('Decisão AUTO não registrada.')
    const value=record.parse(JSON.parse(installationVault(false).decrypt(row.payload,this.key(id))))
    if(value.request.decisionId!==row.decision_id||value.request.mediaReviewId!==row.media_review_id||value.request.channelId!==row.channel_id||row.channel_id!==channelId)throw new Error('Decisão AUTO diverge do diário/canal.')
    const {owner,...publicValue}=value
    return {...publicValue,ownedHere:owner===this.owner,confirmationIsHistorical:true as const,operationalReady:false as const}
  }
  save(proposal:ReturnType<typeof prepareReturnAutoDecision>,actor:string,current:()=>void){
    return this.db.transaction(()=>{
      current();const request=haReturnAutoDecisionRequest.parse(proposal.request)
      if(this.db.prepare('SELECT 1 FROM ha_return_auto_decisions WHERE decision_id=?').get(request.decisionId)){const prior=this.query(request.decisionId,request.channelId);if(JSON.stringify(prior.request)!==JSON.stringify(request))throw new Error('UUID AUTO pertence a outra intenção.');return prior}
      if((this.db.prepare('SELECT count(*) n FROM ha_return_auto_decisions').get() as {n:number}).n>=1024)throw new Error('Limite de decisões AUTO atingido; preservar histórico.')
      const value=record.parse({version:1,request,owner:this.owner,actor,recordedAt:new Date().toISOString(),reviewDatabaseHash:proposal.reviewDatabaseHash,selectedMounts:proposal.overrides.length,phase:'AUTO_DECISION_RECORDED',publicationAuthorized:false,qcApproved:false,postGainQualified:false,busQualified:false})
      this.db.prepare('INSERT INTO ha_return_auto_decisions VALUES(?,?,?,?)').run(request.decisionId,request.mediaReviewId,request.channelId,installationVault(false).encrypt(JSON.stringify(value),this.key(request.decisionId)))
      current();return this.query(request.decisionId,request.channelId)
    }).immediate()
  }
}

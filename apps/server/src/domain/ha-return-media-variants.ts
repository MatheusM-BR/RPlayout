import {qcApproved,type MediaAsset,type Rate} from '@rplayout/protocol'
import type {HaReturnMediaReviews} from './ha-return-media-review.js'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {HaBindings} from './ha-bindings.js'
import {returnRequiredMedia,verifyReturnLocalMediaBytes,type HaReturnMediaAdapter} from './ha-return-local-media.js'
import {localFileStamp,probeRuntimeHash,assessLocalProbe} from './ha-local-probe.js'
import {materializeHaPayload} from './ha-local-payload.js'
import {bindReturnGraphicEvidence,applyReturnGraphicMounts} from './ha-return-graphics-application.js'
import {bindReturnAudioEvidence,applyReturnAudioMounts} from './ha-return-audio-application.js'
import {createHash} from 'node:crypto'
import {prepareReturnAutoDecision} from './ha-return-auto-decision.js'

type Receipt=ReturnType<HaReturnMediaReviews['privateEvidence']>
/** Fresh bytes/library/QC/runtime check of a PRIVATE historical receipt. Does
 * not decode again, approve media or open an input/output/engine. */
export async function verifyReviewedReturnMedia(origin:ReturnType<typeof readReturnCandidateOrigin>,receipt:Receipt,adapter:HaReturnMediaAdapter,binary:string,signal:AbortSignal,current:()=>void,alive:()=>void=current,graphicBinary:string|null=null,audioBinary:string|null=null,allowPendingAutoDecision=false){
  current();signal.throwIfAborted()
  const required=returnRequiredMedia(origin),saved=new Map(receipt.evidence.required),proofs=new Map(receipt.evidence.evidence),hashes=[...new Set([...required.values()].map(asset=>asset.contentHash))]
  const blocked=allowPendingAutoDecision?receipt.evidence.mounts.some(mount=>mount.errors.some(error=>error!=='SELECTED_AUDIO_MEASUREMENT_MISSING')):receipt.result.blockedMounts>0
  if(required.size!==saved.size||required.size>100000||hashes.length!==proofs.size||[...required].some(([key,asset])=>{const old=saved.get(key);return !old||old.id!==asset.id||old.contentHash!==asset.contentHash||old.kind!==asset.kind})||receipt.request.channelId!==origin.channel.id||!receipt.result.bytesAndDecodeComplete||blocked)throw new Error('Evidência não corresponde à seleção ou possui bloqueios de mídia.')
  const inventory=adapter.lookup(origin.channel.id,hashes)
  const localById=new Map(inventory.assets.map(row=>[row.asset.id,row]))
  if(localById.size!==inventory.assets.length)throw new Error('Acervo possui IDs locais duplicados.')
  if(JSON.stringify(inventory)!==receipt.evidence.inventoryIdentity||await probeRuntimeHash(binary)!==receipt.evidence.runtimeHash)throw new Error('Runtime/acervo/QC mudou após revisão.')
  const runtimeStamp=await localFileStamp(binary)
  const graphics=bindReturnGraphicEvidence(origin,receipt.evidence.graphics)
  const graphicHash=graphics?.evidence.entries.some(row=>row.status==='RENDERED')?graphics.evidence.runtimeHash:null
  if(graphicHash&&(!graphicBinary||await probeRuntimeHash(graphicBinary)!==graphicHash))throw new Error('Runtime gráfico difere do recibo; nova revisão necessária.')
  const graphicStamp=graphicHash&&graphicBinary?await localFileStamp(graphicBinary):null
  const audio=bindReturnAudioEvidence(origin,new Map(receipt.evidence.localAssets.map(([key,value])=>[key,value as unknown as MediaAsset])),receipt.evidence.audio)
  const audioHash=audio?.evidence.entries.some(row=>row.status==='MEASURED')?audio.evidence.runtimeHash:null
  if(audioHash&&(!audioBinary||await probeRuntimeHash(audioBinary)!==audioHash))throw new Error('Runtime de áudio difere do recibo; nova revisão necessária.')
  const audioStamp=audioHash&&audioBinary?await localFileStamp(audioBinary):null
  for(const hash of hashes){
    current();signal.throwIfAborted();const proof=proofs.get(hash)
    if(!proof||!proof.validation.decoded||!proof.validation.probe||!proof.validation.checks.playable||proof.local.ignored===true||!qcApproved(proof.qcStatus))throw new Error('Conteúdo/decodificação/QC não comprovados.')
    const local=localById.get(proof.local.id)
    if(!local||local.asset.contentHash!==hash||local.asset.kind!==proof.local.kind||local.asset.path!==proof.local.path||local.asset.ignored||!qcApproved(local.qcStatus)||local.qcStatus!==proof.qcStatus||!assessLocalProbe(local.asset,proof.validation.probe,inventory.profile,receipt.evidence.checkedAt).checks.playable)throw new Error('QC técnico/editorial local atual não permite mídia.')
    if(await localFileStamp(proof.local.path)!==proof.stamp||await verifyReturnLocalMediaBytes(proof.local.path,hash,signal,alive)!==proof.stamp)throw new Error('Mídia mudou após revisão.')
  }
  if(await localFileStamp(binary)!==runtimeStamp||await probeRuntimeHash(binary)!==receipt.evidence.runtimeHash||JSON.stringify(adapter.lookup(origin.channel.id,hashes))!==receipt.evidence.inventoryIdentity)throw new Error('Runtime/acervo/QC mudou durante reconferência.')
  if(graphicHash&&graphicBinary&&(await localFileStamp(graphicBinary)!==graphicStamp||await probeRuntimeHash(graphicBinary)!==graphicHash))throw new Error('Runtime gráfico mudou durante reconferência.')
  if(audioHash&&audioBinary&&(await localFileStamp(audioBinary)!==audioStamp||await probeRuntimeHash(audioBinary)!==audioHash))throw new Error('Runtime de áudio mudou durante reconferência.')
  current();return {verifiedHashes:hashes.length,publicationAuthorized:false as const,operationalReady:false as const}
}
/** Pure private construction; its output must remain in a new quarantined DB.
 * Explicit cadence/bus equality: never silently reinterpret editorial frames. */
export function prepareReturnMediaVariants(origin:ReturnType<typeof readReturnCandidateOrigin>,receipt:Receipt,plan:ReturnType<HaBindings['executionBindings']>,rate:Rate,audioChannels:number,autoDecisionRequest?:unknown){
  // Recompute overrides from the private evidence, never accept audio values
  // supplied by a browser. Caller must separately prove durable local decision.
  const auto=autoDecisionRequest===undefined?null:prepareReturnAutoDecision(origin,receipt,autoDecisionRequest)
  const adopted=new Set(auto?.overrides.map(row=>JSON.stringify([row.revisionId,row.itemId]))??[])
  const blocked=auto?receipt.evidence.mounts.some(check=>check.errors.some(error=>error!=='SELECTED_AUDIO_MEASUREMENT_MISSING'||!adopted.has(JSON.stringify([check.revisionId,check.itemId])))):receipt.result.blockedMounts>0
  if(receipt.request.channelId!==origin.channel.id||!receipt.result.bytesAndDecodeComplete||blocked||![2,8,16].includes(audioChannels)||!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0)throw new Error('Mídia/canal/cadência/barramento não admitidos para derivar.')
  const required=returnRequiredMedia(origin),proofs=new Map(receipt.evidence.evidence),assets=new Map(receipt.evidence.localAssets.map(([key,value])=>[key,value as unknown as MediaAsset])),paths=new Map<string,string>()
  const graphics=bindReturnGraphicEvidence(origin,receipt.evidence.graphics)
  const audio=bindReturnAudioEvidence(origin,assets,receipt.evidence.audio)
  for(const [key,original] of required){
    const proof=proofs.get(original.contentHash),local=assets.get(key)
    if(!proof||!local||local.id!==original.id||local.kind!==original.kind||local.contentHash!==original.contentHash||local.path!==proof.local.path||!proof.validation.decoded||!proof.validation.checks.playable||proof.local.ignored===true||!qcApproved(proof.qcStatus))throw new Error('Versão local/QC/evidência incompleta.')
    paths.set(original.contentHash,local.path);assets.set(key,{...local,qcStatus:proof.qcStatus as MediaAsset['qcStatus'],ignored:false})
  }
  const variants=origin.entries.map(entry=>{
    if(entry.payload.rate?.num!==rate.num||entry.payload.rate?.den!==rate.den||entry.payload.audioChannels!==audioChannels)throw new Error('Edição difere da cadência/barramento local; exige decisão explícita, não conversão implícita.')
    const overrides=auto?.overrides.filter(row=>row.revisionId===entry.revision.id)??[]
    if(new Set(entry.payload.items.map(item=>item.id)).size!==entry.payload.items.length)throw new Error('Itens duplicados impedem adoção AUTO inequívoca.')
    const input=overrides.length?{...entry.payload,items:entry.payload.items.map(item=>{const override=overrides.find(row=>row.itemId===item.id);return override?{...item,audio:structuredClone(override.audio)}:item})}:entry.payload
    const variant=materializeHaPayload(input as unknown as Record<string,unknown>,entry.revision.id,plan,paths,assets,rate,audioChannels)
    if(overrides.some(row=>!variant.checks.some(check=>check.itemId===row.itemId&&!check.errors.includes('SELECTED_AUDIO_MEASUREMENT_MISSING'))))throw new Error('AUTO não corresponde à montagem derivada.')
    const graphicEntries=graphics?.byRevision.get(entry.revision.id)
    if(graphicEntries)applyReturnGraphicMounts(variant.checks,graphicEntries)
    const audioEntries=audio?.byRevision.get(entry.revision.id)??[],audioIssues=audio?.evidence.issues.filter(issue=>issue.revisionId===entry.revision.id)??[]
    if(audio)applyReturnAudioMounts(variant.checks,audioEntries,audioIssues)
    const payload={...variant.payload,assets:(variant.payload.assets??[]).map(asset=>({...asset,qcStatus:assets.get(asset.id+':'+asset.contentHash)!.qcStatus,ignored:false})),haReturnMediaOrigin:{version:1,mediaReviewId:receipt.request.mediaReviewId,applicationId:receipt.request.applicationId,evidenceMac:receipt.result.evidenceMac,mediaEvidenceApplied:true,nativePrepared:false,authorityTransferred:false},...(graphics?{haReturnGraphicsOrigin:{version:1,mediaReviewId:receipt.request.mediaReviewId,evidenceMac:receipt.result.evidenceMac,runtimeHash:graphics.evidence.runtimeHash,entries:graphicEntries,renderEvidenceApplied:true,visualApproved:false,nativePrepared:false,authorityTransferred:false,publicationAuthorized:false}}:{})}
    const derived=audio?{...payload,haReturnAudioOrigin:{version:1,mediaReviewId:receipt.request.mediaReviewId,evidenceMac:receipt.result.evidenceMac,runtimeHash:audio.evidence.runtimeHash,entries:audioEntries,issues:audioIssues,preGainEvidenceApplied:true,autoApplied:overrides.length>0,...(auto?{autoDecisionId:auto.request.decisionId,autoMountKeys:overrides.map(row=>row.mountKey)}:{}),postGainQualified:false,busQualified:false,nativePrepared:false,authorityTransferred:false,publicationAuthorized:false}}:payload
    // Include the actual adopted values/provenance in the derivative identity.
    const id=auto?'ha-local:'+createHash('sha256').update(JSON.stringify([entry.revision.id,plan.planId,plan.bindingDigest,derived])).digest('hex'):variant.id
    return {...variant,id,payload:derived,sourceRevisionId:entry.revision.id}
  })
  return {variants,paths,localAssets:assets,...(auto?{autoDecisionId:auto.request.decisionId,autoAppliedMounts:auto.overrides.length}:{}),publicationAuthorized:false as const,operationalReady:false as const}
}

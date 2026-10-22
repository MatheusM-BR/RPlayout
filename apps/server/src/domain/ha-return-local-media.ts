import {and,asc,eq,inArray,or,sql} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import {lstat,open} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {qcApproved,type MediaAsset,type QcProfile} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,mediaAssets,qcDecisions} from '../db/schema.js'
import {toAsset} from '../db/repo.js'
import {assessLocalProbe,localFileStamp,probeRuntimeHash,runLocalProbe,type LocalProbeRunner} from './ha-local-probe.js'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import {inspectHaLocalMount,inspectHaLocalGraphics,type LocalMountCheck} from './ha-local-payload.js'
import {installationVault} from './secret-vault.js'
import {reviewReturnGraphics,type ReturnGraphicJob} from './ha-return-graphics-review.js'
import {planReturnAudioMounts} from './ha-return-audio-mounts.js'
import {reviewReturnAudio} from './ha-return-audio-review.js'

export interface HaReturnMediaInventory {profile:QcProfile|undefined;assets:Array<{asset:MediaAsset;qcStatus:string|null}>}
export interface HaReturnMediaAdapter {lookup(channelId:string,hashes:string[]):HaReturnMediaInventory}
/** Primary library lookup, including assets not referenced by its current
 * playlist. Foreign asset IDs/path strings are never used as file locations. */
export function primaryReturnMediaAdapter(db:Db):HaReturnMediaAdapter{
  return {lookup(channelId,hashes){
    if(hashes.length>100000||new Set(hashes).size!==hashes.length||hashes.some(hash=>!/^[a-f0-9]{64}$/.test(hash)))throw new Error('Inventário de hashes inválido/excessivo.')
    return db.transaction(tx=>{
      const channel=tx.select().from(channels).where(eq(channels.id,channelId)).get()
      if(!channel)throw new Error('Canal local ausente.')
      const assets:HaReturnMediaInventory['assets']=[];let decisionsCount=0
      for(let offset=0;offset<hashes.length;offset+=256){
        const rows=tx.select().from(mediaAssets).where(inArray(mediaAssets.contentHash,hashes.slice(offset,offset+256))).orderBy(asc(mediaAssets.id)).limit(100001).all()
        if(assets.length+rows.length>100000)throw new Error('Acervo correspondente excede limite; não truncar como pronto.')
        const latest=new Map<string,string>()
        for(let first=0;first<rows.length;first+=256){
          const decisions=tx.select().from(qcDecisions).where(and(inArray(qcDecisions.assetId,rows.slice(first,first+256).map(row=>row.id)),or(eq(qcDecisions.channelId,channelId),eq(qcDecisions.channelId,'@all')))).orderBy(asc(sql`rowid`)).limit(500001).all()
          decisionsCount+=decisions.length;if(decisionsCount>500000)throw new Error('Histórico de QC excede limite.')
          for(const decision of decisions)latest.set(decision.assetId+':'+decision.contentHash,decision.status)
        }
        for(const row of rows)assets.push({asset:toAsset(row),qcStatus:latest.get(row.id+':'+row.contentHash)??null})
      }
      return {profile:channel.qcProfile??undefined,assets}
    })
  }}
}
async function ancestors(file:string){let cursor=dirname(resolve(file));for(;;){const info=await lstat(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Mídia local não pode atravessar links/junções.');const parent=dirname(cursor);if(parent===cursor)return;cursor=parent}}
/** Hashes only a path returned by the local-library adapter. No shell / foreign
 * path fallback. Cancellation checked between bounded reads. */
export async function verifyReturnLocalMediaBytes(file:string,expectedHash:string,signal:AbortSignal,alive:()=>void){
  if(!/^[a-f0-9]{64}$/.test(expectedHash))throw new Error('SHA inválido.')
  await ancestors(file);const stamp=await localFileStamp(file),info=await lstat(file)
  if(info.nlink!==1||info.size<=0||info.size>16*1024**3)throw new Error('Mídia excede limite ou possui múltiplos vínculos.')
  const handle=await open(file,'r')
  try{
    const opened=await handle.stat();if(opened.dev!==info.dev||opened.ino!==info.ino||opened.size!==info.size||opened.nlink!==1)throw new Error('Mídia mudou antes da leitura.')
    const digest=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0
    while(offset<info.size){signal.throwIfAborted();alive();const read=await handle.read(buffer,0,Math.min(buffer.length,info.size-offset),offset);if(!read.bytesRead)throw new Error('Mídia truncada.');digest.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead}
    const after=await handle.stat()
    if(digest.digest('hex')!==expectedHash||after.dev!==info.dev||after.ino!==info.ino||after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs||after.nlink!==1||await localFileStamp(file)!==stamp)throw new Error('Mídia diverge do SHA ou mudou durante leitura.')
    signal.throwIfAborted();alive();return stamp
  }finally{await handle.close()}
}
export function returnRequiredMedia(origin:ReturnType<typeof readReturnCandidateOrigin>){
  const requirements=new Map<string,MediaAsset>()
  for(const {payload} of origin.entries){
    const assets=new Map((payload.assets??[]).map(asset=>[asset.id,asset]))
    if(assets.size!==(payload.assets??[]).length)throw new Error('Mídias publicadas duplicadas.')
    for(const item of payload.items)for(const id of new Set([item.mediaId,item.liveFallbackMediaId,item.liveConfig?.fallbackMediaId].filter((id):id is string=>typeof id==='string'&&!!id))){
      const asset=assets.get(id)
      if(!asset||!/^[a-f0-9]{64}$/.test(asset.contentHash)||!['VIDEO','AUDIO','STILL'].includes(asset.kind))throw new Error('Versão publicada ausente/inválida.')
      const key=asset.id+':'+asset.contentHash,existing=requirements.get(key)
      if(existing&&existing.kind!==asset.kind)throw new Error('Versão com tipo conflitante.')
      requirements.set(key,asset);if(requirements.size>100000)throw new Error('Requisitos de mídia excedem limite.')
    }
  }
  return requirements
}
export const returnMediaInventoryMac=(applicationId:string,applicationHash:string,inventory:HaReturnMediaInventory)=>installationVault(false).reviewIdentity(JSON.stringify([applicationId,applicationHash,inventory]),'ha-return-media-inventory:v1')
export function selectReturnLocalMedia(rows:HaReturnMediaInventory['assets'],hash:string,kind:MediaAsset['kind'],localAssetId?:string){return rows.filter(row=>row.asset.contentHash===hash&&row.asset.kind===kind&&(!localAssetId||row.asset.id===localAssetId))}
/** Sanitized chooser; no path, native probe output or inherited credentials. */
export function returnLocalMediaOptions(origin:ReturnType<typeof readReturnCandidateOrigin>,inventory:HaReturnMediaInventory,applicationId:string,applicationHash:string){
  const required=returnRequiredMedia(origin),groups=new Map<string,MediaAsset[]>()
  for(const asset of required.values()){const rows=groups.get(asset.contentHash)??[];rows.push(asset);groups.set(asset.contentHash,rows)}
  if(groups.size>1000)throw new Error('Seletor excede mil conteúdos; não truncar escolhas como completas.')
  const locals=new Map<string,HaReturnMediaInventory['assets']>()
  for(const row of inventory.assets){const rows=locals.get(row.asset.contentHash)??[];rows.push(row);locals.set(row.asset.contentHash,rows)}
  let count=0
  const media=[...groups].map(([contentHash,assets])=>{
    const kind=assets[0]!.kind;if(assets.some(asset=>asset.kind!==kind))throw new Error('SHA com tipos conflitantes.')
    const candidates=selectReturnLocalMedia(locals.get(contentHash)??[],contentHash,kind).map(row=>({id:row.asset.id,title:row.asset.title,kind:row.asset.kind,qcStatus:row.qcStatus,ignored:!!row.asset.ignored}))
    count+=candidates.length;if(count>10000)throw new Error('Opções locais excedem limite; não truncar como completas.')
    return {contentHash,kind,titles:[...new Set(assets.map(asset=>asset.title))],candidates}
  })
  return {version:1 as const,applicationId,channelId:origin.channel.id,applicationDatabaseHash:applicationHash,inventoryMac:returnMediaInventoryMac(applicationId,applicationHash,inventory),media,physicalBytesValidated:false as const,operationalReady:false as const}
}
/** Produces PRIVATE evidence only, not an approved playlist or public response.
 * Same SHA decoded once; every selected cut/track/mix is assessed independently. */
export async function inspectReturnLocalMedia(origin:ReturnType<typeof readReturnCandidateOrigin>,adapter:HaReturnMediaAdapter,binary:string,signal:AbortSignal,current:()=>void,alive:()=>void=current,runner:LocalProbeRunner=runLocalProbe.bind(null,binary),choices:ReadonlyMap<string,string>=new Map(),expectedInventoryMac?:{applicationId:string;applicationHash:string;mac:string},graphicBinary:string|null=null,audioBinary:string|null=null){
  current();signal.throwIfAborted()
  const required=returnRequiredMedia(origin),hashes=[...new Set([...required.values()].map(asset=>asset.contentHash))],inventory=adapter.lookup(origin.channel.id,hashes)
  const hashSet=new Set(hashes)
  if([...choices.keys()].some(hash=>!hashSet.has(hash)))throw new Error('Escolha não pertence às mídias selecionadas.')
  if(expectedInventoryMac&&returnMediaInventoryMac(expectedInventoryMac.applicationId,expectedInventoryMac.applicationHash,inventory)!==expectedInventoryMac.mac)throw new Error('Acervo/QC mudou após a escolha; atualizar conferência.')
  const publishedByHash=new Map<string,MediaAsset[]>(),localByHash=new Map<string,HaReturnMediaInventory['assets']>()
  for(const asset of required.values()){const rows=publishedByHash.get(asset.contentHash)??[];rows.push(asset);publishedByHash.set(asset.contentHash,rows)}
  for(const row of inventory.assets){const rows=localByHash.get(row.asset.contentHash)??[];rows.push(row);localByHash.set(row.asset.contentHash,rows)}
  const inventoryIdentity=JSON.stringify(inventory),runtimeStamp=await localFileStamp(binary),runtimeHash=await probeRuntimeHash(binary),checkedAt=new Date().toISOString()
  const evidence=new Map<string,{local:MediaAsset;qcStatus:string|null;stamp:string;validation:ReturnType<typeof assessLocalProbe>}|null>(),failures=new Map<string,string>()
  for(const hash of hashes){
    current();signal.throwIfAborted()
    const sources=publishedByHash.get(hash)!,kind=sources[0]!.kind
    if(sources.some(asset=>asset.kind!==kind))throw new Error('SHA com tipos publicados conflitantes.')
    const candidates=selectReturnLocalMedia(localByHash.get(hash)??[],hash,kind,choices.get(hash))
    // Stable local choice; absence or ambiguity never selects a foreign path.
    if(candidates.length!==1){evidence.set(hash,null);failures.set(hash,choices.has(hash)?'LOCAL_MEDIA_CHOICE_UNAVAILABLE':candidates.length?'LOCAL_MEDIA_AMBIGUOUS':'LOCAL_MEDIA_MISSING');continue}
    const chosen=candidates[0]!
    try{
      const stamp=await verifyReturnLocalMediaBytes(chosen.asset.path,hash,signal,alive)
      const raw=await runner(chosen.asset.path,signal);current()
      if(await localFileStamp(chosen.asset.path)!==stamp)throw new Error('Mídia mudou durante decode.')
      await verifyReturnLocalMediaBytes(chosen.asset.path,hash,signal,alive)
      evidence.set(hash,{local:chosen.asset,qcStatus:chosen.qcStatus,stamp,validation:assessLocalProbe(chosen.asset,raw,inventory.profile,checkedAt)})
    }catch{signal.throwIfAborted();current();evidence.set(hash,null);failures.set(hash,'LOCAL_BYTES_OR_DECODE_FAILED')}
  }
  if(await localFileStamp(binary)!==runtimeStamp||await probeRuntimeHash(binary)!==runtimeHash||JSON.stringify(adapter.lookup(origin.channel.id,hashes))!==inventoryIdentity)throw new Error('Runtime/acervo/QC mudou durante análise.')
  current()
  const mounts:LocalMountCheck[]=[],localAssets=new Map<string,MediaAsset>(),graphicJobs:ReturnGraphicJob[]=[]
  for(const [key,original] of required){const proof=evidence.get(original.contentHash);if(proof){const probe=proof.validation.probe;localAssets.set(key,{...original,path:proof.local.path,durationNs:probe?.durationNs??null,probe:probe?.video?{codec:probe.videoCodec??null,width:probe.video.width,height:probe.video.height,rate:{num:probe.video.rateNum,den:probe.video.rateDen},interlaceMode:probe.video.interlaceMode,hasAudio:Boolean(probe.audio),audioChannels:probe.audio?.channels??0,audioTracks:probe.audioTracks??[]}:null,audioMetadata:{hasAudio:Boolean(probe?.audio),channels:probe?.audio?.channels??0,tracks:probe?.audioTracks??[]},loudnessFile:proof.validation.loudnessFile,probeError:proof.validation.decoded?null:'Decode local não comprovado.'})}}
  for(const entry of origin.entries){
    const {payload}=entry,rate=payload.rate,audioChannels=payload.audioChannels
    if(!rate||!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0||![2,8,16].includes(audioChannels??0))throw new Error('Edição sem cadência/barramento explícitos.')
    const assets=new Map((payload.assets??[]).map(asset=>[asset.id,asset]))
    const check=(item:Parameters<typeof inspectHaLocalMount>[0],assetId:string,id:string,title:string)=>{
      const mount:LocalMountCheck={revisionId:entry.revision.id,itemId:id,title,errors:[],warnings:[],livePending:false},original=assets.get(assetId),proof=original?evidence.get(original.contentHash):null
      if(!original||!proof)mount.errors.push(original?failures.get(original.contentHash)??'LOCAL_MEDIA_MISSING':'PUBLISHED_MEDIA_VERSION_MISSING')
      else{if(proof.local.ignored||!qcApproved(proof.qcStatus))mount.errors.push('PRIMARY_QC_NOT_APPROVED');if(!proof.validation.checks.playable)mount.errors.push('LOCAL_TECHNICAL_QC_FAILED');inspectHaLocalMount(item,localAssets.get(original.id+':'+original.contentHash)!,rate,audioChannels!,mount)}
      mounts.push(mount);if(mounts.length>100000)throw new Error('Montagens excedem limite.')
    }
    for(const item of payload.items){
      for(const id of new Set([item.liveFallbackMediaId,item.liveConfig?.fallbackMediaId].filter((id):id is string=>typeof id==='string'&&!!id)))check({trim:null,audio:null,audioTrack:null},id,item.id+':fallback:'+id,item.title+' — contingência')
      if(item.sourceRef||item.liveEndpoint||item.liveConfig?.sourceEndpoint){mounts.push({revisionId:entry.revision.id,itemId:item.id,title:item.title,errors:[],warnings:['LIVE_SIGNAL_LOCAL_PENDING'],livePending:true});if(mounts.length>100000)throw new Error('Montagens excedem limite.');continue}
      if(item.type!=='GFX')check(item,item.mediaId??'',item.id,item.title)
    }
    mounts.push(...inspectHaLocalGraphics(payload,entry.revision.id,(check,svg)=>graphicJobs.push({check,svg})))
    if(mounts.length>100000)throw new Error('Montagens excedem limite; não truncar como prontas.')
  }
  const graphics=await reviewReturnGraphics(graphicJobs,graphicBinary,signal,alive)
  const audio=await reviewReturnAudio(planReturnAudioMounts(origin,localAssets),audioBinary,signal,alive)
  const byMount=new Map<string,LocalMountCheck[]>()
  for(const mount of mounts){const key=JSON.stringify([mount.revisionId,mount.itemId]),rows=byMount.get(key)??[];rows.push(mount);byMount.set(key,rows)}
  for(const issue of audio.evidence.issues)for(const mount of byMount.get(JSON.stringify([issue.revisionId,issue.itemId]))??[]){mount.errors.push(...issue.errors);mount.warnings.push(...issue.warnings)}
  for(const entry of audio.evidence.entries)for(const mount of byMount.get(JSON.stringify([entry.mount.revisionId,entry.mount.itemId]))??[]){
    if(entry.status==='FAILED')mount.errors.push('LOCAL_SELECTED_AUDIO_RENDER_FAILED')
    else if(entry.status==='UNAVAILABLE')mount.warnings.push('LOCAL_SELECTED_AUDIO_RUNTIME_UNAVAILABLE')
    else mount.warnings.push('LOCAL_SELECTED_AUDIO_POSTGAIN_BUS_QUALIFICATION_PENDING')
  }
  if(await localFileStamp(binary)!==runtimeStamp||await probeRuntimeHash(binary)!==runtimeHash||JSON.stringify(adapter.lookup(origin.channel.id,hashes))!==inventoryIdentity)throw new Error('Runtime/acervo/QC mudou durante revisão de grafismos.')
  for(const proof of evidence.values())if(proof){signal.throwIfAborted();alive();await ancestors(proof.local.path);if(await localFileStamp(proof.local.path)!==proof.stamp)throw new Error('Mídia mudou antes da confirmação da revisão.')}
  current()
  const verifiedHashes=[...evidence.values()].filter(proof=>proof?.validation.decoded).length
  return {checkedAt,runtimeHash,inventoryIdentity,required,evidence,localAssets,mounts,graphics,audio,reviewCompleted:true as const,requiredHashes:hashes.length,verifiedHashes,bytesAndDecodeComplete:verifiedHashes===hashes.length,publicationAuthorized:false as const,operationalReady:false as const}
}

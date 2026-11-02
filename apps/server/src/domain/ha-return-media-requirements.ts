import {qcApproved,type MediaAsset} from '@rplayout/protocol'
import {readOperationalPayload,type OperationalPayload} from './operational-playlist.js'
import {inspectHaLocalMount,type LocalMountCheck} from './ha-local-payload.js'
import type {HaSnapshot} from './ha-replication.js'

/** Requirements from the authentic primary snapshot only. Never follows a
 * returned disk path, equates metadata with decoded bytes, or binds live inputs. */
export function returnMediaRequirements(primary:HaSnapshot['channels'][number]){
  const localAssets=new Map<string,MediaAsset>()
  const add=(asset:MediaAsset)=>{if(typeof asset.id!=='string'||typeof asset.contentHash!=='string'||!/^[a-f0-9]{64}$/i.test(asset.contentHash))return;const key=asset.id+':'+asset.contentHash.toLowerCase();if(!localAssets.has(key))localAssets.set(key,asset)}
  for(const revision of primary.revisions)for(const asset of readOperationalPayload(revision.payload as Record<string,unknown>).assets??[])add(asset)
  if(Array.isArray(primary.configuration.mediaFacts))for(const row of primary.configuration.mediaFacts){const asset=row as MediaAsset;if(asset&&typeof asset==='object'&&typeof asset.id==='string'&&typeof asset.contentHash==='string')localAssets.set(asset.id+':'+asset.contentHash.toLowerCase(),asset)}
  const decisions=Array.isArray(primary.configuration.qc)?primary.configuration.qc as Array<{assetId?:unknown;contentHash?:unknown;channelId?:unknown;status?:unknown}>:[]
  if(localAssets.size>100000||decisions.length>500000)throw new Error('Inventário de mídia/QC excede limite.')
  const latest=new Map<string,unknown>()
  for(const row of decisions)if(typeof row.assetId==='string'&&typeof row.contentHash==='string'&&(row.channelId===primary.channelId||row.channelId==='@all'))latest.set(row.assetId+':'+row.contentHash.toLowerCase(),row.status)
  return (payload:OperationalPayload)=>{
    const rate=payload.rate,audioChannels=payload.audioChannels
    if(!rate||!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0||![2,8,16].includes(audioChannels??0))throw new Error('Edição recebida sem cadência/barramento explícitos para revisar montagem.')
    const assets=new Map((payload.assets??[]).map(asset=>[asset.id,asset])),checks:LocalMountCheck[]=[]
    const append=(check:LocalMountCheck)=>{if(checks.length>=100000)throw new Error('Montagens da edição excedem limite.');checks.push(check)}
    const inspect=(item:Parameters<typeof inspectHaLocalMount>[0],assetId:string|null|undefined,itemId:string)=>{
      const check:LocalMountCheck={itemId,errors:[],warnings:[],livePending:false};append(check)
      const asset=assetId?assets.get(assetId):null
      if(!asset||typeof asset.contentHash!=='string'||!/^[a-f0-9]{64}$/i.test(asset.contentHash)){check.errors.push('PUBLISHED_MEDIA_VERSION_MISSING');return}
      const key=asset.id+':'+asset.contentHash.toLowerCase(),local=localAssets.get(key)
      if(!local){check.errors.push('MEDIA_VERSION_NOT_IN_PRIMARY_SNAPSHOT');return}
      if(!qcApproved(typeof latest.get(key)==='string'?latest.get(key) as string:null))check.errors.push('PRIMARY_QC_NOT_APPROVED')
      inspectHaLocalMount(item,local,rate,audioChannels!,check)
      check.warnings.push('LOCAL_BYTES_AND_DECODE_REVALIDATION_REQUIRED')
    }
    for(const item of payload.items){
      for(const fallbackId of new Set([item.liveFallbackMediaId,item.liveConfig?.fallbackMediaId].filter((id):id is string=>typeof id==='string'&&!!id)))inspect({trim:null,audio:null,audioTrack:null},fallbackId,item.id+':fallback:'+fallbackId)
      if(item.sourceRef||item.liveEndpoint||item.liveConfig?.sourceEndpoint){append({itemId:item.id,errors:['LIVE_LOCAL_BINDING_AND_SIGNAL_REQUIRED'],warnings:[],livePending:true});continue}
      if(item.type!=='GFX')inspect(item,item.mediaId,item.id)
    }
    return checks
  }
}

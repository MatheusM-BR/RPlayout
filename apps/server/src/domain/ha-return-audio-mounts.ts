import {createHash} from 'node:crypto'
import {audioCutIdentity,audioRoutingKey,knownInputAudioChannels,resolveAudio,resolvedAudioRouting,validateAudioRouting,validateAuxiliaryPairs,type AudioRouting,type MediaAsset} from '@rplayout/protocol'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import {declaredFileTrim} from './execution-trim.js'

export interface ReturnAudioMount {
  key:string;revisionId:string;itemId:string;role:'MASTER'|'AUXILIARY';outputPair:number
  contentHash:string;audioTrack:number;routing:AudioRouting;trim:{inNs:number;outNs:number}
  gainDb:number;mode:string;path:string
}
export interface ReturnAudioMountIssue {revisionId:string;itemId:string;errors:string[];warnings:string[]}
export function returnAudioMountKey(mount:Omit<ReturnAudioMount,'key'|'path'>){
  return createHash('sha256').update(JSON.stringify([mount.revisionId,mount.itemId,mount.role,mount.outputPair,mount.contentHash,mount.audioTrack,audioRoutingKey(mount.routing),mount.trim,mount.gainDb,mount.mode])).digest('hex')
}
/** Plan from frozen items and locally decoded media ONLY. Paths are private.
 * Auxiliary input pairs are measured separately, not mistaken for master mix. */
export function planReturnAudioMounts(origin:ReturnType<typeof readReturnCandidateOrigin>,localAssets:ReadonlyMap<string,MediaAsset>){
  const mounts:ReturnAudioMount[]=[],issues:ReturnAudioMountIssue[]=[]
  for(const entry of origin.entries){
    const {payload}=entry,rate=payload.rate,bus=payload.audioChannels
    if(!rate||!Number.isSafeInteger(rate.num)||!Number.isSafeInteger(rate.den)||rate.num<=0||rate.den<=0||![2,8,16].includes(bus??0))throw new Error('Montagem de áudio sem cadência/barramento explícitos.')
    const originals=new Map((payload.assets??[]).map(asset=>[asset.id,asset]))
    for(const item of payload.items){
      const references:Array<{id:string;itemId:string;fallback:boolean}>=[]
      for(const id of new Set([item.liveFallbackMediaId,item.liveConfig?.fallbackMediaId].filter((id):id is string=>!!id)))references.push({id,itemId:item.id+':fallback:'+id,fallback:true})
      if(!item.sourceRef&&!item.liveEndpoint&&!item.liveConfig?.sourceEndpoint&&item.type!=='GFX'&&item.mediaId)references.push({id:item.mediaId,itemId:item.id,fallback:false})
      for(const reference of references){
        const issue:ReturnAudioMountIssue={revisionId:entry.revision.id,itemId:reference.itemId,errors:[],warnings:[]};issues.push(issue)
        if(issues.length>100000)throw new Error('Montagens de áudio excedem limite; não truncar como prontas.')
        try{
          const original=originals.get(reference.id),asset=original?localAssets.get(original.id+':'+original.contentHash):undefined
          if(!asset||!original||asset.contentHash!==original.contentHash||asset.kind!==original.kind||!/^[a-f0-9]{64}$/.test(asset.contentHash)||!asset.path||asset.probeError)throw new Error('LOCAL_AUDIO_MEDIA_UNPROVEN')
          if(asset.kind==='STILL')continue
          const track=reference.fallback?0:item.audioTrack??0,known=knownInputAudioChannels(asset,track)
          if(!Number.isInteger(track)||track<0||track>63)throw new Error('LOCAL_AUDIO_TRACK_INVALID')
          if(known===0){if(track>0)throw new Error('LOCAL_AUDIO_TRACK_INVALID');continue} // Explicit absence, not guessed silence.
          if(known===undefined||known>64)throw new Error('LOCAL_AUDIO_CHANNELS_UNPROVEN')
          const cut=audioCutIdentity(declaredFileTrim(reference.fallback?{trim:null,durationOverride:null}:item,asset,rate),rate)
          if(cut.outNs-cut.inNs<400_000_000){issue.warnings.push('LOCAL_AUDIO_SHORT_CUT_QUALIFICATION_PENDING');continue}
          const audio=resolveAudio(reference.fallback?null:item.audio,asset,track,cut).value,routing=resolvedAudioRouting(audio),pairs=audio.auxiliaryPairs??[]
          if(validateAudioRouting(routing,known)||validateAuxiliaryPairs(pairs,bus!,known))throw new Error('LOCAL_AUDIO_ROUTING_INVALID')
          const append=(role:'MASTER'|'AUXILIARY',outputPair:number,selected:AudioRouting,gainDb:number)=>{
            if(!Number.isFinite(gainDb)||gainDb<-60||gainDb>12)throw new Error('LOCAL_AUDIO_GAIN_INVALID')
            const identity={revisionId:entry.revision.id,itemId:reference.itemId,role,outputPair,contentHash:asset.contentHash,audioTrack:track,routing:selected,trim:cut,gainDb,mode:audio.mode}
            mounts.push({...identity,key:returnAudioMountKey(identity),path:asset.path})
          }
          append('MASTER',1,routing,audio.gainDb)
          for(const pair of pairs){
            const matrix=[Array<number>(known).fill(0),Array<number>(known).fill(0)]
            matrix[0]![(pair.inputPair-1)*2]=1;matrix[1]![(pair.inputPair-1)*2+1]=1
            append('AUXILIARY',pair.outputPair,{mode:'MATRIX',matrix},pair.gainDb??0)
          }
        }catch(error){issue.errors.push(error instanceof Error&&/^LOCAL_AUDIO_[A-Z_]+$/.test(error.message)?error.message:'LOCAL_AUDIO_MOUNT_INVALID')}
        if(mounts.length>100000||issues.length>100000)throw new Error('Montagens de áudio excedem limite; não truncar como prontas.')
      }
    }
  }
  if(new Set(mounts.map(mount=>mount.key)).size!==mounts.length)throw new Error('Montagens de áudio duplicadas.')
  return {mounts,issues,postGainQualified:false as const,busQualified:false as const,publicationAuthorized:false as const}
}

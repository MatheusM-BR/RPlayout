import {channelConfigurationETag,type Channel} from '@rplayout/protocol'
export function configurationHeaders(id:string,revision:number|undefined):Record<string,string>{
  if(revision===undefined)throw new Error('A tela não tem a revisão de configuração. Reabra o canal antes de salvar; seus campos não foram enviados.')
  return {'If-Match':channelConfigurationETag(id,revision)}
}
/** A background list refresh cannot authorize fields from an older draft. */
export function captureConfigurationRevision(id:string,baseline:number|undefined,loaded:number,reopen=false):number{
  configurationHeaders(id,loaded)
  return baseline===undefined || reopen ? loaded : baseline
}
export type ConfigurationFields=Partial<Pick<Channel,'name'|'width'|'height'|'scan'|'fieldOrder'|'targetLufs'|'ceilingDbtp'|'audioChannels'>>&{rateNum?:number;rateDen?:number}
/** Baseline is captured on opening; callers must not swap in a newer prop. */
export function channelConfigurationPatch(baseline:Channel,edited:ConfigurationFields):ConfigurationFields&{expectedAudioChannels?:2|8|16}{
  const original={name:baseline.name,width:baseline.width,height:baseline.height,scan:baseline.scan,fieldOrder:baseline.fieldOrder,targetLufs:baseline.targetLufs,ceilingDbtp:baseline.ceilingDbtp,audioChannels:baseline.audioChannels??2,rateNum:baseline.rate.num,rateDen:baseline.rate.den}
  const patch=Object.fromEntries(Object.entries(edited).filter(([key,value])=>value!==undefined&&value!==original[key as keyof typeof original])) as ConfigurationFields&{expectedAudioChannels?:2|8|16}
  if(patch.audioChannels!==undefined)patch.expectedAudioChannels=original.audioChannels
  return patch
}

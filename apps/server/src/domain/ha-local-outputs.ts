import {fileURLToPath} from 'node:url'
import {isAbsolute} from 'node:path'
import {z} from 'zod'
import type {HaBindings} from './ha-bindings.js'
import {encodeProfile,validateOutputProfile,type OutputProfileRow} from './outputs.js'

const nullableInteger=z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null)
const profile=z.object({id:z.string().min(1),channelId:z.string().min(1),name:z.string(),
  kind:z.enum(['RTMP','SRT','FILE','SDI','NDI','OMT']),role:z.enum(['PROGRAM','PREVIEW','MONITOR','EXTRA']),
  target:z.string(),enabled:z.boolean(),width:nullableInteger,height:nullableInteger,
  rateNum:nullableInteger,rateDen:nullableInteger,bitrateKbps:nullableInteger,
  scan:z.enum(['PROGRESSIVE','INTERLACED']).nullable().default(null),createdAt:z.string(),
}).passthrough()

/** Pure preparation only. Never opens a publisher, derives a loopback address,
 * reads deployment environment or treats an original target as a local one. */
export function prepareHaLocalOutputs(channel:{id:string;width:number;height:number;programSdiDeviceId?:string|null},original:unknown,plan:ReturnType<HaBindings['executionBindings']>){
  const rows=z.array(profile).max(256).parse(original??[]).filter(row=>row.enabled)
  if(rows.some(row=>row.channelId!==channel.id)||new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('Perfis HA duplicados ou de outro canal.')
  const required=rows.map(row=>row.id)
  if(channel.programSdiDeviceId)required.push('@masterSDI')
  if(new Set(required).size!==required.length||plan.outputs.length!==required.length||new Set(plan.outputs.map(row=>row.outputId)).size!==required.length||plan.outputs.some(row=>!required.includes(row.outputId)))throw new Error('Plano local não cobre exatamente as saídas habilitadas da origem.')
  const program:string[]=[],preview:string[]=[],disabled:Array<{outputId:string;reason:string}>=[]
  for(const id of required){
    const binding=plan.outputs.find(row=>row.outputId===id)!
    const row=rows.find(row=>row.id===id)
    const kind=row?(row.role==='PROGRAM'?'RTMP':row.role==='PREVIEW'||row.role==='MONITOR'?'SRT':row.kind):'SDI'
    if(binding.kind!==kind)throw new Error('Protocolo do destino local diverge do perfil efetivo; refaça a seleção local.')
    if(binding.target===null){
      if(!binding.reason?.trim())throw new Error('Saída desativada exige motivo explícito.')
      disabled.push({outputId:id,reason:binding.reason});continue
    }
    if(binding.reason!==null||!binding.target.trim()||binding.target.includes('REDACTED'))throw new Error('Destino local incompleto ou acompanhado de motivo de desativação.')
    let target=binding.target
    if(kind==='SDI'){
      target=target.replace(/^sdi:/i,'')
      if(!/^\d+$/.test(target)||!Number.isSafeInteger(Number(target)))throw new Error('Conector SDI local inválido.')
      program.push(`sdi:${target}`);continue
    }
    if(kind==='FILE'){
      if(!/^file:/i.test(target))throw new Error('Gravação HA exige URI de arquivo local revisada.')
      target=fileURLToPath(target)
      if(!isAbsolute(target)||target.startsWith('\\\\'))throw new Error('Gravação HA exige arquivo absoluto local, sem compartilhamento herdado.')
    }else{
      const protocols={RTMP:['rtmp:','rtmps:'],SRT:['srt:'],NDI:['ndi:'],OMT:['omt:']}[kind]
      const url=new URL(target)
      if(!protocols.includes(url.protocol)||((kind==='SRT'||kind==='RTMP')&&!url.hostname))throw new Error('Destino local de outro protocolo.')
    }
    const local={...row!,kind,target} as OutputProfileRow
    validateOutputProfile(local,channel)
    const encoded=encodeProfile({id,kind:kind.toLowerCase() as 'rtmp'|'srt'|'file'|'ndi'|'omt',target,
      ...(local.width!==null?{width:local.width}:{}),...(local.height!==null?{height:local.height}:{}),
      ...(local.rateNum!==null?{rateNum:local.rateNum}:{}),...(local.rateDen!==null?{rateDen:local.rateDen}:{}),
      ...(local.scan!==null?{scan:local.scan==='INTERLACED'?'interlaced' as const:'progressive' as const}:{}),
      ...(local.bitrateKbps!==null?{bitrateKbps:local.bitrateKbps}:{}),...(local.role==='MONITOR'?{role:'mon' as const}:{}),
    })
    ;(local.role==='PREVIEW'?preview:program).push(encoded)
  }
  if(preview.length>1)throw new Error('Mais de um preview habilitado no plano local HA.')
  return {program,preview:preview[0]??null,disabled,publicationAuthorized:false as const}
}

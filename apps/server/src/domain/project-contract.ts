import {z} from 'zod'
import {validateAudioRouting,type AudioRouting} from '@rplayout/protocol'
import {audioSchema,anchorSchema,trimSchema,qcProfileSchema,prioritySchema} from './editorial-schemas.js'
import {scheduledDeviceSchema,freezeDeviceAutomation} from './device-automation.js'
import {validateOutputProfile,type OutputProfileRow} from './outputs.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import type {Db} from '../db/client.js'
import {multiviewCellsSchema,multiviewLayoutSchema} from './multiview-schema.js'
import {validScheduleRule} from './schedule-rule-schema.js'
import {validGraphicTemplate} from './graphics-schema.js'
import {conflictsWithScheduleRule,type ScheduleRuleWindow} from './schedule-rules.js'

const frames=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positive=frames.min(1)
const named=(limit=Number.MAX_SAFE_INTEGER)=>z.string().max(limit).refine(value=>value.trim().length>0)
const name=named()
const ref=z.string().min(1)
const nullable=<T extends z.ZodTypeAny>(schema:T)=>schema.nullable().optional()
const routing=audioSchema.shape.routing.unwrap().superRefine((value,ctx)=>{
  const error=validateAudioRouting(value as AudioRouting)
  if(error)ctx.addIssue({code:'custom',message:error})
})
const measurement=z.object({integratedLufs:z.number().finite(),lra:z.number().finite().min(0),truePeakDbtp:z.number().finite(),scope:z.enum(['FILE','TRIM']),measuredAt:ref,
  input:z.object({contentHash:ref,audioTrack:frames,routing,trim:z.object({inNs:frames,outNs:positive}).strict().refine(cut=>cut.outNs>cut.inNs).optional()}).strict().optional()}).strict()
const audio=audioSchema.extend({routing:routing.optional(),measured:measurement.nullable()}).strict()
const anchor=z.discriminatedUnion('kind',[anchorSchema.options[0]!.strict(),anchorSchema.options[1]!.strict(),anchorSchema.options[2]!.strict(),anchorSchema.options[3]!.strict(),anchorSchema.options[4]!.strict()]).superRefine((value,ctx)=>{
  const keys=value.kind==='FLOW'?['kind']:value.kind==='SOFT'?['kind','at','tolerance','priority']:value.kind==='WINDOW'?['kind','from','to','priority']:['kind','at']
  if(Object.keys(value).some(key=>!keys.includes(key))||Object.values(value).some(value=>typeof value==='number'&&!Number.isSafeInteger(value))||value.kind==='WINDOW'&&value.to<value.from)ctx.addIssue({code:'custom',message:'Âncora inválida.'})
})
const zone=z.object({id:ref.max(80),label:named(120),from:frames,to:positive,priority:prioritySchema}).strict().refine(value=>value.to>value.from)
const zones=z.array(zone).max(100).refine(values=>new Set(values.map(value=>value.id)).size===values.length)
const srt=z.object({mode:z.enum(['caller','listener','rendezvous']),host:z.string(),port:z.number().int().min(1024).max(65535),latencyMs:z.number().int().min(120).max(2000),passphrase:z.string().min(10).max(79).optional(),pbkeylen:z.union([z.literal(16),z.literal(24),z.literal(32)]).optional(),streamId:z.string().max(512).optional(),pollTimeoutMs:z.number().int().min(50).max(1000).optional()}).strict()
const failover=z.object({autoFailover:z.boolean(),maxLossPercent:z.number().finite().min(0).max(100),maxTimeoutMs:positive,maxRttMs:positive,switchDelayMs:frames}).strict()
const scte=z.object({spliceEventId:frames.max(0xffffffff),ptsTime:frames.max(2**33-1),durationSeconds:z.number().finite().positive().max((2**33-1)/90000).optional(),autoReturn:z.boolean(),prerollMs:frames,uniqueProgramId:frames.max(65535).optional(),segmentationTypeId:frames.max(255).optional(),availNum:frames.max(255).optional(),availsExpected:frames.max(255).optional(),outOfNetwork:z.boolean().optional(),commandType:z.enum(['SPLICE_INSERT','TIME_SIGNAL']).optional()}).strict()
const definition=z.object({id:ref,channelId:ref.optional(),rundownItemId:ref.optional(),name:named(120).optional(),targetLayer:z.enum(['STATION_LOGO','ONAIR_CLOCK','CRAWL_TICKER','LOWER_THIRD']),triggerMode:z.enum(['OFFSET_FROM_START','OFFSET_BEFORE_END','MANUAL']),offsetFrames:frames.max(100_000_000),durationFrames:positive.max(100_000_000).optional(),templateId:z.string(),payload:z.record(z.unknown()),enabled:z.boolean(),type:z.enum(['GRAPHICS_OVERLAY','SCTE_TRIGGER','DEVICE_AUTOMATION']).optional(),scteConfig:scte.optional(),deviceConfig:scheduledDeviceSchema.optional(),executionState:z.enum(['ARMED','FIRING','EXECUTED','CANCELLED','FAILED']).optional(),executedAt:z.string().optional(),executionLatencyMs:z.number().finite().min(0).optional()}).strict().superRefine((event,ctx)=>{
  const type=event.type??'GRAPHICS_OVERLAY'
  if(type==='DEVICE_AUTOMATION'?(!event.deviceConfig||Boolean(event.scteConfig)||Boolean(event.durationFrames)):
    type==='SCTE_TRIGGER'?(!event.scteConfig||Boolean(event.deviceConfig)||Boolean(event.durationFrames)):
    Boolean(event.scteConfig||event.deviceConfig))ctx.addIssue({code:'custom',message:'Tipo de evento e configuração incompatíveis.'})
  if(event.executionState&&event.executionState!=='ARMED'||event.executedAt!==undefined||event.executionLatencyMs!==undefined)ctx.addIssue({code:'custom',message:'Projeto editorial não restaura execução de eventos.'})
})
const schemas:Record<string,z.ZodTypeAny>={
  channel:z.object({name,width:z.number().int().min(160).max(7680),height:z.number().int().min(120).max(4320),rateNum:positive.max(0x7fffffff),rateDen:positive.max(0x7fffffff),scan:z.enum(['PROGRESSIVE','INTERLACED']),fieldOrder:z.enum(['TFF','BFF']),targetLufs:z.number().finite().min(-100).max(0),ceilingDbtp:z.number().finite().min(-100).max(12),limiterLookaheadMs:z.number().finite().min(0),audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]),qcProfile:nullable(qcProfileSchema.innerType().strict().refine(profile=>profile.minLufs<=profile.maxLufs))}).passthrough(),
  outputs:z.object({name,kind:z.enum(['RTMP','SRT','FILE','SDI','NDI','OMT']),target:z.string(),role:z.enum(['PROGRAM','PREVIEW','MONITOR','EXTRA']),width:nullable(z.number().int().min(160).max(7680)),height:nullable(z.number().int().min(120).max(4320)),rateNum:nullable(positive.max(0x7fffffff)),rateDen:nullable(positive.max(0x7fffffff)),scan:nullable(z.enum(['PROGRESSIVE','INTERLACED'])),bitrateKbps:nullable(z.number().int().min(50).max(80000))}).passthrough(),
  presets:z.object({name,kind:z.enum(['RTMP','SRT']),target:ref}).passthrough(),
  sources:z.object({name,kind:z.enum(['SRT','RTMP','SDI','NDI','OMT']),targetUrl:z.string(),srtConfig:nullable(srt),role:z.enum(['PRIMARY','BACKUP']),failoverConfig:nullable(failover)}).passthrough().refine(row=>row.kind==='SRT'||row.srtConfig==null),
  rules:validScheduleRule,
  multiview:z.object({layout:multiviewLayoutSchema,cells:nullable(multiviewCellsSchema)}).passthrough(),
  destinations:z.object({name,url:ref}).passthrough(),guests:z.object({label:name,streamKey:ref}).passthrough(),
  graphics:validGraphicTemplate,
  rundowns:z.object({name,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value}),plannedStart:frames,protectedZones:zones.optional()}).passthrough(),
  items:z.object({title:name,type:z.enum(['VT','LIVE','GFX','SLATE','COMMERCIAL','FILLER']),configuredSourceId:z.string().min(1).max(200).nullable().optional(),eventType:z.enum(['FIXED','SEQUENTIAL','HARD_TIME','LIVE','FILLER']).optional(),sortOrder:frames,trim:nullable(trimSchema.strict().refine(value=>value.out>=value.in)),audio:nullable(audio),anchor,onOverrun:z.enum(['TRIM_PREV','DROP_FILLER','PUSH']),minDuration:frames,durationOverride:nullable(frames),elastic:nullable(z.object({min:frames,max:frames}).strict().refine(value=>value.max>=value.min)),fit:nullable(z.enum(['PILLARBOX','CROP'])),audioTrack:nullable(frames),liveSourceType:nullable(z.enum(['SDI','NDI','OMT','SRT','RTMP','WEBRTC'])),liveEstimatedDuration:nullable(frames),liveMaxDuration:nullable(frames)}).passthrough().refine(row=>row.liveMaxDuration==null||row.liveEstimatedDuration==null||row.liveMaxDuration>=row.liveEstimatedDuration).refine(row=>row.configuredSourceId==null||row.type==='LIVE'),
  cues:z.object({values:z.record(z.string()),atSeconds:frames.max(86400)}).passthrough(),secondaryEvents:z.object({definition}).passthrough(),
}
function invalid(section:string):never{throw new CollaborativeEditError(400,{error:`Conteúdo inválido na seção ${section} do projeto. Confira limites, tipos e configurações; nenhuma restauração aplicada.`})}
/** Validate, never replace the supplied rows with parsed/normalized copies. */
export function assertProjectContract(db:Pick<Db,'select'>,payload:Record<string,any>):void{
  if(!schemas.channel!.safeParse(payload.channel).success)invalid('channel')
  for(const [section,schema]of Object.entries(schemas)){
    if(section==='channel')continue
    if(section==='multiview'&&payload[section].length>1)invalid(section)
    for(const row of payload[section]){
      if(!schema.safeParse(row).success)invalid(section)
      if(section==='outputs'||section==='presets'){
        try{validateOutputProfile(section==='outputs'?{...row,width:row.width??null,height:row.height??null,rateNum:row.rateNum??null,rateDen:row.rateDen??null,scan:row.scan??null,bitrateKbps:row.bitrateKbps??null}: {...row,role:'EXTRA',width:null,height:null,rateNum:null,rateDen:null,scan:null,bitrateKbps:null,enabled:false} as OutputProfileRow,payload.channel)}catch{invalid(section)}
        if((row.role??'EXTRA')==='EXTRA'&&!row.target.trim())invalid(section)
      }
      if(section==='sources'&&row.pairedSourceId===row.id)invalid(section)
      if(section==='secondaryEvents'&&row.definition.type==='DEVICE_AUTOMATION')try{freezeDeviceAutomation(db,row.definition)}catch{invalid(section)}
    }
  }
  const bands=payload.rules as ScheduleRuleWindow[]
  if(bands.some(row=>conflictsWithScheduleRule(row,bands,row.id)))invalid('rules')
}

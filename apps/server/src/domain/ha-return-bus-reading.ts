import {z} from 'zod'
import {audioRoutingKey,validateAudioRouting,validateAuxiliaryPairs} from '@rplayout/protocol'

const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const trim=z.object({inNs:integer,outNs:integer}).strict().refine(value=>value.outNs-value.inNs>=400_000_000,'Corte menor que 400 ms.')
const routing=z.object({mode:z.enum(['DEFAULT','STEREO_1_2','STEREO_3_4','DOWNMIX_MONO','LEFT_ONLY','RIGHT_ONLY','MATRIX','PAIR_MIX']),matrix:z.array(z.array(z.number().finite().min(-1).max(1)).min(1).max(64)).length(2).nullish(),pairs:z.array(integer.max(31)).min(1).max(32).nullish()}).strict().transform(value=>({mode:value.mode,...(value.matrix!=null?{matrix:value.matrix}:{}),...(value.pairs!=null?{pairs:value.pairs}:{})}))
const auxiliary=z.object({outputPair:integer.min(2).max(8),inputPair:integer.min(1).max(32),gainDb:z.number().finite().min(-60).max(12).default(0)}).strict()
const settings={audioTrack:integer.max(63),inputChannels:integer.min(1).max(64),routing,auxiliaryPairs:z.array(auxiliary).max(7),gainDb:z.number().finite().min(-60).max(12),ceilingDbtp:z.number().finite().min(-30).max(0)}
export const returnBusConfigSchema=z.object({...settings,audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]),trim}).strict().superRefine((value,context)=>{
  const error=validateAudioRouting(value.routing,value.inputChannels)||validateAuxiliaryPairs(value.auxiliaryPairs,value.audioChannels,value.inputChannels)
  if(error)context.addIssue({code:z.ZodIssueCode.custom,message:error})
})
export type ReturnBusConfig=z.infer<typeof returnBusConfigSchema>
export const returnBusReadingSchema=z.object({ok:z.literal(true),rate:z.literal(48000),channels:z.union([z.literal(2),z.literal(8),z.literal(16)]),trim,sampleFrames:integer.min(19200),startupFramesRemoved:z.literal(240),flushedFrames:z.literal(240),limiterReductionDb:z.number().finite().nonnegative(),pairs:z.array(z.object({outputPair:integer.min(1).max(8),integratedLufs:z.number().finite(),lra:z.number().finite().nonnegative(),truePeakDbtp:z.number().finite(),sampleFrames:integer.min(19200)}).strict()).min(1).max(8),processing:z.object({...settings,kind:z.literal('ISOLATED_RENDERED_BUS'),initialState:z.literal('RESET'),sourceCoverageConfirmed:z.literal(true),trimStage:z.literal('AFTER_ITEM_MIX'),decodeFromStart:z.literal(true),tailFlushed:z.literal(true),pairLinked:z.boolean(),busQualified:z.literal(false),transitionQualified:z.literal(false),avQualified:z.literal(false),publicationAuthorized:z.literal(false)}).strict()}).strict()
/** Exact requested item bus only. Never approval of continuous PGM or A/V. */
export function readReturnBus(raw:unknown,configuration:unknown){
  const config=returnBusConfigSchema.parse(configuration),reading=returnBusReadingSchema.parse(raw),processing=reading.processing
  const expected=Number(BigInt(config.trim.outNs-config.trim.inNs)*48000n/1_000_000_000n)
  if(reading.channels!==config.audioChannels||reading.trim.inNs!==config.trim.inNs||reading.trim.outNs!==config.trim.outNs||Math.abs(reading.sampleFrames-expected)>1)throw new Error('Bus/PCM/corte não correspondem ao pedido.')
  if(processing.audioTrack!==config.audioTrack||processing.inputChannels!==config.inputChannels||processing.gainDb!==config.gainDb||processing.ceilingDbtp!==config.ceilingDbtp||processing.pairLinked!==(config.audioChannels>2)||audioRoutingKey(processing.routing)!==audioRoutingKey(config.routing)||JSON.stringify(processing.auxiliaryPairs)!==JSON.stringify(config.auxiliaryPairs))throw new Error('Processamento do bus difere da configuração capturada.')
  if(reading.pairs.length!==config.audioChannels/2||reading.pairs.some((pair,index)=>pair.outputPair!==index+1||pair.sampleFrames!==reading.sampleFrames))throw new Error('Pares do bus sem cobertura integral e ordenada.')
  return reading
}

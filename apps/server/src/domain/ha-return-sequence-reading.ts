import {z} from 'zod'
import {returnBusConfigSchema,returnBusReadingSchema} from './ha-return-bus-reading.js'
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const returnSequenceConfigurations=z.array(returnBusConfigSchema).min(1).max(128).superRefine((values,context)=>{
  if(values.some(value=>value.audioChannels!==values[0]!.audioChannels||value.ceilingDbtp!==values[0]!.ceilingDbtp))context.addIssue({code:z.ZodIssueCode.custom,message:'Bus/teto devem permanecer estáveis na sequência.'})
})
export const returnSequenceReadingSchema=z.object({ok:z.literal(true),kind:z.literal('CONTINUOUS_RENDERED_CUT_SEQUENCE'),rate:z.literal(48000),channels:z.union([z.literal(2),z.literal(8),z.literal(16)]),sampleFrames:integer.min(19200),segments:z.array(z.object({segmentIndex:integer.max(127),firstFrame:integer,sampleFrames:integer.min(19200),pairs:returnBusReadingSchema.shape.pairs}).strict()).min(1).max(128),pairs:returnBusReadingSchema.shape.pairs,startupFramesRemoved:z.literal(240),flushedFrames:z.literal(240),limiterReductionDb:z.number().finite().nonnegative(),initialState:z.literal('RESET_ONCE'),statePreservedAcrossCuts:z.literal(true),sourceCoverageConfirmed:z.literal(true),trimStage:z.literal('AFTER_ITEM_MIX'),decodeFromStart:z.literal(true),configurations:returnSequenceConfigurations,operationalSelectorQualified:z.literal(false),nativeTransitionQualified:z.literal(false),avQualified:z.literal(false),editorialApproved:z.literal(false),publicationAuthorized:z.literal(false)}).strict()
/** Sequence order is semantic; never sort/reuse singleton RESET receipts. */
export function readReturnSequence(raw:unknown,configuration:unknown){
  const configs=returnSequenceConfigurations.parse(configuration),value=returnSequenceReadingSchema.parse(raw)
  if(JSON.stringify(configs)!==JSON.stringify(value.configurations)||value.channels!==configs[0]!.audioChannels||value.segments.length!==configs.length)throw new Error('Sequência/configuração não corresponde ao pedido.')
  let ordinal=0
  const completePairs=(pairs:z.infer<typeof returnBusReadingSchema>['pairs'],frames:number)=>pairs.length===value.channels/2&&pairs.every((pair,index)=>pair.outputPair===index+1&&pair.sampleFrames===frames)
  for(let index=0;index<configs.length;index++){
    const config=configs[index]!,segment=value.segments[index]!,frames=Number(BigInt(config.trim.outNs-config.trim.inNs)*48000n/1_000_000_000n)
    if(segment.segmentIndex!==index||segment.firstFrame!==ordinal||segment.sampleFrames!==frames||!completePairs(segment.pairs,frames))throw new Error('Corte/ordinal/pares sem cobertura exata na sequência.')
    ordinal+=frames;if(!Number.isSafeInteger(ordinal))throw new Error('Sequência excede contagem segura.')
  }
  if(value.sampleFrames!==ordinal||!completePairs(value.pairs,ordinal))throw new Error('PCM total da sequência divergente.')
  return value
}

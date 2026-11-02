import {z} from 'zod'
import {installationVault,SECRET_PREFIX} from './secret-vault.js'
import {nativeLiveReplacementReceiptSchema,matchesNativeLiveReplacement,parseNativeLiveReplacementRequest,
 type NativeLiveReplacementReceipt,type NativeLiveReplacementRequest} from './native-live-replacement.js'
import {nativeSourceConnectionSignature,type NativeLiveReplacementContext} from './native-live-replacement-ledger.js'

const id=z.string().min(1).max(256)
const scopeSchema=z.object({channelId:id,rundownId:id,revisionId:id,executionId:id,occurrenceId:id,itemId:id}).strict()
export const liveProgramBindingSchema=z.object({version:z.literal(1),context:scopeSchema,
 receipt:nativeLiveReplacementReceiptSchema,
 sourceType:z.enum(['SRT','RTMP','RTSP','NDI','OMT','SDI']),
 connectionSignature:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
 sealedSource:z.string().min(SECRET_PREFIX.length+40).max(24_000).startsWith(SECRET_PREFIX),
}).strict().superRefine((value,ctx)=>{
 if(value.receipt.phase!=='COMMITTED'||value.receipt.itemId!==value.context.itemId)ctx.addIssue({code:'custom',message:'Vínculo requer corte nativo da mesma ocorrência.'})
})
export type LiveProgramBinding=z.infer<typeof liveProgramBindingSchema>
export interface LiveBindingCursor {channelId:string;rundownId:string|null;revisionId:string|null;executionId?:string;itemId:string|null;elapsed:number;playing:boolean;realEngine:boolean;programTrim?:unknown;programHold?:unknown}
function aad(binding:Omit<LiveProgramBinding,'sealedSource'>):string{
 const c=binding.context,r=binding.receipt
 return 'live-program-binding:v1:'+JSON.stringify([c.channelId,c.rundownId,c.revisionId,c.executionId,c.occurrenceId,c.itemId,
  r.transactionId,r.engineGeneration,r.selectionRevision,r.expectedDecoderId,r.expectedSourceId,r.targetSourceId,r.preparedDecoderId,r.programFrames,
  binding.sourceType,binding.connectionSignature])
}
/** Caller must have persisted the real native receipt and checkpoint atomically.
 * This creates protected data, not a Native TAKE or an execution permission. */
export function createLiveProgramBinding(context:NativeLiveReplacementContext,request:NativeLiveReplacementRequest,value:NativeLiveReplacementReceipt):LiveProgramBinding{
 const receipt=nativeLiveReplacementReceiptSchema.parse(value),validated=parseNativeLiveReplacementRequest(request)
 if(receipt.phase!=='COMMITTED'||!matchesNativeLiveReplacement(receipt,validated)||context.engineGeneration!==receipt.engineGeneration
  ||context.itemId!==receipt.itemId||context.decoderId!==receipt.expectedDecoderId||context.sourceId!==receipt.expectedSourceId)throw new Error('Recibo não corresponde à seleção confirmada da live.')
 const scope=scopeSchema.parse({channelId:context.channelId,rundownId:context.rundownId,revisionId:context.revisionId,
  executionId:context.executionId,occurrenceId:context.occurrenceId,itemId:context.itemId})
 const metadata={version:1 as const,context:scope,receipt,sourceType:validated.targetSourceType,
  connectionSignature:nativeSourceConnectionSignature(receipt.targetSourceId,validated.targetSourceType,validated.targetSource)}
 return liveProgramBindingSchema.parse({...metadata,sealedSource:installationVault().encrypt(validated.targetSource,aad(metadata))})
}
/** Structural cursor binding before opening any connection or interpreting time. */
export function assertLiveProgramBindingCursor(value:unknown,cursor:LiveBindingCursor):LiveProgramBinding{
 const binding=liveProgramBindingSchema.parse(value),scope=binding.context
 if(!cursor.playing||!cursor.realEngine||cursor.programTrim||cursor.programHold||!Number.isSafeInteger(cursor.elapsed)
  ||cursor.elapsed<binding.receipt.programFrames!||(['channelId','rundownId','revisionId','executionId','itemId'] as const).some(key=>cursor[key]!==scope[key]))throw new Error('Vínculo de live não corresponde ao checkpoint nativo ativo.')
 return binding
}
/** Uses the immutable confirmed endpoint, not the possibly edited catalog.
 * The envelope is authenticated against source IDs, occurrence and receipt. */
export function resolveLiveProgramBinding(value:unknown,cursor:LiveBindingCursor):{source:string;configuredSourceId:string;sourceType:NativeLiveReplacementRequest['targetSourceType']} {
 try{
  const binding=assertLiveProgramBindingCursor(value,cursor)
  const source=installationVault().decrypt(binding.sealedSource,aad(binding))
  if(nativeSourceConnectionSignature(binding.receipt.targetSourceId,binding.sourceType,source)!==binding.connectionSignature)throw new Error('signature mismatch')
  const {preparedDecoderId:_,phase:__,programFrames:___,...request}=binding.receipt
  parseNativeLiveReplacementRequest({...request,targetSource:source,targetSourceType:binding.sourceType})
  return {source,configuredSourceId:binding.receipt.targetSourceId,sourceType:binding.sourceType}
 }catch{throw new Error('Vínculo protegido da fonte ao vivo inválido ou incompatível com este checkpoint/cofre; fonte original não será selecionada por fallback.')}
}

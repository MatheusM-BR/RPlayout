import {z} from 'zod'
const id=z.string().min(1).max(128),integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const haControlRequest=z.object({requestId:z.string().uuid(),channelId:id,promotionId:z.string().uuid(),revisionId:id.nullable(),action:z.enum(['CUE','TAKE']),itemId:id}).strict()
export const haControlReviewRequest=z.object({reviewId:z.string().uuid(),requestId:z.string().uuid(),channelId:id,reviewToken:z.string().min(1).max(256)}).strict()
const cueProof=z.object({itemId:id,ownerId:z.string().uuid(),term:integer.positive(),programChanged:z.literal(false),signalConfirmed:z.literal(false)}).strict()
const takeProof=z.object({itemId:id,decoderId:integer.positive(),ownerId:z.string().uuid(),term:integer.positive(),elapsed:integer,nativeConfirmed:z.literal(true)}).strict()
export const haControlReport=z.object({version:z.literal(1),request:haControlRequest,phase:z.enum(['ACCEPTED','SENDING','CONFIRMED','REFUSED','UNCERTAIN']),actor:z.string().min(1).max(256),updatedAt:z.string().datetime(),proof:z.union([cueProof,takeProof]).optional(),confirmationIsHistorical:z.literal(true),physicalOutputValidated:z.literal(false)}).strict().superRefine((report,ctx)=>{
  if(report.phase==='CONFIRMED'&&(!report.proof||report.proof.itemId!==report.request.itemId||(report.request.action==='TAKE')!==('nativeConfirmed' in report.proof)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Confirmação não corresponde ao controle solicitado.'})
})

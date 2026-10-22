import {z} from 'zod'
export const haStopRequest=z.object({requestId:z.string().uuid(),channelId:z.string().min(1).max(128),promotionId:z.string().uuid(),reviewToken:z.string().min(1).max(256),confirmStop:z.literal(true)}).strict()
export const haStopReport=z.object({version:z.literal(1),request:haStopRequest,phase:z.enum(['ACCEPTED','STOPPING','CONFIRMED','UNCERTAIN']),actor:z.string().min(1).max(256),updatedAt:z.string().datetime(),ownedResourcesStopped:z.boolean(),storageReleased:z.boolean(),originalControlOutcomesUnchanged:z.literal(true),authorityReturnedToPrimary:z.literal(false),automaticRestart:z.literal(false),physicalOutputValidated:z.literal(false)}).strict().superRefine((report,ctx)=>{
  if(report.phase==='CONFIRMED'&&(!report.ownedResourcesStopped||!report.storageReleased))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Encerramento não confirmado por todos os recursos/posse.'})
})

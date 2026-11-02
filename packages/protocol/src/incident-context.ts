import {z} from 'zod'
const id=z.string().min(1).max(256).regex(/^[\p{L}\p{N}_:.-]+$/u)
const label=z.string().max(320).refine(value=>[...value].length<=160&&!/[\u0000-\u001f\u007f]|:\/\/|\\|^[a-z]:|^\/|^(?:ndi|omt|sdi|guest|path):|(?:password|passphrase|token|secret|key)\s*=/i.test(value),'Rótulo inválido ou contém endereço/segredo.').nullable()
export const IncidentContextSchema=z.object({
  version:z.literal(1),capturedAt:z.string().datetime(),channelId:id,
  rundownId:id.nullable(),revisionId:id.nullable(),executionId:id.nullable(),
  itemId:id.nullable(),itemName:label,elapsedFrames:z.number().int().nonnegative().nullable(),
  engine:z.object({ready:z.boolean(),processPresent:z.boolean()}).strict(),
  sources:z.array(z.object({identity:id,name:label,state:label,pgm:label,pvw:label,
    pgmSelection:z.object({identity:id,name:label,basis:z.enum(['PUBLISHED_ITEM','NATIVE_DECODER'])}).strict().nullable()}).strict()).max(32),
  outputs:z.array(z.object({identity:id,identityType:z.enum(['PROFILE','ENDPOINT']),name:label,state:label,hasError:z.boolean()}).strict()).max(32),
  sourcesTruncated:z.boolean(),outputsTruncated:z.boolean(),physicalSignalValidated:z.literal(false),
}).strict()
export type IncidentContext=z.infer<typeof IncidentContextSchema>

import {z} from 'zod'
import {renderedBusPairsSchema} from './rendered-bus-policy-schema.js'
/** Shared HTTP/storage primitives. Snapshot-specific refinements never normalize saved data. */
export const trimSchema = z.object({ in: z.number().int().min(0), out: z.number().int().min(0) })

export const audioSchema = z.object({
mode: z.enum(['AUTO', 'MANUAL', 'OFF']),
gainDb: z.number().min(-40).max(20),
analysisId:z.string().uuid().optional(),
channelMap:z.array(z.number().int().min(0).max(31)).max(32).optional(),
auxiliaryPairs:z.array(z.object({outputPair:z.number().int().min(2).max(8),inputPair:z.number().int().min(1).max(32),gainDb:z.number().finite().min(-60).max(12).optional()}).strict()).max(7).optional(),
routing:z.object({mode:z.enum(['DEFAULT','STEREO_1_2','STEREO_3_4','DOWNMIX_MONO','LEFT_ONLY','RIGHT_ONLY','MATRIX','PAIR_MIX']),matrix:z.array(z.array(z.number().finite().min(-1).max(1)).min(1).max(64)).length(2).optional(),pairs:z.array(z.number().int().min(0).max(31)).min(1).max(32).optional()}).strict().optional(),
measured: z
  .object({
    integratedLufs: z.number(),
    lra: z.number(),
    truePeakDbtp: z.number(),
    scope: z.enum(['FILE', 'TRIM']),
    measuredAt: z.string(),
  })
  .nullable(),
})

/** Prioridade é 1..5, não "um número" — o tipo do domínio precisa da literal. */
export const prioritySchema = z.union([
z.literal(1),
z.literal(2),
z.literal(3),
z.literal(4),
z.literal(5),
])

export const anchorSchema = z.discriminatedUnion('kind', [
z.object({ kind: z.literal('FLOW') }),
z.object({ kind: z.literal('FIXED'), at: z.number().int().min(0) }),
z.object({ kind: z.literal('HARD_TIME'), at: z.number().int().min(0) }),
z.object({
  kind: z.literal('SOFT'),
  at: z.number().int().min(0),
  tolerance: z.number().int().min(0),
  priority: prioritySchema,
}),
z.object({
  kind: z.literal('WINDOW'),
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  priority: prioritySchema,
}),
])

export const qcProfileSchema = z.object({
  renderedBusPairs:renderedBusPairsSchema.optional(),
  requireProbe:z.boolean().optional(),
  liveSignalPolicy:z.object({arrivalWarningEnabled:z.boolean(),warningFrameIntervals:z.number().finite().min(0.5).max(20),minimumReceivedFrames:z.number().int().min(1).max(10000)}).strict().optional(),
  codecs: z.array(z.string().min(1).max(100)).max(30), width: z.number().int().min(1).max(8192).nullable(), height: z.number().int().min(1).max(8192).nullable(),
  fps: z.number().positive().max(240).nullable(), scan: z.enum(['ANY', 'PROGRESSIVE', 'INTERLACED']), requireAudio: z.boolean(),
  minDurationSeconds: z.number().min(0).max(86400), requireLoudness: z.boolean(), minLufs: z.number().min(-100).max(0), maxLufs: z.number().min(-100).max(0), maxTruePeakDbtp: z.number().min(-100).max(12),
}).refine(profile => profile.minLufs <= profile.maxLufs, 'Faixa de loudness inválida.')

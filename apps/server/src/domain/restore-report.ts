import {z} from 'zod'
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** This is a quarantined restoration receipt, never a native-stop or promotion certificate. */
export const restoreReportSchema=z.object({
  version:z.literal(1),requestId:z.string().uuid(),phase:z.literal('QUARANTINED'),restoredAt:z.string().datetime(),backupSha256:z.string().regex(/^[a-f0-9]{64}$/),
  vaultMode:z.enum(['ORIGINAL_FILE','SHARED_ENVIRONMENT']),vaultFingerprint:z.string().min(1),
  validation:z.object({integrity:z.literal('ok'),foreignKeys:z.literal('ok'),tables:z.record(count),restoredAt:z.string().datetime(),protectedSecrets:z.literal('verified'),vaultFingerprint:z.string().min(1),keyRecovery:z.string().optional(),
    operationalState:z.object({savedCheckpoints:count,savedPlayingCheckpoints:count,savedHeldCheckpoints:count.optional(),publishedRevisions:count,activeRevisions:count,asRunRecords:count,openAsRunRecords:count,executionResumeAllowed:z.literal(false)}).strict()
  }).strict(),automaticTake:z.literal(false),promotionReady:z.literal(false),mediaCopied:z.literal(false),originalReferencesPreserved:z.literal(true)
}).strict().refine(report=>report.vaultFingerprint===report.validation.vaultFingerprint,'Cofre do relatório não corresponde à validação.')

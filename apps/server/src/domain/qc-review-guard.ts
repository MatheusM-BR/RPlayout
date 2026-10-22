import { qcAssetETag, qcDecisionETag } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { configurationRevision } from '../db/channel-configuration.js'
import { qcRevision } from '../db/qc-revisions.js'
import { CollaborativeEditError } from './collaborative-edit.js'

/** Must run inside the same transaction as the decision and its audit. */
export function requireQcReview(db: Pick<Db, 'select'>, assetId: string, header: string | string[] | undefined, channelId?: string): number {
  if (header === undefined) throw new CollaborativeEditError(428, { error: 'Confira o QC antes de decidir. Envie o If-Match da conferência; nenhum estado foi alterado.' })
  const match = typeof header === 'string' ? (channelId === undefined ? /^"qc-asset:([^"\s]+):([1-9]\d*)"$/ : /^"qc:([^"\s]+):([1-9]\d*):([^"\s]+):([1-9]\d*)"$/).exec(header) : null
  const revision = match ? Number(match[2]) : NaN, config = match ? Number(match[4]) : NaN
  if (!match || match[1] !== encodeURIComponent(assetId) || !Number.isSafeInteger(revision) || revision < 1 || channelId !== undefined && (match[3] !== encodeURIComponent(channelId) || !Number.isSafeInteger(config) || config < 1)) throw new CollaborativeEditError(400, { error: 'Revisão QC inválida ou de outro arquivo/canal. Reabra a conferência correta.' })
  const current = qcRevision(db, assetId)
  const expected = channelId === undefined ? qcAssetETag(assetId, current) : qcDecisionETag({ assetId, channelId, contentHash: '', assetRevision: current, configurationRevision: configurationRevision(db, channelId) })
  if (header !== expected) throw new CollaborativeEditError(409, { error: 'O QC, o arquivo ou o perfil mudou desde a conferência. Seus campos não foram aplicados; reabra o QC e confira antes de repetir.' })
  return current
}

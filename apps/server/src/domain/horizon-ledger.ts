import { createHash } from 'node:crypto'
import type { Db } from '../db/client.js'
import { healthEvents, operatorDecisions } from '../db/schema.js'
import type { horizonWarning } from './continuous.js'

/** A durable notification, not a montage/publication/TAKE authorization.
 * Same revision/date/window is warned once even after restart or in two nodes. */
export function recordHorizonWarning(db: Db, channelId: string,
  warning: NonNullable<ReturnType<typeof horizonWarning>>, editorialRevision: number | null = null, now = new Date()) {
  const identity = { channelId, rundownId: warning.rundownId, revisionId: warning.channelRevision,
    editorialRevision: warning.channelRevision ? null : editorialRevision, date: warning.date, endBucket: warning.endBucket }
  const id = `horizon:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`
  return db.transaction(tx => {
    const inserted = tx.insert(operatorDecisions).values({ id, rundownId: warning.rundownId,
      kind: 'SCHEDULER_HORIZON_WARNING', payload: identity, actorUsername: null, createdAt: now.toISOString() })
      .onConflictDoNothing().run()
    if (!inserted.changes) return false
    tx.insert(healthEvents).values({ id, channelId, component: 'SCHEDULER', state: 'degraded',
      severity: 'WARN', message: warning.message, occurredAt: now.toISOString() }).run()
    return true
  }, { behavior: 'immediate' })
}

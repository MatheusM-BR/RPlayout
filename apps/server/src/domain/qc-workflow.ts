import { asc, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { qcDecisions } from '../db/schema.js'
import type { MediaAsset } from '@rplayout/protocol'

/** Decisions belong to content hashes, not filenames. Changing a file cannot
 * revoke an approved archived edition, and approving a new one cannot approve
 * the old rejected bytes. Approval for one channel doesn't approve other ones. */
export function applyQcDecisionsNow(db: Pick<Db,'select'>, assets: ReadonlyMap<string, MediaAsset>, channelId: string) {
  // Do not scan the entire historical workflow every time a channel refreshes.
  // Bound parameter batches also work with older SQLite variable limits.
  const ids = [...assets.keys()]
  const rows: Array<typeof qcDecisions.$inferSelect> = []
  for (let offset = 0; offset < ids.length; offset += 400) {
    rows.push(...db.select().from(qcDecisions)
      .where(inArray(qcDecisions.assetId, ids.slice(offset, offset + 400)))
      .orderBy(asc(sql`rowid`)).all())
  }
  const decisions = new Map<string, typeof rows[number]>()
  const versioned = new Set<string>()
  for (const row of rows) {
    const key = `${row.assetId}:${row.contentHash}`
    versioned.add(key)
    if (row.channelId === channelId || row.channelId === '@all') decisions.set(key, row)
  }
  return new Map([...assets].map(([id, asset]) => {
    const key = `${id}:${asset.contentHash}`, decision = decisions.get(key)
    return [id, decision ? { ...asset, qcStatus: decision.status, qcNotes: decision.notes, qcCheckedAt: decision.createdAt,
      ignored: ['REJECTED', 'FAILED', 'BLOCKED'].includes(decision.status) }
      : versioned.has(key) ? { ...asset, qcStatus: 'PENDING' as const, qcCheckedAt: null } : asset] as const
  }))
}
export async function applyQcDecisions(db:Db,assets:ReadonlyMap<string,MediaAsset>,channelId:string){return applyQcDecisionsNow(db,assets,channelId)}

import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { integrations } from '../db/schema.js'

/** Publica sem bloquear o motor; falha externa fica apenas no retorno. */
export async function emitIntegrationEvent(db: Db, event: string, payload: Record<string, unknown>, channelId?: string | null): Promise<void> {
  try {
    const rows = await db.select().from(integrations).where(eq(integrations.enabled, true))
    await Promise.allSettled(rows.filter((row) => (row.channelId === null || row.channelId === channelId) && row.events.includes(event)).map(async (row) => {
      try {
        await fetch(row.url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'RPlayout-Gateway/1' }, body: JSON.stringify({ type: event, channelId: channelId ?? null, sentAt: new Date().toISOString(), payload }) })
      } catch { /* gateway indisponível não derruba o playout */ }
    }))
  } catch { /* erro de banco/configuração também fica isolado */ }
}

import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { integrations, integrationDeliveries, healthEvents } from '../db/schema.js'
import { randomUUID } from 'node:crypto'

/** Persist before network delivery. No browser or reachable gateway is needed
 * to retain the alert. Callers never wait for a slow external endpoint. */
export async function emitIntegrationEvent(db: Db, event: string, payload: Record<string, unknown>, channelId?: string | null): Promise<void> {
  try {
    const rows = await db.select().from(integrations).where(eq(integrations.enabled, true))
    const now = new Date().toISOString()
    for (const row of rows.filter((row) => (row.channelId === null || row.channelId === channelId) && row.events.includes(event))) {
      const id = randomUUID()
      await db.insert(integrationDeliveries).values({ id, integrationId:row.id, channelId:channelId ?? null, event,
        target:row.url,payload:{ id, type:event,channelId:channelId ?? null,occurredAt:now,payload },
        state:'QUEUED',attempts:0,nextAttemptAt:now,createdAt:now })
    }
  } catch {
    // Do not take PGM down for a failed alert, but never silently claim it was
    // retained. The local incident is independent of the failed external path.
    try {
      await db.insert(healthEvents).values({ id: randomUUID(), channelId: channelId ?? null,
        component: 'INTEGRATION', state: 'queue_failed', severity: 'CRITICAL',
        message: `Não foi possível persistir a entrega do evento ${event}. Verifique o banco e o armazenamento; o alerta externo não está garantido.`,
        occurredAt: new Date().toISOString() })
    } catch { console.error('RPlayout: falha ao persistir alerta externo e incidente local; verificar banco/armazenamento.') }
  }
}

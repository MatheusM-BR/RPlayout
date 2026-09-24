import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { framesSinceMidnight, msToFrames } from '@rplayout/protocol'
import type { Channel } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { asRun } from '../db/schema.js'
import type { RundownView } from './plan.js'
import { emitIntegrationEvent } from './integrations.js'

/** Uma linha do as-run como ela sai para a interface e para o relatório. */
export type AsRunEntry = typeof asRun.$inferSelect

/**
 * Escreve o que foi ao ar.
 *
 * Fecha a linha anterior quando o item no ar muda -- e não só quando um item
 * novo entra: preto no ar também é informação, e um as-run que só registra
 * sucesso não serve para explicar o dia em que algo falhou.
 */
export class AsRun {
  private open: { id: string; itemId: string; startedMs: number } | null = null

  constructor(
    private readonly db: Db,
    private readonly channel: Channel,
  ) {}

  /**
   * Atualiza o log com base no item atualmente em exibição no PGM.
   *
   * Idempotente para o mesmo item: só escreve se a chave mudar.
   */
  async follow(itemId: string | null, view: RundownView | null = null): Promise<void> {
    if (this.open && this.open.itemId === itemId) return

    if (this.open) {
      await this.close(this.open, itemId ? 'NEXT' : 'STOP')
      this.open = null
    }

    if (!itemId) {
      void emitIntegrationEvent(this.db, 'asrun.gap', { startedAt: new Date().toISOString() }, this.channel.id)
      return
    }

    const entry = view?.items.find((candidate) => candidate.item.id === itemId)
    const scheduled = view?.schedule.items.find((candidate) => candidate.id === itemId)
    const now = framesSinceMidnight(new Date(), this.channel.rate)

    const id = randomUUID()
    await this.db.insert(asRun).values({
      id,
      channelId: this.channel.id,
      rundownId: view?.rundown.id ?? null,
      itemId,
      mediaId: entry?.item.mediaId ?? null,
      title: entry?.item.title ?? 'item desconhecido',
      type: entry?.item.type ?? 'VT',
      startedAt: new Date().toISOString(),
      endedAt: null,
      plannedStart: scheduled?.start ?? null,
      actualStart: now,
      airedFrames: null,
      plannedFrames: scheduled?.duration ?? null,
      endedBy: null,
      createdAt: new Date().toISOString(),
    })
    void emitIntegrationEvent(this.db, 'asrun.started', { itemId, title: entry?.item.title ?? 'item desconhecido', startedAt: new Date().toISOString() }, this.channel.id)
    this.open = { id, itemId, startedMs: Date.now() }
  }

  /** Fecha a linha aberta, se houver. Chamado ao encerrar o canal. */
  async finish(reason = 'STOP'): Promise<void> {
    if (!this.open) return
    await this.close(this.open, reason)
    this.open = null
  }

  private async close(open: { id: string; itemId: string; startedMs: number }, reason: string): Promise<void> {
    // A conta é sobre o relógio de parede, não sobre frames desde a
    // meia-noite: item que atravessa a virada do dia daria duração negativa.
    const aired = msToFrames(Date.now() - open.startedMs, this.channel.rate)
    await this.db
      .update(asRun)
      .set({
        endedAt: new Date().toISOString(),
        airedFrames: Math.max(0, aired),
        endedBy: reason,
      })
      .where(eq(asRun.id, open.id))
    void emitIntegrationEvent(this.db, 'asrun.ended', { itemId: open.itemId, endedAt: new Date().toISOString(), reason, airedFrames: Math.max(0, aired) }, this.channel.id)
  }
}

/** As linhas de um canal a partir de um instante (ou intervalo de datas), mais novas primeiro. */
export async function listAsRun(
  db: Db,
  channelId: string,
  since?: string,
  limit = 1000,
  until?: string,
): Promise<AsRunEntry[]> {
  const conditions = [eq(asRun.channelId, channelId)]
  if (since) {
    conditions.push(gte(asRun.startedAt, since))
  }
  if (until) {
    conditions.push(lte(asRun.startedAt, until))
  }
  return db
    .select()
    .from(asRun)
    .where(conditions.length === 1 ? conditions[0]! : and(...conditions))
    .orderBy(desc(asRun.startedAt))
    .limit(limit)
}

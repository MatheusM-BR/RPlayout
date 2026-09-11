import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte } from 'drizzle-orm'
import { framesSinceMidnight, msToFrames } from '@rplayout/protocol'
import type { Channel } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { asRun } from '../db/schema.js'
import type { RundownView } from './plan.js'

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
  /** A linha aberta agora, para fechá-la quando o item sair. */
  private open: { id: string; itemId: string; startedMs: number } | null = null

  constructor(
    private readonly db: Db,
    private readonly channel: Channel,
  ) {}

  /**
   * Registra o item que está no ar. Chamado a cada volta do laço: barato
   * porque só escreve quando o que está no ar muda.
   */
  async follow(itemId: string | null, view: RundownView | null): Promise<void> {
    if (this.open?.itemId === itemId) return

    if (this.open) await this.close(this.open, itemId === null ? 'STOP' : 'NEXT')
    if (!itemId) {
      this.open = null
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
    this.open = { id, itemId, startedMs: Date.now() }
  }

  /** Fecha a linha aberta, se houver. Chamado ao encerrar o canal. */
  async finish(reason = 'STOP'): Promise<void> {
    if (!this.open) return
    await this.close(this.open, reason)
    this.open = null
  }

  private async close(open: { id: string; startedMs: number }, reason: string): Promise<void> {
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
  }
}

/** As linhas de um canal a partir de um instante, mais novas primeiro. */
export async function listAsRun(
  db: Db,
  channelId: string,
  since: string,
  limit = 200,
): Promise<AsRunEntry[]> {
  return db
    .select()
    .from(asRun)
    .where(and(eq(asRun.channelId, channelId), gte(asRun.startedAt, since)))
    .orderBy(desc(asRun.startedAt))
    .limit(limit)
}

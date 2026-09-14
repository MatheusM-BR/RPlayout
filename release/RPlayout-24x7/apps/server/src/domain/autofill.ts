import { and, eq, sql } from 'drizzle-orm'
import { durationIn, resolveTrim, secondsToFrames, trimDuration } from '@rplayout/protocol'
import type { Channel, Frames, MediaAsset } from '@rplayout/protocol'
import { autoFill, preferences, type Candidate, type FillResult } from '@rplayout/scheduler'
import type { Db } from '../db/client.js'
import { asRun, operatorDecisions } from '../db/schema.js'

/**
 * A montagem automática do lado do servidor: junta o que o acervo tem com o
 * que já aconteceu e chama a função pura que decide.
 *
 * O aprendizado sai de duas fontes que já existiam sem que ninguém as tivesse
 * usado ainda: o log de decisões do operador e o as-run. Uma diz o que ele
 * escolheu, a outra diz o que realmente foi ao ar -- e é a diferença entre as
 * duas que ensina.
 */
export async function buildCandidates(
  db: Db,
  channel: Channel,
  assets: readonly MediaAsset[],
): Promise<Candidate[]> {
  const [inserted, dropped, aired] = await Promise.all([
    countByMedia(db, 'ITEM_ADDED'),
    countByMedia(db, 'ITEM_REMOVED'),
    db
      .select({ mediaId: asRun.mediaId, last: sql<string>`max(started_at)` })
      .from(asRun)
      .where(and(eq(asRun.channelId, channel.id), sql`media_id is not null`))
      .groupBy(asRun.mediaId),
  ])

  // O log guarda item, não arquivo: o que interessa para o aprendizado é o
  // arquivo, porque é ele que volta a ser oferecido na próxima montagem.
  const lastAired = new Map<string, number>()
  for (const row of aired) {
    if (row.mediaId && row.last) lastAired.set(row.mediaId, Date.parse(row.last))
  }

  const weights = preferences(
    assets.map((asset) => ({
      mediaId: asset.id,
      inserted: inserted.get(asset.id) ?? 0,
      dropped: dropped.get(asset.id) ?? 0,
    })),
  )

  return assets
    .filter((asset) => asset.probeError === null)
    .map((asset) => ({
      id: asset.id,
      durationFrames: assetDuration(asset, channel),
      categoryId: asset.categoryId,
      lastAiredMs: lastAired.get(asset.id) ?? null,
      preference: weights.get(asset.id) ?? 0,
    }))
    .filter((candidate) => candidate.durationFrames > 0)
}

/**
 * Quantas vezes cada arquivo apareceu numa decisão daquele tipo.
 *
 * O log guarda o item, que morre com a grade; o arquivo é o que sobrevive e é
 * sobre ele que se aprende -- por isso ele vai no corpo da decisão.
 */
async function countByMedia(db: Db, kind: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      mediaId: sql<string | null>`json_extract(payload, '$.mediaId')`,
      count: sql<number>`count(*)`,
    })
    .from(operatorDecisions)
    .where(eq(operatorDecisions.kind, kind))
    .groupBy(sql`json_extract(payload, '$.mediaId')`)

  const counts = new Map<string, number>()
  for (const row of rows) if (row.mediaId) counts.set(row.mediaId, Number(row.count))
  return counts
}

/** Duração no ar: o corte padrão manda, não o arquivo inteiro. */
function assetDuration(asset: MediaAsset, channel: Channel): Frames {
  return trimDuration(resolveTrim(null, asset, channel.rate).value)
}

export interface FillPlan extends FillResult {
  /** Quanto tempo foi pedido, para a interface mostrar o que ficou de fora. */
  readonly window: Frames
}

/** Monta o plano sem gravar nada: a interface mostra antes de aplicar. */
export function planFill(
  candidates: readonly Candidate[],
  channel: Channel,
  windowFrames: Frames,
  categories: readonly string[],
  avoidWithinMinutes: number,
): FillPlan {
  const result = autoFill({
    window: windowFrames,
    candidates,
    categories,
    avoidWithinMs: avoidWithinMinutes * 60_000,
    nowMs: Date.now(),
    // Um item a menos e a grade fica curta; a folga é o que o filler cobre.
    slackFrames: secondsToFrames(15, channel.rate),
  })
  return { ...result, window: windowFrames }
}

export const assetDurationFor = (asset: MediaAsset, channel: Channel): Frames =>
  durationIn(asset, channel.rate)

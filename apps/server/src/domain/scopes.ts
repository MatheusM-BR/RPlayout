import { and, eq, inArray } from 'drizzle-orm'
import type { AudioLevel, EditScope, Trim } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { mediaAssets, rundownItems } from '../db/schema.js'

export interface ScopeResult {
  /** Quantos itens do rundown mudaram. */
  readonly itemsAffected: number
  /** Se o padrão do acervo foi reescrito. */
  readonly assetUpdated: boolean
  readonly message: string
}

/** Quais linhas um escopo vai tocar. O desfazer precisa saber antes de aplicar. */
export async function targetItemIds(
  db: Db,
  itemId: string,
  scope: EditScope,
): Promise<{ ids: string[]; mediaId: string | null; rundownId: string }> {
  const [row] = await db
    .select({
      id: rundownItems.id,
      mediaId: rundownItems.mediaId,
      rundownId: rundownItems.rundownId,
    })
    .from(rundownItems)
    .where(eq(rundownItems.id, itemId))

  if (!row) throw new Error(`Item ${itemId} não existe.`)
  if (!row.mediaId || scope === 'ITEM' || scope === 'ASSET_DEFAULT') {
    return { ids: [row.id], mediaId: row.mediaId, rundownId: row.rundownId }
  }

  const siblings = await db
    .select({ id: rundownItems.id })
    .from(rundownItems)
    .where(
      scope === 'RUNDOWN'
        ? and(eq(rundownItems.mediaId, row.mediaId), eq(rundownItems.rundownId, row.rundownId))
        : eq(rundownItems.mediaId, row.mediaId),
    )

  return { ids: siblings.map((s) => s.id), mediaId: row.mediaId, rundownId: row.rundownId }
}

/**
 * Grava o corte no escopo escolhido.
 *
 * `ASSET_DEFAULT` grava no acervo e limpa o override deste item, para que ele
 * passe a herdar de verdade — senão o operador escolhe "padrão do acervo" e a
 * linha continua mostrando o selo de override, o que não faz sentido nenhum.
 */
export async function applyTrim(
  db: Db,
  itemId: string,
  trim: Trim,
  scope: EditScope,
): Promise<ScopeResult> {
  const { ids, mediaId } = await targetItemIds(db, itemId, scope)

  if (scope === 'ASSET_DEFAULT') {
    if (!mediaId) throw new Error('Item sem arquivo não tem padrão de acervo.')
    await db.update(mediaAssets).set({ defaultTrim: trim }).where(eq(mediaAssets.id, mediaId))
    await db.update(rundownItems).set({ trim: null }).where(eq(rundownItems.id, itemId))
    return {
      itemsAffected: 1,
      assetUpdated: true,
      message: 'Corte gravado como padrão do acervo. Item novo já nasce cortado.',
    }
  }

  await db.update(rundownItems).set({ trim }).where(inArray(rundownItems.id, ids))
  return {
    itemsAffected: ids.length,
    assetUpdated: false,
    message:
      ids.length === 1
        ? 'Corte aplicado só neste item.'
        : `Corte aplicado em ${ids.length} itens do mesmo arquivo.`,
  }
}

/** Mesma mecânica do corte, para o nivelamento de áudio. */
export async function applyAudio(
  db: Db,
  itemId: string,
  audio: AudioLevel,
  scope: EditScope,
): Promise<ScopeResult> {
  const { ids, mediaId } = await targetItemIds(db, itemId, scope)

  if (scope === 'ASSET_DEFAULT') {
    if (!mediaId) throw new Error('Item sem arquivo não tem padrão de acervo.')
    await db.update(mediaAssets).set({ defaultAudio: audio }).where(eq(mediaAssets.id, mediaId))
    await db.update(rundownItems).set({ audio: null }).where(eq(rundownItems.id, itemId))
    return {
      itemsAffected: 1,
      assetUpdated: true,
      message: 'Nível gravado como padrão do acervo. Item novo já nasce nivelado.',
    }
  }

  await db.update(rundownItems).set({ audio }).where(inArray(rundownItems.id, ids))
  return {
    itemsAffected: ids.length,
    assetUpdated: false,
    message:
      ids.length === 1
        ? 'Nível aplicado só neste item.'
        : `Nível aplicado em ${ids.length} itens do mesmo arquivo.`,
  }
}

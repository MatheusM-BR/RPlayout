import { eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { mediaAssets, rundownItems, itemGraphics } from '../db/schema.js'

type ItemRow = typeof rundownItems.$inferSelect
type AssetRow = typeof mediaAssets.$inferSelect

/**
 * O que uma operação pode ter mexido. Guardar só isso, em vez do banco
 * inteiro, é o que permite desfazer sem carregar a grade toda a cada clique.
 */
export interface Target {
  /** A operação mexe na ordem ou na quantidade de itens da grade. */
  readonly wholeRundown?: boolean
  readonly itemIds?: readonly string[]
  readonly assetIds?: readonly string[]
}

interface Frame {
  readonly label: string
  readonly target: Target
  readonly rundownId: string
  readonly items: ItemRow[]
  readonly assets: AssetRow[]
  readonly cues: (typeof itemGraphics.$inferSelect)[]
}

export interface HistoryState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undoLabel: string | null
  readonly redoLabel: string | null
}

const EMPTY: HistoryState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }

/** Passos guardados por grade. Além disso, o operador já não lembra o que fez. */
const LIMIT = 50

async function read(
  db: Db,
  rundownId: string,
  label: string,
  target: Target,
): Promise<Frame> {
  const items = target.wholeRundown
    ? await db.select().from(rundownItems).where(eq(rundownItems.rundownId, rundownId))
    : target.itemIds && target.itemIds.length > 0
      ? await db.select().from(rundownItems).where(inArray(rundownItems.id, [...target.itemIds]))
      : []

  const assets =
    target.assetIds && target.assetIds.length > 0
      ? await db.select().from(mediaAssets).where(inArray(mediaAssets.id, [...target.assetIds]))
      : []

  const cues = target.wholeRundown && items.length > 0
    ? await db.select().from(itemGraphics).where(inArray(itemGraphics.itemId, items.map((item) => item.id)))
    : []
  return { label, target, rundownId, items, assets, cues }
}

async function restore(db: Db, frame: Frame): Promise<void> {
  db.transaction((tx) => {
  if (frame.target.wholeRundown) {
    // Ordem e quantidade voltam juntas: reescreve a grade como ela estava.
    tx.delete(rundownItems).where(eq(rundownItems.rundownId, frame.rundownId)).run()
    for (const item of frame.items) tx.insert(rundownItems).values(item).run()
    for (const cue of frame.cues) tx.insert(itemGraphics).values(cue).run()
  } else {
    for (const item of frame.items) {
      tx.update(rundownItems).set(item).where(eq(rundownItems.id, item.id)).run()
    }
  }

  for (const asset of frame.assets) {
    tx
      .update(mediaAssets)
      .set({ defaultTrim: asset.defaultTrim, defaultAudio: asset.defaultAudio })
      .where(eq(mediaAssets.id, asset.id))
      .run()
  }
  })
}

/**
 * Pilha de desfazer por grade.
 *
 * Vive na memória do servidor: o que importa é desfazer o erro que acabou de
 * acontecer, e um playout raramente reinicia no meio de uma edição. Trocar por
 * histórico persistido é só mudar o armazenamento destas duas pilhas.
 */
export class History {
  private readonly past = new Map<string, Frame[]>()
  private readonly future = new Map<string, Frame[]>()
  private readonly pending = new Map<string, Promise<unknown>>()

  state(rundownId: string): HistoryState {
    const past = this.past.get(rundownId) ?? []
    const future = this.future.get(rundownId) ?? []
    if (past.length === 0 && future.length === 0) return EMPTY
    return {
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoLabel: past[past.length - 1]?.label ?? null,
      redoLabel: future[future.length - 1]?.label ?? null,
    }
  }

  /** Guarda o estado atual ANTES da alteração. Refazer é descartado. */
  async capture(db: Db, rundownId: string, label: string, target: Target): Promise<void> {
    const frame = await read(db, rundownId, label, target)
    const stack = this.past.get(rundownId) ?? []
    stack.push(frame)
    if (stack.length > LIMIT) stack.shift()
    this.past.set(rundownId, stack)
    this.future.delete(rundownId)
  }

  private async step(db: Db, rundownId: string, from: Map<string, Frame[]>, to: Map<string, Frame[]>) {
    const stack = from.get(rundownId)
    const frame = stack?.[stack.length - 1]
    if (!frame) return null

    // O estado atual vira o passo contrário antes de ser sobrescrito.
    const mirror = await read(db, rundownId, frame.label, frame.target)
    await restore(db, frame)
    stack!.pop()

    const other = to.get(rundownId) ?? []
    other.push(mirror)
    if (other.length > LIMIT) other.shift()
    to.set(rundownId, other)
    return frame.label
  }

  undo(db: Db, rundownId: string): Promise<string | null> {
    return this.serial(rundownId, () => this.step(db, rundownId, this.past, this.future))
  }

  redo(db: Db, rundownId: string): Promise<string | null> {
    return this.serial(rundownId, () => this.step(db, rundownId, this.future, this.past))
  }

  private serial<T>(rundownId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(rundownId) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    this.pending.set(rundownId, current)
    void current.finally(() => {
      if (this.pending.get(rundownId) === current) this.pending.delete(rundownId)
    })
    return current
  }

  forget(rundownId: string): void {
    this.past.delete(rundownId)
    this.future.delete(rundownId)
  }
}

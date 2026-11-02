import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { ItemView } from './plan.js'

export interface InterruptedItem {
  id: string; channel_id: string; rundown_id: string; item_id: string; revision_id: string | null
  title: string; frames: number; state: string; created_at: string
}
function specification(entry: ItemView): string {
  return JSON.stringify({ mediaId: entry.item.mediaId, hash: entry.asset?.contentHash, trim: entry.trim,
    audio: entry.audio, gainDb: entry.gainDb, fit: entry.item.fit, audioTrack: entry.item.audioTrack })
}

/** Only a confirmed program change can leave an interrupted file for return.
 * Cursor is the last position reported by the engine, not a fabricated exact cut. */
export class Interruptions {
  constructor(private readonly sqlite: Database.Database) {}
  record(channelId: string, rundownId: string, revisionId: string | null, entry: ItemView, frames: number): string | null {
    if (!entry.asset || entry.asset.kind !== 'VIDEO' || entry.item.sourceRef || !Number.isSafeInteger(frames) || frames <= 0 || frames >= entry.trim.out-entry.trim.in) return null
    const id = randomUUID()
    this.sqlite.prepare("INSERT INTO interrupted_items (id,channel_id,rundown_id,item_id,revision_id,title,frames,specification,state,created_at) VALUES (?,?,?,?,?,?,?,?,'PENDING',?)")
      .run(id, channelId, rundownId, entry.item.id, revisionId, entry.item.title, frames, specification(entry), new Date().toISOString())
    return id
  }
  list(channelId: string): InterruptedItem[] {
    return this.sqlite.prepare("SELECT id,channel_id,rundown_id,item_id,revision_id,title,frames,state,created_at FROM interrupted_items WHERE channel_id=? AND state IN ('PENDING','RESUMING','UNCERTAIN') ORDER BY created_at DESC").all(channelId) as InterruptedItem[]
  }
  validateEntry(channelId: string, id: string, rundownId: string, entry: ItemView): InterruptedItem {
      const row = this.sqlite.prepare("SELECT * FROM interrupted_items WHERE id=? AND channel_id=? AND state IN ('PENDING','RESUMING')").get(id, channelId) as (InterruptedItem & { specification: string }) | undefined
      if (!row || row.rundown_id !== rundownId || row.item_id !== entry.item.id) throw new Error('Este VT interrompido não pertence à playlist carregada ou já foi resolvido.')
      if (row.specification !== specification(entry)) throw new Error('A mídia, o corte ou o áudio mudou após a interrupção. Não é seguro aplicar o cursor antigo.')
      if (row.frames >= entry.trim.out-entry.trim.in) throw new Error('O ponto de retorno está além do Mark Out atual.')
      return row
  }
}

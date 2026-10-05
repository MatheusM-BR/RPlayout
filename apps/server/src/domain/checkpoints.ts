import { z } from 'zod'
import type Database from 'better-sqlite3'

const checkpointSchema = z.object({
  version: z.literal(1), channelId: z.string(), rundownId: z.string().nullable(),
  revisionId: z.string().nullable(), itemId: z.string().nullable(),
  elapsed: z.number().int().nonnegative(), playing: z.boolean(), realEngine: z.boolean(),
  executionId: z.string().optional(),
  audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]).optional(),
  rate: z.object({ num: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), den: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).optional(),
  contingency: z.object({ loopRevisionId: z.string(), loopRundownId: z.string(), rundownId: z.string().nullable(), revisionId: z.string().nullable(),
    itemId: z.string().nullable(), elapsed: z.number().int().nonnegative(), activatedAt: z.string() }).optional(),
}).refine((value) => !value.playing || Boolean(value.rundownId && value.itemId), 'PGM sem item/grade')
export type ChannelCheckpoint = z.infer<typeof checkpointSchema>
export function parseChannelCheckpoint(value:unknown,channelId?:string):ChannelCheckpoint{
  const valid=checkpointSchema.parse(value)
  if(channelId!==undefined&&valid.channelId!==channelId)throw new Error('Checkpoint pertence a outro canal.')
  return valid
}

export class Checkpoints {
  constructor(private readonly sqlite: Database.Database) {}
  read(channelId: string): ChannelCheckpoint | null {
    const row = this.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id = ?').get(channelId) as { payload: string } | undefined
    if (!row) return null
    return parseChannelCheckpoint(JSON.parse(row.payload),channelId)
  }
  write(value: ChannelCheckpoint): void {
    const valid = parseChannelCheckpoint(value)
    this.sqlite.prepare(`INSERT INTO channel_checkpoints (channel_id, payload, saved_at) VALUES (?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET payload=excluded.payload, saved_at=excluded.saved_at`)
      .run(valid.channelId, JSON.stringify(valid), new Date().toISOString())
  }
}

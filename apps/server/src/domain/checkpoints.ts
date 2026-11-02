import { z } from 'zod'
import type Database from 'better-sqlite3'
import {readExecutionOwner} from '../db/execution-ownership.js'
import type {ExecutionLease} from './execution-ownership.js'
import {programTrimSchema} from './program-trim.js'
import {liveProgramBindingSchema,assertLiveProgramBindingCursor} from './live-program-binding.js'

const checkpointSchema = z.object({
  version: z.union([z.literal(1),z.literal(2)]), channelId: z.string(), rundownId: z.string().nullable(),
  revisionId: z.string().nullable(), itemId: z.string().nullable(),
  elapsed: z.number().int().nonnegative(), playing: z.boolean(), realEngine: z.boolean(),
  executionId: z.string().optional(),
  liveProgramBinding:liveProgramBindingSchema.optional(),
  graphicReceiptId:z.string().min(1).max(256).optional(),
  programTrim:programTrimSchema.optional(),
  programHold:z.object({status:z.literal('HELD'),decoderId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),frames:z.number().int().nonnegative()}).strict().optional(),
  ownerRunId:z.string().uuid().optional(),
  audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]).optional(),
  rate: z.object({ num: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), den: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).optional(),
  contingency: z.object({ loopRevisionId: z.string(), loopRundownId: z.string(), rundownId: z.string().nullable(), revisionId: z.string().nullable(),
    itemId: z.string().nullable(), elapsed: z.number().int().nonnegative(), activatedAt: z.string() }).optional(),
}).superRefine((value,ctx)=>{
  if((value.version===2)!==Boolean(value.liveProgramBinding))ctx.addIssue({code:'custom',message:'Checkpoint v2 exige vínculo de fonte; versão1 não pode descartá-lo silenciosamente.'})
  if(value.liveProgramBinding)try{assertLiveProgramBindingCursor(value.liveProgramBinding,value)}catch{ctx.addIssue({code:'custom',message:'Vínculo da fonte não corresponde ao checkpoint.'})}
}).refine((value) => !value.playing || Boolean(value.rundownId && value.itemId), 'PGM sem item/grade')
  .refine(value=>!value.programHold||(!value.playing&&value.realEngine&&Boolean(value.itemId&&value.rundownId&&value.revisionId&&value.programTrim)&&value.elapsed===value.programHold.frames),'Quadro mantido salvo exige identidade, corte e cursor nativos confirmados')
  .refine(value=>!value.programTrim||((value.playing||Boolean(value.programHold))&&value.realEngine&&Boolean(value.itemId)&&value.elapsed<value.programTrim.out-value.programTrim.in),'Corte salvo não corresponde a PGM nativo reproduzível')
export type ChannelCheckpoint = z.infer<typeof checkpointSchema>
export function stoppedCheckpoint(value:ChannelCheckpoint):ChannelCheckpoint{
 return {...value,version:1,playing:false,itemId:null,elapsed:0,liveProgramBinding:undefined,programHold:undefined,programTrim:undefined,contingency:undefined}
}
export function parseChannelCheckpoint(value:unknown,channelId?:string):ChannelCheckpoint{
  const valid=checkpointSchema.parse(value)
  if(channelId!==undefined&&valid.channelId!==channelId)throw new Error('Checkpoint pertence a outro canal.')
  return valid
}

export class Checkpoints {
  constructor(private readonly sqlite: Database.Database,private readonly lease:ExecutionLease|null=null) {}
  /** Atomic receipt/cursor writes must use the exact owning SQL connection. */
  assertConnection(sqlite:Database.Database):void{
    if(this.sqlite!==sqlite)throw new Error('Checkpoint e journal exigem a mesma conexão SQLite.')
  }
  read(channelId: string): ChannelCheckpoint | null {
    const row = this.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id = ?').get(channelId) as { payload: string } | undefined
    if (!row) return null
    return parseChannelCheckpoint(JSON.parse(row.payload),channelId)
  }
  write(value: ChannelCheckpoint): void {
    this.sqlite.transaction(()=>{
      const valid = parseChannelCheckpoint(value),owner=readExecutionOwner(this.sqlite,valid.channelId)
      const previous=this.read(valid.channelId)
      if(previous?.version===2&&valid.version===1&&valid.playing&&valid.itemId===previous.itemId&&valid.executionId===previous.executionId)throw new Error('Checkpoint não pode descartar a fonte confirmada da mesma ocorrência.')
      if(this.lease){
        const current=this.lease.assertOwned();if(current.channelId!==valid.channelId||!valid.realEngine)throw new Error('Checkpoint não pertence ao dono/engine nativo.')
        if((previous?.playing||previous?.programHold)&&previous.ownerRunId!==current.id&&!valid.playing&&!current.predecessorResolved)throw new Error('Cursor do predecessor preservado até recuperação confirmada ou STOP explícito confirmado; runtime vazio não é parada.')
        valid.ownerRunId=current.id
      }
      else if(owner||valid.ownerRunId)throw new Error('Checkpoint protegido por posse nativa; um runtime parado/simulado não pode sobrescrevê-lo.')
      this.sqlite.prepare(`INSERT INTO channel_checkpoints (channel_id, payload, saved_at) VALUES (?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET payload=excluded.payload, saved_at=excluded.saved_at`)
        .run(valid.channelId, JSON.stringify(valid), new Date().toISOString())
    }).immediate()
  }
}

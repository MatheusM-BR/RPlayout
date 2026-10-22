import {z} from 'zod'
import {durationIn,type Rate} from '@rplayout/protocol'
import type {ItemView} from './plan.js'
export const programTrimSchema=z.object({
  in:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  out:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  contentHash:z.string().regex(/^[a-f0-9]{64}$/i),
}).strict().refine(cut=>cut.out>cut.in,'Corte do PGM vazio ou invertido')
export type ProgramTrim=z.infer<typeof programTrimSchema>
/** Saved decoder bounds are evidence, not permission to load a different file. */
export function assertProgramTrim(entry:Pick<ItemView,'item'|'asset'|'trim'>,value:ProgramTrim,frames:number,rate:Rate):ProgramTrim{
  const cut=programTrimSchema.parse(value)
  if(!entry.asset||entry.item.sourceRef||entry.item.liveEndpoint||entry.item.liveConfig?.sourceEndpoint)throw new Error('Corte salvo exige arquivo, não entrada ao vivo.')
  if(entry.asset.contentHash?.toLowerCase()!==cut.contentHash.toLowerCase())throw new Error('A versão da mídia mudou desde o corte salvo; recuperação automática recusada.')
  if(cut.in!==entry.trim.in)throw new Error('O início do corte publicado mudou desde o PGM salvo; confira o item antes de retomar.')
  const available=durationIn(entry.asset,rate)
  if(!Number.isFinite(available)||cut.out>available)throw new Error('O corte salvo excede os quadros comprovados do arquivo.')
  if(!Number.isSafeInteger(frames)||frames<0||frames>=cut.out-cut.in)throw new Error('Cursor fora do corte salvo; recuperação não repetirá o último quadro nem outro item.')
  return cut
}

import {z} from 'zod'
/** Shared by local editing, project import and HA restore: never strip rules. */
export const renderedBusPairPolicySchema=z.object({outputPair:z.number().int().min(1).max(8),loudness:z.object({minLufs:z.number().finite().min(-100).max(0),maxLufs:z.number().finite().min(-100).max(0)}).strict().refine(value=>value.minLufs<=value.maxLufs,'Faixa de loudness inválida.').nullable(),maxTruePeakDbtp:z.number().finite().min(-100).max(0)}).strict()
export const renderedBusPairsSchema=z.array(renderedBusPairPolicySchema).refine(pairs=>[1,4,8].includes(pairs.length)&&pairs.every((pair,index)=>pair.outputPair===index+1),'Declare todos os pares em ordem (2, 8 ou 16 canais).')

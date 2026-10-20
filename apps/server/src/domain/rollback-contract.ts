import {z} from 'zod'
import type Database from 'better-sqlite3'
import {parseChannelCheckpoint} from './checkpoints.js'
import {supportedSchemaMigrations} from '../db/schema-compatibility.js'

export const rollbackContractSchema=z.object({version:z.literal(1),migrations:z.array(z.string().min(1)).min(1).max(1000),restorationReceipt:z.literal(1),nativeActivation:z.literal(1),installationProfile:z.literal(1),channelCheckpointVersions:z.array(z.union([z.literal(1),z.literal(2)])).min(1).max(2).default([1])}).strict()
export type RollbackContract=z.infer<typeof rollbackContractSchema>
export const currentRollbackContract=():RollbackContract=>({version:1,migrations:[...supportedSchemaMigrations],restorationReceipt:1,nativeActivation:1,installationProfile:1,channelCheckpointVersions:[1,2]})
// Pre-contract release qualified by actual installed restore/admission tests.
// Freeze its complete manifest identity and schema boundary, not a filename or
// "same major version" guess. Unknown historical packages remain unsupported.
export function qualifiedHistoricalRollbackContract(manifestSha256:string):RollbackContract{
  if(manifestSha256.toLowerCase()!=='6897c8e308cf40893804b9313a10255f75271c5028ead63ff6c6e1d66d2e981c')throw new Error('Edição de retorno sem contrato compatível ou qualificação histórica conhecida.')
  return {...currentRollbackContract(),migrations:[...supportedSchemaMigrations.slice(0,50)],channelCheckpointVersions:[1]}
}
/** Exact SQL schema alone is insufficient: historical parsers must not ignore
 * a selected live leg or claim a v2 snapshot is a qualified v1 rollback. */
export function assertRollbackCheckpointData(sqlite:Pick<Database.Database,'prepare'>,input:unknown){
 const contract=rollbackContractSchema.parse(input),rows=sqlite.prepare('SELECT channel_id,payload FROM channel_checkpoints').all() as {channel_id:string;payload:string}[],versions=new Set<number>()
 for(const row of rows){
  let value:Record<string,unknown>
  try{value=JSON.parse(row.payload)}catch{throw new Error('Checkpoint corrompido no snapshot; retorno recusado.')}
  if(!value||typeof value!=='object'||Array.isArray(value)||!contract.channelCheckpointVersions.includes(value.version as 1|2)
   ||(value.version===2)!==Boolean(value.liveProgramBinding))throw new Error('Edição de retorno não aceita o formato/vínculo de fonte dos checkpoints atuais. Não remover dados para forçar retorno.')
  try{parseChannelCheckpoint(value,row.channel_id)}catch{throw new Error('Checkpoint inválido no snapshot; não qualificar retorno a partir de dados corrompidos.')}
  versions.add(value.version as number)
 }
 return {checkpointCount:rows.length,versionsUsed:[...versions].sort()}
}
export function assertRollbackSchema(rows:readonly {version:number;name:string}[],input:unknown){
  const contract=rollbackContractSchema.parse(input)
  if(rows.length!==contract.migrations.length||rows.some((row,index)=>row.version!==index+1||row.name!==contract.migrations[index]))throw new Error('Edição de retorno não aceita exatamente o schema atual. Não remover marcadores nem descartar dados para forçar downgrade.')
  return contract
}

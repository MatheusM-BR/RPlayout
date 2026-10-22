import type Database from 'better-sqlite3'
import {z} from 'zod'
import {protectedColumns} from '../db/protected-columns.js'
import {installationVault} from './secret-vault.js'
import {haOwnershipEvidence,inspectStoredOwnershipEvidence} from './ha-return-ownership-evidence.js'
export const haRekeyReviewContext=z.object({exportId:z.string().uuid(),vaultFingerprint:z.string().regex(/^[a-f0-9]{64}$/),ownershipEvidence:haOwnershipEvidence.optional()}).strict()
/** Decode only in the private readonly inspection worker. No plaintext/paths
 * returned. Encoding confirmation is NOT semantic or operational approval. */
export function inspectRekeyedFields(db:Database.Database,raw:z.infer<typeof haRekeyReviewContext>){
  const expected=haRekeyReviewContext.parse(raw),vault=installationVault(false)
  if(vault.fingerprint!==expected.vaultFingerprint)throw new Error('Worker abriu cofre diferente da derivada.')
  let fields=0,bytes=0
  const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"'
  for(const [table,column] of protectedColumns){
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue
    for(const row of db.prepare('SELECT '+quote(column)+' AS value FROM '+quote(table)+' WHERE '+quote(column)+' IS NOT NULL').iterate() as Iterable<{value:unknown}>){
      if(typeof row.value!=='string'||row.value.length>8*1024*1024||++fields>100000||(bytes+=Buffer.byteLength(row.value))>128*1024*1024)throw new Error('Campos reprotegidos excedem limite.')
      vault.decrypt(row.value,table+'.'+column)
    }
  }
  const foreignOwnership=inspectStoredOwnershipEvidence(db,expected.exportId,vault,expected.ownershipEvidence)
  return {fields,encodingValidated:true as const,contentApproved:false as const,vaultFingerprint:vault.fingerprint,foreignOwnership,localExecutionAuthorized:false as const}
}

import type Database from 'better-sqlite3'
import {createHmac,createHash} from 'node:crypto'
import {z} from 'zod'
import {SecretVault,installationVault} from './secret-vault.js'
import {protectedColumns} from '../db/protected-columns.js'
import {assertSchemaCompatibility} from '../db/schema-compatibility.js'
import {haOwnershipEvidence,exportOwnershipEvidence,importOwnershipEvidence} from './ha-return-ownership-evidence.js'

export const haProtectedBridgeProof=z.object({version:z.literal(1),entries:z.number().int().nonnegative().max(100000),inventoryMac:z.string().regex(/^[A-Za-z0-9_-]{43}$/),pairingFingerprint:z.string().regex(/^[a-f0-9]{64}$/),encoding:z.literal('EXPORT_SCOPED_PAIRING_ENVELOPES'),ownershipEvidence:haOwnershipEvidence.optional()}).strict()
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"'
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
function bridgeVault(pairingKey:string,exportId:string){
  z.string().uuid().parse(exportId);if(!/^[a-f0-9]{64}$/i.test(pairingKey))throw new Error('Pareamento incompatível.')
  const raw=Buffer.from(pairingKey,'hex'),derived=createHmac('sha256',raw).update('rplayout-ha-protected-bridge:v1\0'+exportId).digest()
  try{return new SecretVault(derived)}finally{raw.fill(0);derived.fill(0)}
}
const context=(exportId:string,table:string,column:string,key:string)=>JSON.stringify(['ha-protected-bridge',1,exportId,table,column,key])
/** Called only on a NEW private export derivative. Plaintext exists in memory
 * briefly; neither node's installation key is serialized or sent. */
export function exportProtectedBridge(db:Database.Database,exportId:string,pairingKey:string){
  assertSchemaCompatibility(db,true)
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ha_protected_field_bridge'").get())throw new Error('Ponte já existe; não adotar/repetir transformação.')
  const source=installationVault(false),pairing=bridgeVault(pairingKey,exportId)
  db.pragma('trusted_schema = OFF');db.pragma('journal_mode = DELETE');db.pragma('synchronous = FULL')
  return db.transaction(()=>{
    db.exec('CREATE TABLE ha_protected_field_bridge(table_name TEXT NOT NULL,column_name TEXT NOT NULL,key_json TEXT NOT NULL,source_cipher_hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(table_name,column_name,key_json))')
    const insert=db.prepare('INSERT INTO ha_protected_field_bridge VALUES(?,?,?,?,?)'),inventory=createHash('sha256')
    let entries=0,bytes=0
    for(const [table,column] of protectedColumns){
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue
      const fields=db.pragma('table_info('+quote(table)+')') as Array<{name:string;pk:number}>,keys=fields.filter(field=>field.pk>0).sort((a,b)=>a.pk-b.pk).map(field=>field.name)
      if(!fields.some(field=>field.name===column)||!keys.length||keys.includes(column))throw new Error('Tabela protegida sem identidade estável.')
      for(const row of db.prepare('SELECT '+[...keys,column].map(quote).join(',')+' FROM '+quote(table)+' WHERE '+quote(column)+' IS NOT NULL ORDER BY '+keys.map(quote).join(',')).iterate() as Iterable<Record<string,unknown>>){
        const cipher=row[column];if(typeof cipher!=='string'||cipher.length>8*1024*1024)throw new Error('Campo protegido inválido/excede limite.')
        if(keys.some(name=>!['string','number'].includes(typeof row[name])||typeof row[name]==='number'&&!Number.isSafeInteger(row[name])))throw new Error('Identidade protegida não pode ser serializada sem perda.')
        const key=JSON.stringify(keys.map(name=>[name,row[name]])),plain=source.decrypt(cipher,table+'.'+column),sourceHash=hash(cipher),payload=pairing.encrypt(plain,context(exportId,table,column,key))
        if(++entries>100000||(bytes+=Buffer.byteLength(key)+Buffer.byteLength(payload))>64*1024*1024)throw new Error('Ponte excede limite; não truncar como pronta.')
        insert.run(table,column,key,sourceHash,payload);inventory.update(JSON.stringify([table,column,key,sourceHash,payload])+'\n')
      }
    }
    const ownershipEvidence=exportOwnershipEvidence(db,exportId,pairing,source)
    const inventoryMac=pairing.reviewIdentity(inventory.digest('hex'),'ha-protected-bridge-inventory:v1')
    return haProtectedBridgeProof.parse({version:1,entries,inventoryMac,pairingFingerprint:pairing.fingerprint,encoding:'EXPORT_SCOPED_PAIRING_ENVELOPES',ownershipEvidence})
  }).immediate()
}
/** Mutates only another NEW primary derivative, never the received evidence or
 * active DB. Rekey is not approval of playlists, media, cursor or commands. */
export function importProtectedBridge(db:Database.Database,exportId:string,pairingKey:string,expected:z.infer<typeof haProtectedBridgeProof>){
  const proof=haProtectedBridgeProof.parse(expected),pairing=bridgeVault(pairingKey,exportId),target=installationVault(false)
  assertSchemaCompatibility(db,true)
  if(pairing.fingerprint!==proof.pairingFingerprint)throw new Error('Ponte pertence a outro pareamento/exportação.')
  db.pragma('trusted_schema = OFF');db.pragma('journal_mode = DELETE');db.pragma('synchronous = FULL')
  const allowed=new Set(protectedColumns.map(([table,column])=>table+'.'+column))
  return db.transaction(()=>{
    const inventory=createHash('sha256');let entries=0
    const rows=db.prepare('SELECT * FROM ha_protected_field_bridge ORDER BY rowid').all() as Array<{table_name:string;column_name:string;key_json:string;source_cipher_hash:string;payload:string}>
    if(rows.length!==proof.entries||rows.length>100000)throw new Error('Inventário de ponte incompleto.')
    let required=0
    for(const [table,column] of protectedColumns){if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;required+=(db.prepare('SELECT count(*) AS n FROM '+quote(table)+' WHERE '+quote(column)+' IS NOT NULL').get() as {n:number}).n}
    if(required!==rows.length)throw new Error('Ponte não cobre todos os campos protegidos conhecidos.')
    for(const row of rows){
      if(!allowed.has(row.table_name+'.'+row.column_name))throw new Error('Campo de ponte não autorizado.')
      const key=JSON.parse(row.key_json) as Array<[string,unknown]>,fields=db.pragma('table_info('+quote(row.table_name)+')') as Array<{name:string;pk:number}>,keys=fields.filter(field=>field.pk>0).sort((a,b)=>a.pk-b.pk).map(field=>field.name)
      if(!Array.isArray(key)||key.length!==keys.length||key.some((entry,index)=>!Array.isArray(entry)||entry.length!==2||entry[0]!==keys[index]||!['string','number'].includes(typeof entry[1])))throw new Error('Identidade de ponte inválida.')
      const where=keys.map(name=>quote(name)+'=?').join(' AND '),values=key.map(entry=>entry[1]),old=db.prepare('SELECT '+quote(row.column_name)+' AS value FROM '+quote(row.table_name)+' WHERE '+where).get(...values) as {value:unknown}|undefined
      if(!old||typeof old.value!=='string'||hash(old.value)!==row.source_cipher_hash)throw new Error('Campo de origem diverge da ponte.')
      const plain=pairing.decrypt(row.payload,context(exportId,row.table_name,row.column_name,row.key_json)),protectedValue=target.encrypt(plain,row.table_name+'.'+row.column_name)
      if(db.prepare('UPDATE '+quote(row.table_name)+' SET '+quote(row.column_name)+'=? WHERE '+where).run(protectedValue,...values).changes!==1)throw new Error('Reproteção não confirmou campo único.')
      inventory.update(JSON.stringify([row.table_name,row.column_name,row.key_json,row.source_cipher_hash,row.payload])+'\n');entries++
    }
    if(pairing.reviewIdentity(inventory.digest('hex'),'ha-protected-bridge-inventory:v1')!==proof.inventoryMac)throw new Error('Inventário da ponte alterado.')
    const ownershipEvidence=importOwnershipEvidence(db,exportId,pairing,target,proof.ownershipEvidence)
    // Transport bridge is retained in received evidence, not in the rekeyed
    // derivative; otherwise later exports could accidentally reuse its scope.
    db.exec('DROP TABLE ha_protected_field_bridge')
    return {version:1 as const,entries,vaultFingerprint:target.fingerprint,ownershipEvidence,installationKeyCopied:false as const,operationalApproved:false as const,publicationAuthorized:false as const}
  }).immediate()
}

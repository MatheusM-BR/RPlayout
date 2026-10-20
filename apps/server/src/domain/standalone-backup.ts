import type DatabaseType from 'better-sqlite3'
import Database from 'better-sqlite3'
import {open,lstat} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'

/** Export ONLY a new destination owned by this call. A SQLite backup may
 * inherit WAL header mode; later readonly inspection can then leave sidecars.
 * Finalize the NEW copy as DELETE journal before publishing its hash/result.
 * Never checkpoint, change journal mode or remove files of the live source. */
export async function writeStandaloneBackup(source:DatabaseType.Database,destination:string){
  const file=resolve(destination),handle=await open(file,'wx',0o600),identity=await handle.stat()
  await handle.close()
  const assertSame=async()=>{const actual=await lstat(file);if(!actual.isFile()||actual.isSymbolicLink()||actual.nlink!==1||actual.dev!==identity.dev||actual.ino!==identity.ino)throw new Error('Destino do backup mudou; preserve a cópia parcial.')}
  await assertSame();await source.backup(file);await assertSame()
  const snapshot=new Database(file,{fileMustExist:true})
  try{if(snapshot.pragma('journal_mode=DELETE',{simple:true})!=='delete')throw new Error('Backup não confirmou arquivo autocontido; cópia parcial preservada.')}
  finally{snapshot.close()}
  await assertSame()
  if(existsSync(file+'-wal')||existsSync(file+'-shm'))throw new Error('Backup ainda depende de auxiliares; não publicar como cópia fechada.')
  return {file,standalone:true as const}
}

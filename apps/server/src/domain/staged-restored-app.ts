import Database from 'better-sqlite3'
import {drizzle} from 'drizzle-orm/better-sqlite3'
import {lstat} from 'node:fs/promises'
import {resolve} from 'node:path'
import * as schema from '../db/schema.js'
import {createApp,type App} from '../app.js'
import {HOST_GUARD_BINARY} from '../config.js'
import {HostDistributionFence} from './host-distribution-fence.js'
import {reviewRestoredExecution} from './restored-execution-review.js'
/** Starts the full backend in quarantine under a retained native/storage
 * reservation. Explicit staging, never an operational activation fallback. */
export async function createStagedRestoredApp(file:string,manifest:string,options:{pausedPreparation?:boolean}={}):Promise<App>{
  const path=resolve(file),info=await lstat(path)
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('Banco restaurado deve existir como arquivo regular, sem links.')
  const fence=new HostDistributionFence(HOST_GUARD_BINARY)
  let source:Database.Database|null=null,app:App|null=null
  try{
    if(!await fence.acquire())throw new Error('Posse nativa não confirmada; admissão restaurada recusada.')
    source=new Database(path,{fileMustExist:true})
    await reviewRestoredExecution(drizzle(source,{schema}),resolve(manifest),fence,{cacheRoot:process.env.RPLAYOUT_CACHE,pausedPreparation:options.pausedPreparation===true,handoff:async admission=>{app=await createApp(path,{restoredAdmission:admission})}})
    if(!app)throw new Error('Backend restaurado não foi admitido.')
    return app
  }catch(error){if(app)await (app as App).close();fence.close();throw error}
  finally{source?.close()}
}

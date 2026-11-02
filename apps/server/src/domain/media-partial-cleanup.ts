import type Database from 'better-sqlite3'
import {lstat,readdir,realpath,rm} from 'node:fs/promises'
import {resolve,join,extname} from 'node:path'
import {mediaJobNeedsOwnerConfirmation} from './media-job-diagnostic.js'

const minimumAge=24*60*60_000
const canonical=(path:string)=>{const full=resolve(path);return process.platform==='win32'?full.toLowerCase():full}
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const partialName=new RegExp(`^([a-f0-9]{64})(\\.proxy\\.mp4|\\.[a-z0-9]{1,10})\\.(${uuid})\\.(${uuid})\\.part$`,'i')
export interface PartialCleanup {removed:number;preserved:number;errors:number;checkedAt:string;cursor:string|null}

/** Remove only old, recognizable cache attempts of known, non-running jobs.
 * Never traverse links/directories or remove original/archived/published paths.
 * Unknown legacy filenames and active/uncertain jobs are deliberately retained.
 */
export async function cleanupMediaPartials(sqlite:Database.Database,root:string,now=Date.now(),after:string|null=null):Promise<PartialCleanup>{
  const result:PartialCleanup={removed:0,preserved:0,errors:0,checkedAt:new Date(now).toISOString(),cursor:null}
  const absolute=resolve(root),info=await lstat(absolute)
  if(info.isSymbolicLink()||!info.isDirectory()||canonical(await realpath(absolute))!==canonical(absolute))throw new Error('Limpeza recusada: pasta de versões redirecionada ou inválida.')
  const protectedPaths=new Set<string>()
  for(const row of sqlite.prepare('SELECT path FROM media_assets UNION SELECT archive_path AS path FROM media_versions UNION SELECT output_path AS path FROM media_jobs').all() as {path:string|null}[])if(row.path)protectedPaths.add(canonical(row.path))
  for(const row of sqlite.prepare('SELECT metadata FROM media_versions').all() as {metadata:string}[]){try{const path=JSON.parse(row.metadata)?.path;if(typeof path==='string'&&path)protectedPaths.add(canonical(path))}catch{/* Corrupt metadata cannot authorize its removal below. */}}
  const lookup=sqlite.prepare('SELECT j.state,j.kind,j.error,v.content_hash,v.metadata FROM media_jobs j JOIN media_versions v ON v.id=j.version_id WHERE j.id=?')
  let examined=0
  const entries=(await readdir(absolute,{withFileTypes:true})).filter(entry=>entry.name.endsWith('.part')).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)
  const start=after?entries.findIndex(entry=>entry.name>after):0
  for(const entry of entries.slice(start<0?0:start)){
    if(++examined>200)break // Continue next pass; unknown files cannot starve it.
    result.cursor=entry.name
    const match=partialName.exec(entry.name),path=join(absolute,entry.name)
    if(!match||!entry.isFile()||entry.isSymbolicLink()||protectedPaths.has(canonical(path))){result.preserved++;continue}
    const row=lookup.get(match[3]) as {state:string;kind:string;error:string|null;content_hash:string;metadata:string}|undefined
    if(!row||row.state==='RUNNING'||mediaJobNeedsOwnerConfirmation(row.error)||row.content_hash.toLowerCase()!==match[1]!.toLowerCase()){result.preserved++;continue}
    let suffix:string
    try{
      const source=JSON.parse(row.metadata)?.path
      if(typeof source!=='string'||!source.trim())throw new Error('No source')
      const extension=extname(source)
      suffix=row.kind==='PROXY'?'.proxy.mp4':row.kind==='ARCHIVE'?(/^\.[a-z0-9]{1,10}$/i.test(extension)?extension:'.media'):''
    }catch{result.preserved++;continue}
    if(!suffix||suffix.toLowerCase()!==match[2]!.toLowerCase()){result.preserved++;continue}
    try{
      const current=await lstat(path)
      if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||now-current.mtimeMs<minimumAge){result.preserved++;continue}
      // The root and identity are checked again immediately before unlink.
      const rootNow=await lstat(absolute),latest=await lstat(path)
      if(rootNow.isSymbolicLink()||rootNow.dev!==info.dev||rootNow.ino!==info.ino||latest.dev!==current.dev||latest.ino!==current.ino||latest.mtimeMs!==current.mtimeMs||latest.size!==current.size||latest.nlink!==1||latest.isSymbolicLink()){result.preserved++;continue}
      const ownerNow=lookup.get(match[3]) as {state:string;error:string|null}|undefined
      if(!ownerNow||ownerNow.state==='RUNNING'||mediaJobNeedsOwnerConfirmation(ownerNow.error)){result.preserved++;continue}
      await rm(path,{force:false});result.removed++
    }catch{result.errors++} // A racing cleanup or locked file is not job failure.
  }
  if(examined<=200)result.cursor=null
  return result
}

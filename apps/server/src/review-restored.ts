import Database from 'better-sqlite3'
import {drizzle} from 'drizzle-orm/better-sqlite3'
import {resolve} from 'node:path'
import {lstat} from 'node:fs/promises'
import * as schema from './db/schema.js'
import {reviewRestoredExecution} from './domain/restored-execution-review.js'
import {HostDistributionFence} from './domain/host-distribution-fence.js'
import {sanitizeDiagnostic} from './domain/sanitize-diagnostic.js'
/** Explicit offline preparation only. Uses the packaged native host guard;
 * no simulated fallback, engines, discovery, workers or schema upgrades. */
async function main(){
  const args=process.argv.slice(2),values=new Map<string,string>()
  for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--database','--manifest','--vault-file','--cache'].includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('Informe --database, --manifest e, se necessário, --vault-file/--cache; sem opções repetidas.');values.set(key,value)}
  if(!values.has('--database')||!values.has('--manifest'))throw new Error('Banco restaurado e manifesto protegido são obrigatórios.')
  if(values.has('--vault-file')){if(process.env.RPLAYOUT_VAULT_KEY)throw new Error('Escolha cofre original ou chave no ambiente, não ambos.');process.env.RPLAYOUT_VAULT_FILE=resolve(values.get('--vault-file')!)}
  const file=resolve(values.get('--database')!),info=await lstat(file)
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('Banco deve existir como arquivo regular, sem links.')
  const {HOST_GUARD_BINARY}=await import('./config.js'),fence=new HostDistributionFence(HOST_GUARD_BINARY)
  let sqlite:Database.Database|null=null
  try{
    if(!await fence.acquire())throw new Error('Posse nativa do computador não confirmada; preparação recusada.')
    sqlite=new Database(file,{fileMustExist:true});sqlite.pragma('foreign_keys=ON');sqlite.pragma('synchronous=FULL')
    const report=await reviewRestoredExecution(drizzle(sqlite,{schema}),resolve(values.get('--manifest')!),fence,{cacheRoot:values.has('--cache')?resolve(values.get('--cache')!):undefined})
    process.stdout.write(JSON.stringify(report)+'\n')
  }finally{sqlite?.close();fence.close()}
}
void main().catch(error=>{process.stderr.write(sanitizeDiagnostic(error instanceof Error?error.message:'Preparação recusada; quarentena preservada.')+'\n');process.exitCode=1})

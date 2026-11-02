import {resolve} from 'node:path'
import {HostDistributionFence} from './domain/host-distribution-fence.js'
import {migrateRestoredCopy} from './domain/migrate-restored-copy.js'
import {sanitizeDiagnostic} from './domain/sanitize-diagnostic.js'
async function main(){
  const values=new Map<string,string>(),args=process.argv.slice(2)
  for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];if(!['--database','--manifest','--vault-file'].includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('Informe banco, manifesto e cofre original sem opções repetidas.');values.set(key,value)}
  if(!values.has('--database')||!values.has('--manifest')||!values.has('--vault-file')||process.env.RPLAYOUT_VAULT_KEY)throw new Error('Banco/manifesto/cofre obrigatórios, sem chave externa conflitante.')
  process.env.RPLAYOUT_VAULT_FILE=resolve(values.get('--vault-file')!)
  const {HOST_GUARD_BINARY}=await import('./config.js'),fence=new HostDistributionFence(HOST_GUARD_BINARY)
  try{if(!await fence.acquire())throw new Error('Posse nativa indisponível; predecessor não será parado.');process.stdout.write(JSON.stringify(await migrateRestoredCopy(values.get('--database')!,values.get('--manifest')!,fence))+'\n')}
  finally{fence.close()}
}
void main().catch(error=>{process.stderr.write(sanitizeDiagnostic(error instanceof Error?error.message:'Migração recusada; cópia preservada.')+'\n');process.exitCode=1})

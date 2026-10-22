import {parseRestoreArguments,restoreBackupToNewDirectory} from './domain/backup-restore.js'
import {sanitizeDiagnostic} from './domain/sanitize-diagnostic.js'
async function main(){
  const input=parseRestoreArguments(process.argv.slice(2))
  if(input.vaultFile)process.env.RPLAYOUT_VAULT_FILE=input.vaultFile
  const report=await restoreBackupToNewDirectory(input)
  process.stdout.write(JSON.stringify(report)+'\n')
}
void main().catch(error=>{process.stderr.write(sanitizeDiagnostic(error instanceof Error?error.message:'Restauração recusada. Cópia parcial preservada; não inicie nem promova o canal.')+'\n');process.exitCode=1})

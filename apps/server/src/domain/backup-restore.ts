import Database from 'better-sqlite3'
import {createHash,randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {lstat,mkdir,open,link,unlink} from 'node:fs/promises'
import {dirname,join,resolve,parse} from 'node:path'
import {validateBackupRestore,type RestoreValidation} from './backup.js'
import {readFile} from 'node:fs/promises'
import {installationVault,loadInstallationVault,adoptInstallationVault,SecretVault} from './secret-vault.js'
import {backupRecoveryRecord,VAULT_RECOVERY_FILE} from './vault-recovery.js'
import {writePrivateConfig} from './private-config-file.js'
import {migrateRestorationRecords,appendRestorationRecord} from '../db/restoration-records.js'
import {migrateRestoredActivations} from '../db/restored-activations.js'

export interface RestoreBackupInput {backup:string;destination:string;vaultFile?:string;recoveryPasswordFile?:string}
export interface RestoreBackupReport {
  version:1;requestId:string;phase:'QUARANTINED';restoredAt:string;backupSha256:string;
  vaultMode:'ORIGINAL_FILE'|'SHARED_ENVIRONMENT'|'RECOVERY_PASSWORD';vaultFingerprint:string;
  validation:RestoreValidation;automaticTake:false;promotionReady:false;
  mediaCopied:false;originalReferencesPreserved:true
}
export function parseRestoreArguments(args:readonly string[]):RestoreBackupInput {
  const values=new Map<string,string>()
  for(let index=0;index<args.length;index+=2){
    const key=args[index]!,value=args[index+1]
    if(!['--backup','--destination','--vault-file','--recovery-password-file'].includes(key)||values.has(key)||!value||value.startsWith('--'))throw new Error('Informe --backup, --destination e, se necessário, --vault-file ou --recovery-password-file; sem opções repetidas. A senha de recuperação nunca vai por argumento: use arquivo ou RPLAYOUT_RECOVERY_PASSWORD.')
    values.set(key,value)
  }
  if(!values.has('--backup')||!values.has('--destination'))throw new Error('Backup e pasta nova de destino são obrigatórios.')
  if(values.has('--vault-file')&&values.has('--recovery-password-file'))throw new Error('Escolha cofre original OU senha de recuperação, não ambos.')
  return {backup:values.get('--backup')!,destination:values.get('--destination')!,...(values.has('--vault-file')?{vaultFile:values.get('--vault-file')!}:{}),...(values.has('--recovery-password-file')?{recoveryPasswordFile:values.get('--recovery-password-file')!}:{})}
}
async function ancestors(path:string){
  let current=resolve(path)
  while(true){const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Pasta de restauração não pode usar links ou junções.');const parent=dirname(current);if(parent===current)return;current=parent}
}
async function regular(path:string){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('Backup/cofre deve ser arquivo regular, sem links.');return info}
/** Senha de recuperação: arquivo (primeira linha) ou RPLAYOUT_RECOVERY_PASSWORD.
 * Nunca argumento de linha de comando (fica na lista de processos/histórico). */
async function recoveryPassword(input:RestoreBackupInput):Promise<string|null>{
  if(input.recoveryPasswordFile){
    const file=resolve(input.recoveryPasswordFile);await ancestors(dirname(file));const info=await regular(file)
    if(info.size>4096)throw new Error('Arquivo da senha de recuperação excede o limite esperado.')
    const line=(await readFile(file,'utf8')).replace(/^\uFEFF/,'').split(/\r?\n/)[0]??''
    if(!line)throw new Error('Arquivo da senha de recuperação está vazio.')
    return line
  }
  return process.env.RPLAYOUT_RECOVERY_PASSWORD||null
}
/** Abre a chave com a senha, a partir do registro embrulhado DENTRO do backup. */
async function recoveredVault(backup:string,password:string):Promise<SecretVault>{
  const source=new Database(backup,{readonly:true,fileMustExist:true})
  let record
  try{record=backupRecoveryRecord(source)}finally{source.close()}
  if(!record)throw new Error('Este backup não tem senha de recuperação cadastrada; use o vault.json original ou RPLAYOUT_VAULT_KEY.')
  return SecretVault.openRecovery(record,password)
}
async function hash(path:string){const digest=createHash('sha256');for await(const bytes of createReadStream(path))digest.update(bytes);return digest.digest('hex')}

/** Creates only a NEW quarantine workspace. Never replaces an active database,
 * manufactures a vault key, rewrites media references or authorizes promotion.
 * Failure preserves any owned partial workspace for diagnosis, not a retry.
 */
export async function restoreBackupToNewDirectory(input:RestoreBackupInput):Promise<RestoreBackupReport>{
  const backup=resolve(input.backup),destination=resolve(input.destination),parent=dirname(destination)
  if(destination===parse(destination).root||destination===resolve(process.cwd())||destination===parent)throw new Error('Escolha uma pasta nova, não a raiz nem a instalação em uso.')
  const password=await recoveryPassword(input)
  if([process.env.RPLAYOUT_VAULT_KEY,input.vaultFile,password].filter(Boolean).length>1)throw new Error('Escolha UMA origem da chave: chave compartilhada no ambiente, cofre original ou senha de recuperação.')
  if(!process.env.RPLAYOUT_VAULT_KEY&&!input.vaultFile&&!password)throw new Error('Cofre original ou senha de recuperação obrigatórios; nenhuma chave será criada.')
  await ancestors(parent);await ancestors(dirname(backup));const original=await regular(backup),originalHash=await hash(backup)
  // Outra máquina/usuário: a senha abre a chave embrulhada no backup e ela
  // passa a ser a chave deste processo; no fim é re-embrulhada pelo DPAPI local.
  const vault=password?adoptInstallationVault(await recoveredVault(backup,password)):installationVault(false)
  let vaultContent:string|undefined
  if(input.vaultFile){
    const file=resolve(input.vaultFile);await ancestors(dirname(file));const identity=await regular(file)
    if(identity.size>1024*1024)throw new Error('Arquivo do cofre excede o limite esperado.')
    const handle=await open(file,'r')
    try{const actual=await handle.stat();if(actual.ino!==identity.ino||actual.dev!==identity.dev)throw new Error('Cofre mudou durante a conferência.');vaultContent=await handle.readFile('utf8')}finally{await handle.close()}
    if(loadInstallationVault(file,false).fingerprint!==vault.fingerprint)throw new Error('Cofre informado não corresponde à chave usada na conferência.')
  }
  const validation=await validateBackupRestore(backup)
  if(validation.protectedSecrets!=='verified'||validation.vaultFingerprint!==vault.fingerprint)throw new Error('A restauração operacional exige backup RPlayout protegido pelo cofre original.')
  // mkdir is exclusive, not recursive: an existing install/empty folder is refused.
  await mkdir(destination,{mode:0o700});const owned=await lstat(destination)
  const assertOwned=async()=>{const actual=await lstat(destination);if(!actual.isDirectory()||actual.isSymbolicLink()||actual.dev!==owned.dev||actual.ino!==owned.ino)throw new Error('Destino mudou durante a restauração; nada será publicado.')}
  const partial=join(destination,'service.restore-partial.db'),target=join(destination,'service.db')
  let source:Database.Database|null=null,restored:Database.Database|null=null
  try{
    await assertOwned();source=new Database(backup,{readonly:true,fileMustExist:true});await source.backup(partial);source.close();source=null
    restored=new Database(partial,{fileMustExist:true});restored.pragma('journal_mode=DELETE')
    const requestId=randomUUID(),restoredAt=new Date().toISOString()
    restored.transaction(()=>{
      if(!restored!.prepare("SELECT 1 FROM sqlite_master WHERE name='ha_recovery_origin' AND type='table'").get()){
        restored!.exec('CREATE TABLE ha_recovery_origin(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)')
        restored!.prepare('INSERT INTO ha_recovery_origin VALUES(1,?)').run(vault.encrypt(JSON.stringify({version:1,requestId,backupSha256:originalHash,restoredAt,automaticTake:false,promotionReady:false}),'backup-restore:v1:origin'))
      }
    }).immediate();restored.close();restored=null
    const finalSource=await regular(backup)
    if(finalSource.ino!==original.ino||finalSource.dev!==original.dev||await hash(backup)!==originalHash)throw new Error('Backup mudou durante a recuperação; cópia parcial preservada.')
    if(vaultContent!==undefined){await assertOwned();await writePrivateConfig(join(destination,'vault.json'),vaultContent);if(loadInstallationVault(join(destination,'vault.json'),false).fingerprint!==vault.fingerprint)throw new Error('Cofre copiado não confere.')}
    if(password){
      // Re-embrulha a mesma chave com a proteção DESTA máquina/usuário e guarda
      // ao lado a cópia embrulhada pela senha, para a próxima restauração.
      await assertOwned();await writePrivateConfig(join(destination,'vault.json'),vault.localWrappedFile())
      if(loadInstallationVault(join(destination,'vault.json'),false).fingerprint!==vault.fingerprint)throw new Error('Cofre re-embrulhado não confere.')
      const check=new Database(backup,{readonly:true,fileMustExist:true})
      try{const record=backupRecoveryRecord(check);if(record){await assertOwned();await writePrivateConfig(join(destination,VAULT_RECOVERY_FILE),JSON.stringify({kind:'rplayout-vault-recovery',record},null,2))}}finally{check.close()}
    }
    const report:RestoreBackupReport={version:1,requestId,phase:'QUARANTINED',restoredAt,backupSha256:originalHash,vaultMode:password?'RECOVERY_PASSWORD':vaultContent===undefined?'SHARED_ENVIRONMENT':'ORIGINAL_FILE',vaultFingerprint:vault.fingerprint,validation,automaticTake:false,promotionReady:false,mediaCopied:false,originalReferencesPreserved:true}
    await assertOwned();restored=new Database(partial,{fileMustExist:true})
    restored.transaction(()=>{migrateRestorationRecords(restored!);migrateRestoredActivations(restored!);appendRestorationRecord(restored!,report)}).immediate()
    restored.close();restored=null
    await validateBackupRestore(partial)
    await assertOwned();await writePrivateConfig(join(destination,'restore-quarantine.json'),JSON.stringify({report,protectedProvenance:vault.encrypt(JSON.stringify(report),'backup-restore:v1:report')},null,2))
    // Exclusive hardlink publication cannot overwrite even a newly-created target.
    // Only our partial copy is linked, never the original DB or backup.
    await assertOwned();await regular(partial);await link(partial,target);await unlink(partial)
    return report
  }finally{restored?.close();source?.close()}
}

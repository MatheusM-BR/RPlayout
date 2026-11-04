import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import Database from 'better-sqlite3'
import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {destinations} from '../db/schema.js'
import {backupDatabase} from './backup.js'
import {restoreBackupToNewDirectory} from './backup-restore.js'
import {adoptInstallationVault,installationVault,loadInstallationVault,resetInstallationVaultForTests,SecretVault,RECOVERY_REFUSED,SECRET_PREFIX} from './secret-vault.js'
import {NOT_PORTABLE_WARNING,setVaultRecoveryPassword,vaultRecoveryStatus,VaultRecoveryConflict} from './vault-recovery.js'
import {validateDatabaseSecrets} from '../db/vault-migration.js'

// Custo menor só nos testes; o servidor usa RECOVERY_COST (N=2^17).
const cost={N:2**12,r:8,p:1}
const PASSWORD='cofre-recuperacao-2026!'
const STREAM='rtmp://a.rtmp.youtube.com/live2/chave-de-stream-verdadeira'
let directory='',savedMode:string|undefined,savedPassword:string|undefined
beforeAll(()=>{savedMode=process.env.RPLAYOUT_STORAGE_MODE;savedPassword=process.env.RPLAYOUT_RECOVERY_PASSWORD;process.env.RPLAYOUT_STORAGE_MODE='INLINE';delete process.env.RPLAYOUT_RECOVERY_PASSWORD;directory=mkdtempSync(join(tmpdir(),'rplayout-recovery-'))})
afterAll(()=>{
  for(const [name,value] of [['RPLAYOUT_STORAGE_MODE',savedMode],['RPLAYOUT_RECOVERY_PASSWORD',savedPassword]] as const){if(value===undefined)delete process.env[name];else process.env[name]=value}
  rmSync(directory,{recursive:true,force:true})
})
afterEach(()=>{delete process.env.RPLAYOUT_RECOVERY_PASSWORD})

/** "Máquina antiga": banco com uma credencial de verdade e, opcionalmente, senha. */
async function oldMachine(name:string,withPassword:boolean){
  resetInstallationVaultForTests()
  const vault=installationVault()
  const data=join(directory,name);const file=join(data,'service.db')
  rmSync(data,{recursive:true,force:true});await import('node:fs/promises').then(fs=>fs.mkdir(data,{recursive:true}))
  const app=openDatabase(file)
  try{
    app.sqlite.prepare("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('c','RW',30000,1001,1920,1080,-23,-1,5,?)").run(new Date().toISOString())
    app.db.insert(destinations).values({id:'yt',channelId:'c',name:'YouTube',url:STREAM,enabled:true,createdAt:new Date().toISOString()}).run()
    if(withPassword)await setVaultRecoveryPassword(app.sqlite,{password:PASSWORD,expectedRevision:0,actor:'admin',databaseFile:file,cost})
    const backup=await backupDatabase(app.sqlite,join(data,'backups'))
    return {vault,backup,data,file,status:vaultRecoveryStatus(app.sqlite)}
  }finally{app.sqlite.close()}
}
const passwordFile=(content:string)=>{const file=join(directory,`senha-${Math.random().toString(36).slice(2)}.txt`);writeFileSync(file,content,{mode:0o600});return file}

describe('senha de recuperação do cofre',()=>{
  it('embrulha e abre a mesma chave; senha errada ou registro alterado são recusados sem vazar nada',async()=>{
    const vault=new SecretVault(Buffer.alloc(32,7))
    const record=await vault.wrapForRecovery(PASSWORD,cost)
    expect(JSON.stringify(record)).not.toContain(PASSWORD)
    expect((await SecretVault.openRecovery(record,PASSWORD)).fingerprint).toBe(vault.fingerprint)
    const wrong=await SecretVault.openRecovery(record,'senha-errada-de-proposito').catch((error:Error)=>error)
    expect(wrong).toBeInstanceOf(Error);expect((wrong as Error).message).toBe(RECOVERY_REFUSED)
    expect((wrong as Error).message).not.toContain('senha-errada')
    const tampered={...record,ciphertext:Buffer.from(Buffer.from(record.ciphertext,'base64').map((byte,index)=>index===3?byte^1:byte)).toString('base64')}
    await expect(SecretVault.openRecovery(tampered,PASSWORD)).rejects.toThrow(RECOVERY_REFUSED)
    // Registro não escolhe custo arbitrário (negação de serviço).
    await expect(SecretVault.openRecovery({...record,N:2**24},PASSWORD)).rejects.toThrow('inválido')
    await expect(vault.wrapForRecovery('curta',cost)).rejects.toThrow('12 caracteres')
  })

  it('backup restaurado em outra máquina com a senha certa abre as credenciais',async()=>{
    const old=await oldMachine('com-senha',true)
    expect(old.status).toMatchObject({configured:true,restorableElsewhere:true,warning:null,revision:1})
    expect(JSON.stringify(old.status)).not.toContain(PASSWORD)
    expect(old.backup.validation.keyRecovery).toMatch(/^Restaurável em outra máquina/)
    // A senha nunca vai para o banco nem para o arquivo de recuperação.
    expect(readFileSync(old.backup.file).includes(Buffer.from(PASSWORD))).toBe(false)
    expect(readFileSync(join(old.data,'vault-recovery.json'),'utf8')).not.toContain(PASSWORD)
    // "Outra máquina": processo sem chave nenhuma, vault.json antigo inexistente.
    resetInstallationVaultForTests()
    const destination=join(directory,'maquina-nova')
    const report=await restoreBackupToNewDirectory({backup:old.backup.file,destination,recoveryPasswordFile:passwordFile(PASSWORD+'\n')})
    expect(report).toMatchObject({vaultMode:'RECOVERY_PASSWORD',vaultFingerprint:old.vault.fingerprint,phase:'QUARANTINED'})
    expect(JSON.stringify(report)).not.toContain(PASSWORD)
    // Chave re-embrulhada com a proteção local e a cópia embrulhada pela senha ao lado.
    const local=loadInstallationVault(join(destination,'vault.json'),false)
    expect(local.fingerprint).toBe(old.vault.fingerprint)
    expect(existsSync(join(destination,'vault-recovery.json'))).toBe(true)
    // O servidor da máquina nova, só com o vault.json local, lê a credencial.
    resetInstallationVaultForTests();adoptInstallationVault(local)
    const restored=new Database(join(destination,'service.db'),{readonly:true})
    try{
      const url=(restored.prepare("SELECT url FROM destinations WHERE id='yt'").get() as {url:string}).url
      expect(url.startsWith(SECRET_PREFIX)).toBe(true)
      expect(local.decrypt(url,'destinations.url')).toBe(STREAM)
      expect(validateDatabaseSecrets(restored).protectedSecrets).toBe('verified')
    }finally{restored.close()}
  })

  it('senha pela variável de ambiente também abre; senha errada recusa e não cria nada',async()=>{
    const old=await oldMachine('env',true)
    resetInstallationVaultForTests()
    process.env.RPLAYOUT_RECOVERY_PASSWORD='nao-e-esta-a-senha'
    const refused=join(directory,'recusada')
    const error=await restoreBackupToNewDirectory({backup:old.backup.file,destination:refused}).catch((failure:Error)=>failure)
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe(RECOVERY_REFUSED)
    expect((error as Error).message).not.toContain('nao-e-esta')
    expect(existsSync(refused)).toBe(false)
    resetInstallationVaultForTests()
    process.env.RPLAYOUT_RECOVERY_PASSWORD=PASSWORD
    const report=await restoreBackupToNewDirectory({backup:old.backup.file,destination:join(directory,'por-ambiente')})
    expect(report.vaultMode).toBe('RECOVERY_PASSWORD')
  })

  it('sem senha cadastrada: aviso permanente e a restauração por senha é recusada',async()=>{
    const old=await oldMachine('sem-senha',false)
    expect(old.status).toMatchObject({configured:false,state:'ABSENT',restorableElsewhere:false,warning:NOT_PORTABLE_WARNING})
    expect(old.backup.validation.keyRecovery).toMatch(/^Backup não restaurável em outra máquina/)
    resetInstallationVaultForTests()
    await expect(restoreBackupToNewDirectory({backup:old.backup.file,destination:join(directory,'nada'),recoveryPasswordFile:passwordFile(PASSWORD)}))
      .rejects.toThrow('não tem senha de recuperação')
    expect(existsSync(join(directory,'nada'))).toBe(false)
  })

  it('troca de senha exige a revisão lida (If-Match) e a senha antiga deixa de abrir',async()=>{
    const old=await oldMachine('troca',true)
    resetInstallationVaultForTests();adoptInstallationVault(old.vault)
    const app=openDatabase(old.file)
    try{
      await expect(setVaultRecoveryPassword(app.sqlite,{password:'outra-senha-bem-longa',expectedRevision:0,actor:'admin',databaseFile:null,cost})).rejects.toBeInstanceOf(VaultRecoveryConflict)
      await setVaultRecoveryPassword(app.sqlite,{password:'outra-senha-bem-longa',expectedRevision:1,actor:'admin',databaseFile:null,cost})
      const record=JSON.parse((app.sqlite.prepare('SELECT payload FROM vault_recovery').get() as {payload:string}).payload)
      await expect(SecretVault.openRecovery(record,PASSWORD)).rejects.toThrow(RECOVERY_REFUSED)
      expect((await SecretVault.openRecovery(record,'outra-senha-bem-longa')).fingerprint).toBe(old.vault.fingerprint)
      expect(vaultRecoveryStatus(app.sqlite).revision).toBe(2)
    }finally{app.sqlite.close()}
  })
})

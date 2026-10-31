import type Database from 'better-sqlite3'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {hostname} from 'node:os'
import {createReadStream} from 'node:fs'
import {z} from 'zod'
import {backupDatabase} from './backup.js'
import {installationVault} from './secret-vault.js'
import {validateUpgradeBackupRequests} from '../db/upgrade-backup-requests.js'

export const upgradeBackupRequest=z.object({requestId:z.string().uuid()}).strict()
export interface UpgradeBackupReport {
  requestId:string;phase:'CHECKING'|'READY'|'REFUSED'|'UNCERTAIN';createdAt:string
  file?:string;bytes?:number;sha256?:string;vaultFingerprint?:string
  automaticTake:false;promotionReady:false;previousBackupsRemoved:false;reason:string
}
type Row={request_id:string;phase:string;report:string;creator:string|null}
/** Online SQLite backup, retained separately from rotating backups.
 * Durable UUID query never restarts an interrupted/lost-response builder. */
export class UpgradeBackups {
  private work=new Map<string,Promise<void>>()
  private closed=false
  private readonly creator=JSON.stringify({host:hostname(),pid:process.pid,boot:randomUUID()})
  constructor(private readonly sqlite:Database.Database,private readonly directory:string){
    validateUpgradeBackupRequests(sqlite)
    if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=50').get())throw new Error('Pedidos de backup exigem migração da edição antes de registrar trabalho.')
    // An online backup copies the database while its own request is still
    // CHECKING. In the upgraded copy that row blocked every later upgrade
    // backup until someone reconciled it by hand. On a fresh server process,
    // settle such rows through the same reconciliation (dead local creator
    // only; live, remote or unknown creators stay untouched).
    for(const {request_id:requestId} of sqlite.prepare("SELECT request_id FROM backup_upgrade_requests WHERE phase='CHECKING'").all() as {request_id:string}[]){
      try{this.reconcile({requestId,confirm:true},()=>{})}catch{/* preserved for explicit review */}
    }
  }
  private key(id:string){return 'upgrade-backup:v1:'+id}
  private row(id:string){return this.sqlite.prepare('SELECT * FROM backup_upgrade_requests WHERE request_id=?').get(id) as Row|undefined}
  private decode(row:Row):UpgradeBackupReport{
    const report=JSON.parse(installationVault(false).decrypt(row.report,this.key(row.request_id))) as UpgradeBackupReport
    if(report.requestId!==row.request_id||report.phase!==row.phase)throw new Error('Registro de backup inconsistente; preserve a cópia.')
    if(report.phase==='CHECKING'&&!this.work.has(report.requestId))return {...report,phase:'UNCERTAIN',reason:'Preparação interrompida ou de outro criador. Consulte os arquivos preservados; este pedido não será executado novamente.'}
    return report
  }
  query(value:unknown){const {requestId}=upgradeBackupRequest.parse(value),row=this.row(requestId);if(!row)throw new Error('Pedido de backup não encontrado.');return this.decode(row)}
  create(value:unknown,authorize:()=>void):UpgradeBackupReport{
    if(this.closed)throw new Error('Servidor encerrando; preparação recusada.')
    const {requestId}=upgradeBackupRequest.parse(value);authorize()
    const existing=this.row(requestId);if(existing)return this.decode(existing)
    const initial:UpgradeBackupReport={requestId,phase:'CHECKING',createdAt:new Date().toISOString(),automaticTake:false,promotionReady:false,previousBackupsRemoved:false,reason:'Backup online e verificação em andamento; não autoriza atualização ou PGM.'}
    this.sqlite.transaction(()=>{
      authorize()
      if(this.sqlite.prepare("SELECT 1 FROM backup_upgrade_requests WHERE phase='CHECKING' LIMIT 1").get())throw new Error('Há um backup em andamento ou interrompido; confira o pedido anterior antes de criar outro.')
      this.sqlite.prepare('INSERT INTO backup_upgrade_requests(request_id,phase,report,creator) VALUES(?,?,?,?)').run(requestId,initial.phase,installationVault().encrypt(JSON.stringify(initial),this.key(requestId)),this.creator)
    }).immediate()
    const work=Promise.resolve().then(()=>this.run(initial,authorize));this.work.set(requestId,work)
    void work.finally(()=>this.work.delete(requestId)).catch(()=>{})
    return initial
  }
  private store(report:UpgradeBackupReport){
    const changed=this.sqlite.prepare("UPDATE backup_upgrade_requests SET phase=?,report=? WHERE request_id=? AND phase='CHECKING' AND creator=?").run(report.phase,installationVault().encrypt(JSON.stringify(report),this.key(report.requestId)),report.requestId,this.creator)
    if(changed.changes!==1)throw new Error('Resultado não registrado; preserve a cópia sem repetir o pedido.')
  }
  reconcile(value:unknown,authorize:()=>void){
    const {requestId}=upgradeBackupRequest.extend({confirm:z.literal(true)}).parse(value)
    return this.sqlite.transaction(()=>{
      authorize();const row=this.row(requestId)
      if(!row)throw new Error('Pedido não encontrado.')
      if(row.phase!=='CHECKING')return this.decode(row)
      let creator:{host:string;pid:number;boot:string}|null=null
      try{creator=z.object({host:z.string(),pid:z.number().int().positive(),boot:z.string().uuid()}).strict().parse(JSON.parse(row.creator??'null'))}catch{}
      let gone=false
      if(creator?.host===hostname()&&creator.pid!==process.pid)try{process.kill(creator.pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}
      if(!gone)throw new Error('Criador vivo, remoto ou desconhecido; pedido não será liberado.')
      const report={...this.decode(row),phase:'REFUSED' as const,reason:'Criador local morto conferido e pedido reconciliado. Arquivos preservados; novo pedido exige UUID novo, sem replay do anterior.'}
      this.sqlite.prepare("UPDATE backup_upgrade_requests SET phase='REFUSED',report=? WHERE request_id=? AND phase='CHECKING'").run(installationVault().encrypt(JSON.stringify(report),this.key(requestId)),requestId)
      return report
    }).immediate()
  }
  close(){this.closed=true}
  private async run(initial:UpgradeBackupReport,authorize:()=>void){
    try{
      authorize()
      const result=await backupDatabase(this.sqlite,join(this.directory,'upgrade'),{retainExisting:true})
      authorize()
      if(result.validation.protectedSecrets!=='verified'||!result.validation.vaultFingerprint)throw new Error('Cofre não comprovado.')
      const hash=createHash('sha256');for await(const bytes of createReadStream(result.file))hash.update(bytes)
      authorize()
      this.store({...initial,phase:'READY',file:result.file,bytes:result.bytes,sha256:hash.digest('hex'),vaultFingerprint:result.validation.vaultFingerprint,reason:'Backup online verificado e preservado fora da rotação. Use esta cópia e o cofre original na preparação isolada; compatibilidade/ativação continuam obrigatórias.'})
    }catch{
      // If durable storage itself failed, CHECKING remains quarantined. Never
      // restart the backup or remove a successfully created partial/full copy.
      try{this.store({...initial,phase:'REFUSED',reason:'Resultado não aprovado: confira sessão, banco, espaço, restauração e cofre. Arquivos criados foram preservados; nenhum backup anterior foi removido.'})}catch{}
    }
  }
  async settled(){await Promise.allSettled([...this.work.values()])}
}

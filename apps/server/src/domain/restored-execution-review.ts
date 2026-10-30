import {createHash,randomUUID} from 'node:crypto'
import type Database from 'better-sqlite3'
import {readdir} from 'node:fs/promises'
import {join} from 'node:path'
import type {Db} from '../db/client.js'
import {channels,rundowns,operationalPlaylistRevisions} from '../db/schema.js'
import {toChannel} from '../db/repo.js'
import {eq,asc} from 'drizzle-orm'
import {ExecutionOwnership} from './execution-ownership.js'
import {DistributionOwnership} from './distribution-ownership.js'
import {readExecutionOwner,validateExecutionOwnership} from '../db/execution-ownership.js'
import {validateDistributionOwnership} from '../db/distribution-ownership.js'
import {validateDatabaseSecrets} from '../db/vault-migration.js'
import {Checkpoints} from './checkpoints.js'
import {PlaylistBoundaryLedger} from './playlist-boundary.js'
import {InterruptionCommands} from './interruption-commands.js'
import {readOperationalPayload} from './operational-playlist.js'
import {assertOperationalCadence} from './operational-cadence.js'
import {applyQcDecisionsNow} from './qc-workflow.js'
import {buildView,assertTrimAudio} from './plan.js'
import {assertProgramTrim} from './program-trim.js'
import {assessQc,qcApproved,type MediaAsset} from '@rplayout/protocol'
import {FileVersionVerifier} from './file-version.js'
import {StorageMaintenance} from './storage-maintenance.js'
import {verifyRestorationManifest} from './restoration-manifest.js'
import type {HostDistributionFence} from './host-distribution-fence.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
import {installationVault} from './secret-vault.js'
import {ServerInstanceRegistration} from './server-instances.js'
import {readRestoredActivations,restoredActivationSignature,type RestoredActivation} from '../db/restored-activations.js'
import {sanitizeDiagnostic} from './sanitize-diagnostic.js'
import {assertSchemaCompatibility} from '../db/schema-compatibility.js'
import {assertNoInterruptedRestoredMigration} from './migrate-restored-copy.js'
import type {NativeProgramAdmission} from './native-program-admission.js'

/** Full row/schema fingerprint, streamed rather than a whole database Buffer.
 * Private: never publish SQL rows, paths, encrypted credentials or fingerprint
 * as an operator authorization. Includes rowid because journal order matters. */
export function stateFingerprint(sql:Database.Database):string{
  const hash=createHash('sha256')
  const objects=sql.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
  hash.update(JSON.stringify(objects))
  for(const {name} of sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[]){
    const quoted='"'+name.replaceAll('"','""')+'"';hash.update(name+'\0')
    for(const row of sql.prepare(`SELECT rowid,* FROM ${quoted} ORDER BY rowid`).iterate())hash.update(JSON.stringify(row)+'\n')
  }
  return hash.digest('hex')
}
const admissions=new WeakSet<HeldRestoredAdmission>()
/** Process-local capability; no exported constructor or serializable token.
 * Transfers storage admission only. Quarantine and native execution gates
 * remain intact until a distinct, confirmed activation stage. */
class HeldRestoredAdmission {
  private transferred=false
  private registered:ServerInstanceRegistration|null=null
  private activationId:string|null=null
  private verifiedInTransaction:Database.Database|null=null
  constructor(readonly maintenance:StorageMaintenance,readonly hostFence:HostDistributionFence,private readonly fingerprint:string,private readonly requestId:string,readonly pausedPreparation=false){admissions.add(this)}
  assertBeforeOpen(sqlite:Database.Database):void{
    assertRestoredAdmission(this)
    if(this.transferred||this.registered)throw new Error('Admissão restaurada já usada.')
    this.maintenance.assertHeldOn(sqlite);this.hostFence.assertOwned()
    if(stateFingerprint(sqlite)!==this.fingerprint)throw new Error('Banco mudou antes da admissão; preparação recusada.')
    // Only the check made inside the opening transaction counts for register().
    if(sqlite.inTransaction)this.verifiedInTransaction=sqlite
  }
  register(sqlite:Database.Database):ServerInstanceRegistration{
    if(!sqlite.inTransaction)throw new Error('Admissão deve ocorrer na transação de abertura.')
    // register() runs after the schema migrations of the same opening
    // transaction, so the reviewed fingerprint can no longer match. The
    // fingerprint was verified on this very connection, inside this very
    // transaction, before any migration; only host/storage ownership is
    // re-checked here. Without that earlier check, the full check applies.
    if(this.verifiedInTransaction===sqlite){
      assertRestoredAdmission(this)
      if(this.transferred||this.registered)throw new Error('Admissão restaurada já usada.')
      this.maintenance.assertHeldOn(sqlite);this.hostFence.assertOwned()
    }else this.assertBeforeOpen(sqlite)
    const instance=new ServerInstanceRegistration(sqlite,this.maintenance),id=randomUUID(),createdAt=new Date().toISOString()
    const payload={version:1,requestId:this.requestId,instanceId:instance.id,phase:'BACKEND_ADMITTED_QUARANTINED',activationPerformed:false,physicalOutputValidated:false}
    sqlite.prepare('INSERT INTO operator_decisions(id,rundown_id,kind,payload,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(id,'@restore','RESTORED_BACKEND_ADMITTED',installationVault(false).encrypt(JSON.stringify(payload),'operator_decisions.payload'),'@restore',createdAt)
    this.registered=instance
    return instance
  }
  get handedOff(){return this.transferred}
  completeTransfer(sqlite:Database.Database):void{
    assertRestoredAdmission(this)
    if(this.transferred||!this.registered)throw new Error('Admissão não registrada ou já usada.')
    this.hostFence.assertOwned();this.maintenance.transferConnection(sqlite);this.transferred=true
  }
  releaseForShutdown(sqlite:Database.Database):void{
    assertRestoredAdmission(this)
    if(!this.transferred)throw new Error('Admissão não transferida ao backend.')
    if(this.maintenance.heldHere){this.maintenance.assertHeldOn(sqlite);this.maintenance.release()}
  }
  beginNativeActivation(sqlite:Database.Database):void{
    assertRestoredAdmission(this)
    if(!this.transferred||!this.registered||this.activationId)throw new Error('Etapa nativa não pode ser iniciada ou repetida.')
    this.maintenance.assertHeldOn(sqlite);this.hostFence.assertOwned()
    const row:RestoredActivation={version:1,id:randomUUID(),requestId:this.requestId,instanceId:this.registered.id,phase:'STARTING',startedAt:new Date().toISOString(),finishedAt:null,nativeReadyChannels:[],resumedChannels:[],message:null,originTable:null,automaticPromotion:false,physicalOutputValidated:false}
    sqlite.transaction(()=>{if(readRestoredActivations(sqlite).at(-1)?.phase==='STARTING')throw new Error('Tentativa anterior de ativação não concluída.');sqlite.prepare('INSERT INTO restored_activation_runs VALUES(?,?,?)').run(row.id,JSON.stringify(row),restoredActivationSignature(row));this.auditActivation(sqlite,row)}).immediate()
    this.activationId=row.id
  }
  assertNativeActivation(sqlite:Database.Database):void{
    assertRestoredAdmission(this);this.maintenance.assertHeldOn(sqlite);this.hostFence.assertOwned()
    const run=readRestoredActivations(sqlite).at(-1)
    if(!this.transferred||!this.activationId||run?.id!==this.activationId||run.phase!=='STARTING'||run.instanceId!==this.registered?.id||run.requestId!==this.requestId)throw new Error('Etapa nativa restaurada não está sob admissão confirmada.')
  }
  nativeStageAllowed(sqlite:Database.Database):boolean{try{this.assertNativeActivation(sqlite);return true}catch{return false}}
  recordOutputRelease(sqlite:Database.Database,channelId:string,bus:'PROGRAM'|'PREVIEW',stage:'ATTEMPTED'|'CONFIRMED',paused:boolean,proof?:NativeProgramAdmission):void{
    sqlite.transaction(()=>{
      this.assertNativeActivation(sqlite)
      if(!sqlite.prepare('SELECT id FROM channels WHERE id=? AND archived_at IS NULL').get(channelId))throw new Error('Liberação não pertence a canal ativo da ativação.')
      if(stage==='CONFIRMED'&&bus==='PROGRAM'&&(!proof||proof.channelId!==channelId||Boolean(proof.paused)!==paused))throw new Error('Liberação sem recibo nativo correspondente.')
      const id=`restored-output:${this.activationId}:${channelId}:${bus}:${stage}`
      const payload={version:1,activationId:this.activationId,channelId,bus,stage,paused,proof:proof??null,physicalOutputValidated:false}
      sqlite.prepare('INSERT INTO operator_decisions(id,rundown_id,kind,payload,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(id,'@restore','RESTORED_OUTPUT_RELEASE_'+stage,installationVault(false).encrypt(JSON.stringify(payload),'operator_decisions.payload'),'@restore',new Date().toISOString())
    }).immediate()
  }
  assertLocalEngineLease(sqlite:Database.Database):void{
    assertRestoredAdmission(this);this.maintenance.assertHeldOn(sqlite);this.hostFence.assertOwned()
    const run=readRestoredActivations(sqlite).at(-1)
    if(!this.transferred||!this.activationId||run?.id!==this.activationId||!['STARTING','CONFIRMED'].includes(run.phase)||run.instanceId!==this.registered?.id||run.requestId!==this.requestId)throw new Error('Concessão local restaurada sem ativação própria vigente.')
  }
  finishNativeActivation(sqlite:Database.Database,phase:'CONFIRMED'|'FAILED',ready:string[],resumed:string[],message:string|null):void{
    sqlite.transaction(()=>{
      this.assertNativeActivation(sqlite)
      if(phase==='CONFIRMED'){
        const expected=(sqlite.prepare('SELECT id FROM channels WHERE archived_at IS NULL ORDER BY id').all() as {id:string}[]).map(row=>row.id)
        if(JSON.stringify([...ready].sort())!==JSON.stringify(expected))throw new Error('Nem todos os canais ativos possuem confirmação nativa.')
      }
      const previous=readRestoredActivations(sqlite).at(-1)!,originTable=phase==='CONFIRMED'?`restored_origin_${previous.id.replaceAll('-','')}`:null
      if(originTable){
        if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='ha_recovery_origin' AND type='table'").get())throw new Error('Origem de quarentena ausente; confirmação recusada.')
        sqlite.exec(`ALTER TABLE ha_recovery_origin RENAME TO ${originTable}`)
      }
      const next:RestoredActivation={...previous,phase,finishedAt:new Date().toISOString(),nativeReadyChannels:ready,resumedChannels:resumed,message:message?sanitizeDiagnostic(message):null,originTable}
      const changed=sqlite.prepare('UPDATE restored_activation_runs SET payload=?,signature=? WHERE id=? AND signature=?').run(JSON.stringify(next),restoredActivationSignature(next),previous.id,restoredActivationSignature(previous))
      if(changed.changes!==1)throw new Error('Ativação mudou durante confirmação.')
      this.auditActivation(sqlite,next)
    }).immediate()
  }
  private auditActivation(sqlite:Database.Database,row:RestoredActivation){
    sqlite.prepare('INSERT INTO operator_decisions(id,rundown_id,kind,payload,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'@restore','RESTORED_ACTIVATION_'+row.phase,installationVault(false).encrypt(JSON.stringify(row),'operator_decisions.payload'),'@restore',new Date().toISOString())
  }
}
export type RestoredBackendAdmission=HeldRestoredAdmission
export function assertRestoredAdmission(value:unknown):asserts value is RestoredBackendAdmission{
  if(!value||!admissions.has(value as HeldRestoredAdmission))throw new Error('Admissão restaurada não é capacidade local verificada.')
}
/** Must be called under storage reservation and continuously held native
 * host fence. It prepares facts only: does not remove quarantine, claim channel
 * execution, close as-run, send TAKE or promise successful native recovery. */
export async function reviewRestoredExecution(db:Db,manifestPath:string,hostFence:HostDistributionFence,options:{cacheRoot?:string;handoff?:(admission:RestoredBackendAdmission)=>Promise<void>;heldMaintenance?:StorageMaintenance;pausedPreparation?:boolean}={}){
  hostFence.assertOwned()
  assertSchemaCompatibility(db.$client)
  assertNoInterruptedRestoredMigration(db.$client)
  if(!isRecoveryRehearsal(db.$client))throw new Error('Banco não está em quarentena de restauração.')
  const lease=options.heldMaintenance??new StorageMaintenance(db.$client)
  if(options.heldMaintenance)lease.assertHeldOn(db.$client);else lease.acquire()
  let admission:RestoredBackendAdmission|null=null
  try{
    const receipt=await verifyRestorationManifest(db.$client,manifestPath)
    lease.assertHeld();hostFence.assertOwned()
    if(db.$client.pragma('integrity_check',{simple:true})!=='ok'||(db.$client.pragma('foreign_key_check') as unknown[]).length)throw new Error('Banco de restauração inconsistente; preparação recusada.')
    validateDatabaseSecrets(db.$client);validateExecutionOwnership(db.$client);validateDistributionOwnership(db.$client)
    const before=stateFingerprint(db.$client),execution=new ExecutionOwnership(db),distribution=new DistributionOwnership(db,execution.identity,undefined,hostFence)
    distribution.assertPredecessorReleased()
    const files=new Map<string,MediaAsset>(),checkpoints=new Checkpoints(db.$client)
    let activeChannels=0,resumableCursors=0,publishedPlans=0,liveItems=0
    // Resolve each real startup plan exactly: saved native cursor, otherwise
    // first editorial grade as used by bootstrap; never silently fall back
    // to editable data when a published operational plan is required.
    for(const row of db.select().from(channels).orderBy(asc(channels.id)).all()){
      const channel=toChannel(row),status=execution.status(channel.id)
      if(status.blocked)throw new Error(status.diagnostic.message)
      const cursor=checkpoints.read(channel.id)
      const held=Boolean(cursor?.programHold?.status==='HELD'&&cursor.realEngine&&!cursor.playing)
      if(cursor?.programHold&&(!options.pausedPreparation||!held))throw new Error('Backup HELD exige admissão nativa pausada das saídas preparadas; cursor preservado e ativação recusada.')
      if(cursor?.realEngine&&!cursor.playing&&cursor.itemId&&!held)throw new Error('PGM pausado exige recuperação de quadro congelado; cursor preservado.')
      if(row.archivedAt){if(cursor?.playing||held)throw new Error('Canal arquivado possui cursor em execução; revise a seleção de canais.');continue}
      activeChannels++
      const interrupted=new InterruptionCommands(db,db.$client).blockedReason(channel.id)
      if(interrupted)throw new Error(interrupted)
      if(new PlaylistBoundaryLedger(db,channel.id).list().some(run=>['PREPARING','SWITCHING','UNCERTAIN'].includes(run.state)))throw new Error('Passagem de playlist pendente ou incerta; nenhuma repetição automática autorizada.')
      const first=db.select().from(rundowns).where(eq(rundowns.channelId,channel.id)).orderBy(asc(rundowns.date)).get()
      const playing=Boolean((cursor?.playing||held)&&cursor?.realEngine),rundownId=playing?cursor!.rundownId:first?.id
      if(cursor?.playing&&!cursor.realEngine)throw new Error('Cursor simulado não comprova retomada nativa.')
      if(!rundownId)continue
      const grades=db.select().from(rundowns).where(eq(rundowns.id,rundownId)).all()
      if(grades.length!==1||grades[0]!.channelId!==channel.id)throw new Error('Grade do cursor não pertence ao canal.')
      const editions=db.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.rundownId,rundownId)).all().filter(revision=>revision.active)
      if(editions.length!==1)throw new Error('Ativação exige uma edição operacional publicada e única para a grade de partida.')
      const revision=editions[0]!,payload=readOperationalPayload(revision.payload)
      if(payload.rundown.id!==rundownId||payload.rundown.channelId!==channel.id)throw new Error('Publicação pertence a outra grade/canal.')
      assertOperationalCadence(db,channel,payload)
      const assets=applyQcDecisionsNow(db,new Map((payload.assets??[]).map(asset=>[asset.id,asset])),channel.id)
      const view=buildView(payload.rundown,channel,payload.items,assets,null,null);publishedPlans++
      for(const entry of view.items){
        if(entry.item.type==='LIVE'||entry.item.sourceRef||entry.item.liveEndpoint||entry.item.liveConfig?.sourceEndpoint){liveItems++;continue}
        if(!entry.item.mediaId)continue
        const asset=entry.asset
        if(!asset||asset.ignored||asset.probeError||!qcApproved(asset.qcStatus??'PENDING')||!assessQc(asset,channel.qcProfile??undefined).playable)throw new Error('Mídia de partida sem aprovação editorial/técnica para o perfil do canal.')
        assertTrimAudio(entry,entry.trim,channel.rate)
        files.set(asset.id+':'+asset.contentHash,asset)
      }
      if(playing){
        const owner=readExecutionOwner(db.$client,channel.id)
        if(!owner||!cursor!.ownerRunId||cursor!.ownerRunId!==owner.id)throw new Error('Cursor não pertence ao predecessor autenticado.')
        if(!cursor!.rate||BigInt(cursor!.rate.num)*BigInt(channel.rate.den)!==BigInt(channel.rate.num)*BigInt(cursor!.rate.den)||cursor!.audioChannels!==(channel.audioChannels??2))throw new Error('Cadência/barramento do cursor não correspondem ao canal.')
        if(cursor!.revisionId!==revision.id)throw new Error('Edição ativa mudou desde o cursor salvo.')
        const entry=view.items.find(item=>item.item.id===cursor!.itemId)
        if(!entry)throw new Error('Item salvo ausente da edição publicada.')
        const live=Boolean(entry.item.type==='LIVE'||entry.item.sourceRef||entry.item.liveEndpoint||entry.item.liveConfig?.sourceEndpoint)
        if(held&&live)throw new Error('Backup HELD exige arquivo e corte confirmado, não live.')
        if(live){if(cursor!.programTrim)throw new Error('Corte de arquivo não pode ser retomado como live.')}
        else{if(!cursor!.programTrim)throw new Error('Cursor de arquivo sem corte confirmado.');assertProgramTrim(entry,cursor!.programTrim,cursor!.elapsed,channel.rate)}
        resumableCursors++
      }
    }
    const verifier=new FileVersionVerifier()
    for(const asset of files.values()){
      const archive=db.$client.prepare("SELECT v.archive_path FROM media_versions v JOIN media_jobs j ON j.version_id=v.id WHERE v.asset_id=? AND v.content_hash=? AND j.kind='ARCHIVE' AND j.state='READY'").get(asset.id,asset.contentHash) as {archive_path:string|null}|undefined
      const cached=options.cacheRoot?[join(options.cacheRoot,asset.contentHash.toLowerCase()+'.media'),...(await readdir(options.cacheRoot).catch(()=>[])).filter(name=>name.toLowerCase().startsWith(asset.contentHash.toLowerCase()+'-')&&!name.endsWith('.part')).map(name=>join(options.cacheRoot!,name))]:[]
      let verified=false
      for(const path of [...new Set([archive?.archive_path,...cached,asset.path].filter((path):path is string=>Boolean(path)))])try{if(await verifier.matches(path,asset.contentHash)){verified=true;break}}catch{/* Do not expose paths or substitute another hash. */}
      if(!verified)throw new Error('Versão SHA da mídia de partida indisponível; nenhum arquivo substituído.')
    }
    lease.assertHeld();hostFence.assertOwned();distribution.assertPredecessorReleased()
    if(stateFingerprint(db.$client)!==before)throw new Error('Banco mudou durante a preparação; nova revisão necessária.')
    if(options.handoff){admission=new HeldRestoredAdmission(lease,hostFence,before,receipt.requestId,options.pausedPreparation===true);await options.handoff(admission)}
    // Release is deliberately not activation: the caller still cannot use this
    // report to authorize takeover, and no window is advertised as a handoff.
    return {stage:'REVIEWED_NOT_ACTIVATED' as const,requestId:receipt.requestId,activeChannels,publishedPlans,verifiedMedia:files.size,resumableCursors,liveItemsRequiringSignalConfirmation:liveItems,activationPerformed:false as const,promotionReady:false as const,physicalOutputValidated:false as const,...(admission?.handedOff?{backendAdmissionCompleted:true,storageReservationRetained:true}:{})}
  }finally{if(!options.heldMaintenance&&lease.heldHere&&!admission?.handedOff)lease.release()}
}

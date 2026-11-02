import {randomUUID} from 'node:crypto'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {executionOwnerSignature,executionAsRunSignature,readExecutionOwner,readExecutionRun,type ExecutionOwner} from '../db/execution-ownership.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {parseChannelCheckpoint} from './checkpoints.js'
import {executionHostIdentity} from './execution-host.js'

const blocked=(reason:string)=>new CollaborativeEditError(409,{error:reason,executionOwnershipBlocked:true})
const processGone=(pid:number)=>{try{process.kill(pid,0);return false}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'}}
export interface ExecutionProcessIdentity {host:string;pid:number;boot:string}
/** A process lifetime fence for a shared local database. This is not a timed
 * lease, remote death proof or HA promotion. Unknown/reused PIDs stay blocked. */
export class ExecutionOwnership {
  private closed=false
  private readonly leases=new Set<ExecutionLease>()
  readonly identity:ExecutionProcessIdentity
  constructor(private readonly db:Db,identity?:ExecutionProcessIdentity,private readonly gone:(pid:number)=>boolean=processGone){this.identity=identity??{host:executionHostIdentity(),pid:process.pid,boot:randomUUID()}}
  status(channelId:string){
    const owner=readExecutionOwner(this.db.$client,channelId)
    const ours=Boolean(!this.closed&&owner&&owner.boot===this.identity.boot&&owner.host===this.identity.host&&owner.pid===this.identity.pid)
    const legacy=owner?null:this.legacyReason(channelId)
    const claimable=owner&&owner.host===this.identity.host&&!owner.spawning&&owner.enginePids.every(this.gone)&&(this.gone(owner.pid)||owner.phase==='RELEASED'&&(ours||owner.finalRelease))
    const blocked=Boolean(this.closed||legacy||owner&&!(ours&&owner.phase==='ACTIVE'&&!owner.spawning)&&!claimable)
    // A death proof releases process ownership, not the last aired frame. In
    // particular a lost storage connection can leave an ACTIVE cursor behind
    // while the native engine continues. This is a read-only warning, never a
    // grant, a checkpoint repair or a change to automatic recovery policy.
    let cursorNeedsReview=false
    if(!this.closed&&claimable&&!(ours&&owner.phase==='ACTIVE')&&owner&&!(owner.phase==='RELEASED'&&owner.finalRelease&&owner.observationClosed)){
      const row=this.db.$client.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get(channelId) as {payload:string}|undefined
      if(row){const saved=parseChannelCheckpoint(JSON.parse(row.payload),channelId);cursorNeedsReview=saved.realEngine&&Boolean(saved.ownerRunId)&&(saved.playing||Boolean(saved.programHold))}
    }
    const code=this.closed?'INSTANCE_CLOSED':legacy?'LEGACY_UNVERIFIED':!owner?'UNCLAIMED':owner.host!==this.identity.host?'OWNER_REMOTE':owner.spawning?'SPAWN_UNCONFIRMED':ours&&owner.phase==='ACTIVE'?'OWNED_HERE':cursorNeedsReview?'LOCAL_STOPPED_CHECKPOINT_UNCERTAIN':claimable?'LOCAL_RELEASE_VERIFIED':'LOCAL_EXECUTION_PROTECTED'
    const messages:Record<string,string>={INSTANCE_CLOSED:'Esta instância encerrou; não pode abrir execução.',LEGACY_UNVERIFIED:legacy??'Estado legado sem prova de posse; cursor e histórico preservados.',UNCLAIMED:'Nenhuma reserva registrada. Consultar não abre engine nem confirma sinal.',OWNER_REMOTE:'Reserva pertence a outro nó. Não inferir encerramento remoto pelo relógio ou por PID local.',SPAWN_UNCONFIRMED:'Abertura nativa sem callback confirmado. Reserva preservada; não abrir um segundo engine.',OWNED_HERE:'Reserva desta instância. Posse não comprova vídeo, áudio ou saída física.',LOCAL_RELEASE_VERIFIED:'Reserva local liberada ou encerramento local comprovado. Uma nova abertura ainda exige admissão própria.',LOCAL_EXECUTION_PROTECTED:'Servidor ou engine local ainda existe ou não tem encerramento comprovado. Reserva preservada; PID reutilizado e ausência de permissão não autorizam retomada.'}
    messages.LOCAL_STOPPED_CHECKPOINT_UNCERTAIN='Parada dos processos locais comprovada, mas sem encerramento durável completo da execução. O checkpoint pode estar atrás do conteúdo que foi ao ar. A retomada automática usa o último ponto salvo e pode repetir conteúdo, sem exigir confirmação do operador. Esta consulta não altera nem impede a recuperação e não confirma que ela ocorreu.'
    const diagnostic={code,message:messages[code]!,repairRequired:['LEGACY_UNVERIFIED','OWNER_REMOTE','SPAWN_UNCONFIRMED','LOCAL_EXECUTION_PROTECTED','LOCAL_STOPPED_CHECKPOINT_UNCERTAIN'].includes(code)}
    return {state:legacy?'LEGACY_UNVERIFIED':owner?.phase??'UNCLAIMED',ownedHere:ours,ownerLocal:owner?owner.host===this.identity.host:null,blocked,message:blocked?diagnostic.message:null,diagnostic}
  }
  private legacyReason(channelId:string):string|null{
    const saved=this.db.$client.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get(channelId) as {payload:string}|undefined
    if(saved){const cursor=parseChannelCheckpoint(JSON.parse(saved.payload),channelId);if(cursor.ownerRunId||cursor.playing&&cursor.realEngine)return 'Checkpoint nativo legado sem dono verificável. Preserve o cursor e confira a parada anterior antes da migração; recuperação automática recusada.'}
    if(this.db.$client.prepare("SELECT 1 FROM as_run a LEFT JOIN execution_owner_asrun w ON w.asrun_id=a.id WHERE a.channel_id=? AND a.ended_at IS NULL AND a.execution_kind<>'SIMULATED' AND w.asrun_id IS NULL LIMIT 1").get(channelId))return 'As-run nativo/legado sem dono verificável ainda aberto. Nenhum histórico foi encerrado ou PGM presumido parado.'
    return null
  }
  claim(channelId:string):ExecutionLease{
    if(this.closed)throw blocked('Instância encerrada; nenhuma nova execução será aberta.')
    const lease=this.db.transaction(()=>{
      const previous=readExecutionOwner(this.db.$client,channelId)
      if(previous){
        const ours=previous.boot===this.identity.boot&&previous.host===this.identity.host&&previous.pid===this.identity.pid
        const serverStopped=previous.host===this.identity.host&&this.gone(previous.pid)
        const enginesStopped=previous.host===this.identity.host&&previous.enginePids.every(this.gone)
        if(previous.spawning||!enginesStopped||!(serverStopped||previous.phase==='RELEASED'&&(ours||previous.finalRelease)))throw blocked('Outra instância possui o canal, ou sua parada não pôde ser comprovada. Nenhum engine, saída, CUE ou recuperação foi iniciado.')
      }else{
        // Legacy cursors/rows do not prove that their native process died.
        const reason=this.legacyReason(channelId);if(reason)throw blocked(reason)
      }
      const owner:ExecutionOwner={...this.identity,id:randomUUID(),channelId,sequence:(previous?.sequence??0)+1,phase:'ACTIVE',enginePids:[],engineTokens:{},spawning:false,spawnToken:null,createdAt:new Date().toISOString(),recoveredRunId:previous?.id??null,predecessorResolved:false,finalRelease:false,observationClosed:false}
      this.db.$client.prepare('INSERT INTO execution_owner_runs VALUES(?,?,?,?)').run(owner.id,channelId,JSON.stringify(owner),executionOwnerSignature(owner))
      this.db.$client.prepare('INSERT INTO execution_owner_slots VALUES(?,?,1) ON CONFLICT(channel_id) DO UPDATE SET run_id=excluded.run_id').run(channelId,owner.id)
      if(readExecutionOwner(this.db.$client,channelId)?.id!==owner.id)throw blocked('Posse não foi confirmada duravelmente; nenhum processo foi iniciado.')
      this.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@execution',kind:'EXECUTION_OWNER_CLAIMED',actorUsername:'@runtime',createdAt:owner.createdAt,payload:{channelId,runId:owner.id,sequence:owner.sequence,recoveredRunId:owner.recoveredRunId,automaticTake:false,physicalOutputValidated:false}}).run()
      return new ExecutionLease(this.db,owner,this.gone)
    },{behavior:'immediate'})
    this.leases.add(lease);return lease
  }
  close(){this.closed=true;for(const lease of this.leases)try{lease.finalRelease()}catch{}this.leases.clear()}
  async claimWhenReady(channelId:string):Promise<ExecutionLease>{
    const deadline=performance.now()+4000
    while(true){
      try{return this.claim(channelId)}catch(error){
        const owner=readExecutionOwner(this.db.$client,channelId)
        // Only wait for our deliberately closed child. Do not poll to steal
        // a foreign/live/remote owner after a deadline.
        if(!(error instanceof CollaborativeEditError)||!owner||owner.boot!==this.identity.boot||owner.host!==this.identity.host||owner.pid!==this.identity.pid||owner.phase!=='RELEASED'||performance.now()>=deadline)throw error
        await new Promise(resolve=>setTimeout(resolve,50))
      }
    }
  }
}
export class ExecutionLease {
  // Scoped to this admitted lease and exact authenticated predecessor bytes.
  // Once an original local process was observed absent it cannot resurrect.
  // A subsequently spawned process can reuse its PID; probing again must not
  // mistake that new process for the predecessor and strand the saved cursor.
  // Never persist this evidence or transfer it to another claim/host/record.
  private readonly stoppedPredecessors=new Map<string,string>()
  constructor(private readonly db:Db,readonly identity:ExecutionOwner,private readonly gone:(pid:number)=>boolean=processGone){
    // Prime BEFORE this lease opens any engine/helper. The enclosing claim
    // transaction rolls back if authenticated ancestry cannot be read.
    this.recoverablePredecessorRunIds()
  }
  assertOwned():ExecutionOwner{
    const owner=readExecutionOwner(this.db.$client,this.identity.channelId)
    if(!owner||owner.id!==this.identity.id||owner.boot!==this.identity.boot||owner.host!==this.identity.host||owner.pid!==this.identity.pid||owner.sequence!==this.identity.sequence||owner.phase!=='ACTIVE')throw blocked('A posse do canal mudou ou foi encerrada. Nenhum comando ou checkpoint será enviado/gravado.')
    return owner
  }
  /** Local unresolved ancestry only; never skip a committed predecessor or
   * infer remote process death from a historical checkpoint. */
  canRecoverCursorFrom(runId:string):boolean{
    const current=this.assertOwned()
    if(runId===current.id)return true
    return this.recoverablePredecessorRunIds().includes(runId)
  }
  recoverablePredecessorRunIds():string[]{
    const current=this.assertOwned(),result:string[]=[]
    let descendant=current
    const visited=new Set([current.id])
    for(let depth=0;depth<32;depth++){
      if(descendant.predecessorResolved||!descendant.recoveredRunId||visited.has(descendant.recoveredRunId))break
      const ancestor=readExecutionRun(this.db.$client,descendant.recoveredRunId)
      if(ancestor.channelId!==current.channelId||ancestor.host!==current.host||ancestor.sequence>=descendant.sequence||ancestor.spawning||ancestor.phase==='UNCERTAIN')break
      const releasedHere=ancestor.phase==='RELEASED'&&(ancestor.finalRelease||ancestor.boot===current.boot&&ancestor.pid===current.pid)
      const stamp=JSON.stringify(ancestor)
      if(this.stoppedPredecessors.get(ancestor.id)!==stamp){
        if(!releasedHere&&!this.gone(ancestor.pid)||!ancestor.enginePids.every(this.gone))break
        this.stoppedPredecessors.set(ancestor.id,stamp)
      }
      result.push(ancestor.id)
      visited.add(ancestor.id);descendant=ancestor
    }
    return result
  }
  private change(update:(owner:ExecutionOwner)=>ExecutionOwner){
    this.db.transaction(()=>{const owner=update(this.assertOwned());this.db.$client.prepare('UPDATE execution_owner_runs SET payload=?,signature=? WHERE id=?').run(JSON.stringify(owner),executionOwnerSignature(owner),owner.id)},{behavior:'immediate'})
  }
  canSpawn(){try{const owner=this.assertOwned();return !owner.spawning&&owner.enginePids.length===0}catch{return false}}
  beforeSpawn(spawnToken:string){this.change(owner=>{if(owner.spawning||owner.enginePids.length>0)throw blocked('Processo anterior vivo/sem saída confirmada ou abertura inconclusiva; nenhum segundo engine será iniciado.');return {...owner,spawning:true,spawnToken}})}
  spawned(pid:number,spawnToken:string){this.change(owner=>{if(!owner.spawning||owner.spawnToken!==spawnToken||!Number.isSafeInteger(pid)||pid<1||owner.enginePids.includes(pid))throw blocked('PID/generação nativa não confirmados; abertura permanece protegida.');return {...owner,spawning:false,spawnToken:null,enginePids:[...owner.enginePids,pid],engineTokens:{...owner.engineTokens,[spawnToken]:pid}}})}
  /** Only an actual exit/error callback for our ChildProcess may retire it. */
  exited(pid:number|null,spawnToken:string){
    this.db.transaction(()=>{
      const current=readExecutionOwner(this.db.$client,this.identity.channelId)
      if(!current||current.id!==this.identity.id||current.boot!==this.identity.boot||!['ACTIVE','RELEASED'].includes(current.phase))throw blocked('O callback não pertence ao dono atual; nenhum PID foi retirado da proteção.')
      if(pid===null?current.spawnToken!==spawnToken:current.engineTokens[spawnToken]!==pid)throw blocked('Callback de outra geração; proteção do processo atual preservada.')
      const engineTokens={...current.engineTokens};delete engineTokens[spawnToken]
      const owner={...current,spawning:pid===null?false:current.spawning,spawnToken:pid===null?null:current.spawnToken,engineTokens,enginePids:current.enginePids.filter(value=>value!==pid)}
      this.db.$client.prepare('UPDATE execution_owner_runs SET payload=?,signature=? WHERE id=?').run(JSON.stringify(owner),executionOwnerSignature(owner),owner.id)
    },{behavior:'immediate'})
  }
  release(){this.change(owner=>({...owner,phase:'RELEASED'}))}
  /** Only called after observation queue was drained, with callbacks stopped.
   * Process release alone is not proof that incident history was flushed. */
  sealObservation(){this.change(owner=>({...owner,observationClosed:true}))}
  finalRelease(){
    this.db.transaction(()=>{
      const current=readExecutionOwner(this.db.$client,this.identity.channelId)
      if(!current||current.id!==this.identity.id||current.boot!==this.identity.boot||!['ACTIVE','RELEASED'].includes(current.phase))throw blocked('Posse alterada; encerramento antigo não libera o novo dono.')
      const owner={...current,phase:'RELEASED' as const,finalRelease:true}
      this.db.$client.prepare('UPDATE execution_owner_runs SET payload=?,signature=? WHERE id=?').run(JSON.stringify(owner),executionOwnerSignature(owner),owner.id)
    },{behavior:'immediate'})
  }
  acknowledgeStoppedPredecessor(){this.change(owner=>({...owner,predecessorResolved:true}))}
  bindAsRun(id:string){const owner=this.assertOwned(),row=this.db.$client.prepare('SELECT channel_id FROM as_run WHERE id=?').get(id) as {channel_id:string}|undefined;if(row?.channel_id!==owner.channelId)throw blocked('Vínculo de as-run não pertence ao canal dono.');this.db.$client.prepare('INSERT INTO execution_owner_asrun VALUES(?,?,?)').run(id,this.identity.id,executionAsRunSignature(id,this.identity.id))}
  ownsAsRun(id:string){this.assertOwned();const row=this.db.$client.prepare('SELECT signature FROM execution_owner_asrun WHERE asrun_id=? AND run_id=?').get(id,this.identity.id) as {signature:string}|undefined;return Boolean(row&&row.signature===executionAsRunSignature(id,this.identity.id))}
}

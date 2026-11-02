import {randomUUID} from 'node:crypto'
import type {Db} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {readExecutionOwner} from '../db/execution-ownership.js'
import {readDistributionOwner,distributionOwnerSignature,type DistributionOwner} from '../db/distribution-ownership.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {executionHostIdentity} from './execution-host.js'
import {ExecutionOwnership,type ExecutionProcessIdentity} from './execution-ownership.js'
import type {HostDistributionFence} from './host-distribution-fence.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
export interface NativeResourceGuard {
  claim():string
  assertOwned(runId?:string):DistributionOwner
  canSpawn(resource:string):boolean
  beforeSpawn(resource:string,token:string):void
  spawned(resource:string,pid:number|null,token:string):void
  exited(resource:string,pid:number|null,token:string):void
}
const blocked=(error:string)=>new CollaborativeEditError(409,{error,distributionOwnershipBlocked:true})
const processGone=(pid:number)=>{try{process.kill(pid,0);return false}catch(error){return(error as NodeJS.ErrnoException).code==='ESRCH'}}
/** Whole shared local installation, not a channel lease or cross-host/DB fence.
 * No timeout permits stealing a resource; pending spawn and unknown PIDs gate
 * config, native startup, restart and relay replacement. */
export class DistributionOwnership implements NativeResourceGuard {
  private runId:string|null=null
  private closed=false
  readonly identity:ExecutionProcessIdentity
  constructor(private readonly db:Db,identity?:ExecutionProcessIdentity,private readonly gone:(pid:number)=>boolean=processGone,private readonly hostFence:HostDistributionFence|null=null,private readonly restoredStage:(()=>void)|null=null){this.identity=identity??{host:executionHostIdentity(),pid:process.pid,boot:randomUUID()}}
  private assertHost(){try{this.hostFence?.assertOwned()}catch{throw new CollaborativeEditError(409,{error:'Distribuição do computador pertence a outra instância ou sua posse não está confirmada. Nenhum recurso será alterado.',distributionOwnershipBlocked:true,hostDistributionBlocked:true})}}
  private nativeBlocker():boolean{
    return (this.db.$client.prepare('SELECT id FROM channels').all() as {id:string}[]).some(row=>{
      const owner=readExecutionOwner(this.db.$client,row.id)
      if(!owner)return new ExecutionOwnership(this.db,this.identity,this.gone).status(row.id).blocked
      if(owner.phase==='RELEASED'&&!owner.spawning&&owner.enginePids.length===0)return false
      if(owner.host!==this.identity.host||owner.spawning||!owner.enginePids.every(this.gone))return true
      return !this.gone(owner.pid)&&!(owner.phase==='RELEASED'&&owner.finalRelease)
    })
  }
  private claimable(owner:DistributionOwner){return owner.host===this.identity.host&&Object.values(owner.children).every(child=>child.pid!==null&&this.gone(child.pid))&&(this.gone(owner.pid)||owner.phase==='RELEASED')&&!this.nativeBlocker()}
  status(){
    const owner=readDistributionOwner(this.db.$client)
    const host=this.hostFence?.status(),hostBlocked=host?.blocked===true
    const ours=Boolean(!hostBlocked&&!this.closed&&owner?.phase==='ACTIVE'&&owner.id===this.runId&&owner.boot===this.identity.boot&&owner.host===this.identity.host&&owner.pid===this.identity.pid)
    const rehearsal=isRecoveryRehearsal(this.db.$client)
    const denied=Boolean(hostBlocked||this.closed||rehearsal||(owner?!ours&&!this.claimable(owner):this.nativeBlocker()))
    const code=hostBlocked?'HOST_FENCE_UNCONFIRMED':this.closed?'INSTANCE_CLOSED':rehearsal?'REHEARSAL_NOT_PROMOTED':ours?'OWNED_HERE':owner?.host!==undefined&&owner.host!==this.identity.host?'OWNER_REMOTE':owner&&Object.values(owner.children).some(child=>child.pid===null)?'SPAWN_UNCONFIRMED':owner?denied?'LOCAL_RESOURCES_PROTECTED':'LOCAL_RELEASE_VERIFIED':denied?'CHANNEL_EXECUTION_PROTECTED':'UNCLAIMED'
    const messages:Record<string,string>={HOST_FENCE_UNCONFIRMED:'Posse nativa do computador não confirmada. Configurações e novos processos permanecem bloqueados.',INSTANCE_CLOSED:'Distribuição desta instância encerrada; nenhum recurso será aberto.',REHEARSAL_NOT_PROMOTED:'Banco restaurado para ensaio não autoriza promoção nem publicação.',OWNED_HERE:'Distribuição reservada nesta instância. Isso não comprova sinal físico nem redundância entre máquinas.',OWNER_REMOTE:'Reserva de outro nó; encerramento remoto não pode ser inferido por PID local ou prazo.',SPAWN_UNCONFIRMED:'Recurso reservado sem callback de abertura confirmado. Não iniciar processo duplicado.',LOCAL_RESOURCES_PROTECTED:'Servidor, recurso ou execução de canal local ainda existe ou tem parada inconclusiva. Configurações e processos preservados.',LOCAL_RELEASE_VERIFIED:'Liberação local verificada; novas configurações e processos ainda exigem admissão própria.',CHANNEL_EXECUTION_PROTECTED:'Execução de um canal ou estado legado impede reservar a distribuição. Checkpoints e histórico preservados.',UNCLAIMED:'Sem reserva registrada; consulta não cria servidores de mídia ou relays.'}
    const diagnostic={code,message:messages[code]!,repairRequired:denied&&!this.closed}
    return {state:owner?.phase??'UNCLAIMED',ownedHere:ours,ownerLocal:owner?owner.host===this.identity.host:null,blocked:denied,message:denied?diagnostic.message:null,diagnostic,...(host?{hostState:host.state,hostDistributionBlocked:hostBlocked,nativeQueryFailure:host.nativeQueryFailure??null}:{}),physicalOutputValidated:false,promotionReady:false}
  }
  claim():string{
    this.assertHost()
    if(this.closed)throw blocked('Distribuição encerrada; nenhum recurso será aberto.')
    if(isRecoveryRehearsal(this.db.$client)){if(this.restoredStage)this.restoredStage();else throw blocked('Ensaio restaurado não é instalação promovida; distribuição bloqueada.')}
    if(this.runId)return this.assertOwned().id
    const runId=this.db.transaction(()=>{
      this.assertHost()
      this.assertPredecessorReleased()
      const previous=readDistributionOwner(this.db.$client)
      const owner:DistributionOwner={...this.identity,id:randomUUID(),sequence:(previous?.sequence??0)+1,phase:'ACTIVE',createdAt:new Date().toISOString(),children:{}}
      this.db.$client.prepare('INSERT INTO distribution_owner_runs VALUES(?,?,?)').run(owner.id,JSON.stringify(owner),distributionOwnerSignature(owner))
      this.db.$client.prepare('INSERT INTO distribution_owner_slot VALUES(1,?,1) ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id').run(owner.id)
      if(readDistributionOwner(this.db.$client)?.id!==owner.id)throw blocked('Posse global não foi confirmada; nenhum recurso será aberto.')
      this.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@distribution',kind:'DISTRIBUTION_OWNER_CLAIMED',actorUsername:'@runtime',createdAt:owner.createdAt,payload:{runId:owner.id,sequence:owner.sequence,physicalOutputValidated:false,automaticPromotion:false}}).run()
      return owner.id
    },{behavior:'immediate'})
    this.runId=runId;return runId
  }
  /** Read-only predecessor proof shared by offline restored admission and
   * claim. It deliberately does NOT authorize bypass of the rehearsal marker. */
  assertPredecessorReleased():void{
    this.assertHost()
    if(this.closed)throw blocked('Distribuição encerrada; nenhuma admissão será aberta.')
    const previous=readDistributionOwner(this.db.$client)
    if(previous&&!this.claimable(previous)||!previous&&this.nativeBlocker())throw blocked('Outra instância ou engine anterior ainda possui recursos da distribuição. Nenhum arquivo, relay ou servidor de mídia foi alterado.')
  }
  assertOwned(runId=this.runId??undefined):DistributionOwner{
    this.assertHost()
    if(isRecoveryRehearsal(this.db.$client)){if(this.restoredStage)this.restoredStage();else throw blocked('Distribuição restaurada permanece em quarentena.')}
    const owner=readDistributionOwner(this.db.$client)
    if(this.closed||!owner||!runId||owner.id!==runId||owner.id!==this.runId||owner.phase!=='ACTIVE'||owner.boot!==this.identity.boot||owner.host!==this.identity.host||owner.pid!==this.identity.pid)throw blocked('Posse global mudou/encerrou; configuração e comandos preservados.')
    return owner
  }
  owns(){try{this.assertOwned();return true}catch{return false}}
  private change(update:(owner:DistributionOwner)=>DistributionOwner){this.db.transaction(()=>{const owner=update(this.assertOwned());this.db.$client.prepare('UPDATE distribution_owner_runs SET payload=?,signature=? WHERE id=?').run(JSON.stringify(owner),distributionOwnerSignature(owner),owner.id)},{behavior:'immediate'})}
  canSpawn(resource:string){try{return !Object.values(this.assertOwned().children).some(child=>child.resource===resource)}catch{return false}}
  beforeSpawn(resource:string,token:string){this.change(owner=>{if(Object.values(owner.children).some(child=>child.resource===resource))throw blocked('Recurso anterior ainda não confirmou saída; nenhum segundo processo será aberto.');return {...owner,children:{...owner.children,[token]:{resource,pid:null}}}})}
  spawned(resource:string,pid:number|null,token:string){if(pid===null)return;this.change(owner=>{const child=owner.children[token];if(!Number.isSafeInteger(pid)||pid<1||child?.resource!==resource||child.pid!==null||Object.values(owner.children).some(child=>child.pid===pid))throw blocked('PID/generação de recurso não confirmado.');return {...owner,children:{...owner.children,[token]:{resource,pid}}}})}
  exited(resource:string,pid:number|null,token:string){
    this.db.transaction(()=>{const current=readDistributionOwner(this.db.$client),child=current?.children[token];if(!current||current.id!==this.runId||current.boot!==this.identity.boot||child?.resource!==resource||child.pid!==pid)throw blocked('Callback não pertence à geração atual da distribuição.');const children={...current.children};delete children[token];const owner={...current,children};this.db.$client.prepare('UPDATE distribution_owner_runs SET payload=?,signature=? WHERE id=?').run(JSON.stringify(owner),distributionOwnerSignature(owner),owner.id)},{behavior:'immediate'})
  }
  close(){
    if(this.closed)return
    try{if(this.runId)this.change(owner=>({...owner,phase:'RELEASED'}))}finally{this.closed=true}
  }
}

import type {ExecutionLease} from './execution-ownership.js'
import type {DistributionOwnership} from './distribution-ownership.js'
import type {HostDistributionFence,HostProcessIdentity} from './host-distribution-fence.js'

/** One native generation only. This is local restored execution, not a
 * cross-host witness or HA failover. Native nonce deadlines remain authoritative.
 * Caller must retire this object after observed engine exit before replacement. */
export class LocalRestoredEngineLease {
 private identity:HostProcessIdentity|null=null
 private owner:string|null=null
 private lastNonce=0
 private revoked=false
 private serial:Promise<unknown>=Promise.resolve()
 constructor(private readonly execution:ExecutionLease,private readonly distribution:DistributionOwnership,
   private readonly host:HostDistributionFence,private readonly enginePid:()=>number|null,
   private readonly assertAdmission:()=>void){}
 grant(owner:string,nonce:number):Promise<{term:number;ttlMs:number}>{
  const task=this.serial.then(async()=>{
   try{
    if(this.revoked||!/^[-a-f0-9]{36}$/i.test(owner)||!Number.isSafeInteger(nonce)||nonce<=this.lastNonce)throw new Error('Concessão local inválida ou já revogada.')
    const before=this.assertCurrent()
    if(this.owner&&this.owner!==owner)throw new Error('Concessão pertence a outra geração nativa.')
    await this.host.freshProof()
    const proven=this.assertCurrent()
    if(proven.id!==before.id||proven.sequence!==before.sequence||proven.pid!==before.pid)throw new Error('Posse/processo mudou durante prova do host.')
    if(!this.identity){this.identity=await this.host.pinProcess(before.pid,owner);this.owner=owner}
    await this.host.processBindings(this.identity)
    const after=this.assertCurrent()
    if(after.id!==before.id||after.sequence!==before.sequence||after.pid!==before.pid||this.identity.pid!==after.pid)throw new Error('Posse/processo mudou durante concessão local.')
    this.lastNonce=nonce
    return {term:after.sequence,ttlMs:5000}
   }catch(error){this.revoked=true;throw error}
  })
  this.serial=task.catch(()=>{})
  return task
 }
 private assertCurrent(){
  this.assertAdmission();this.host.assertOwned();this.distribution.assertOwned()
  const owner=this.execution.assertOwned(),pid=this.enginePid()
  if(!pid||!Number.isSafeInteger(pid)||pid<=0||owner.spawning||owner.enginePids.length!==1||owner.enginePids[0]!==pid||Object.values(owner.engineTokens).filter(value=>value===pid).length!==1)throw new Error('Processo nativo local não é a geração registrada do canal.')
  return {id:owner.id,sequence:owner.sequence,pid}
 }
 async retireAfterObservedExit(){
  this.revoked=true;await this.serial
  const owner=this.execution.assertOwned()
  if(this.identity&&owner.enginePids.includes(this.identity.pid))throw new Error('Processo anterior ainda registrado; concessão não pode ser substituída.')
  if(this.identity)await this.host.releaseProcess(this.identity)
  this.identity=null
 }
}

/** Serializes retirement before a replacement process can receive a grant.
 * A new UUID on the same PID is not treated as a replacement generation. */
export class LocalRestoredEngineGenerations {
 private current:{pid:number;owner:string;lease:LocalRestoredEngineLease}|null=null
 private serial:Promise<unknown>=Promise.resolve()
 constructor(private readonly execution:ExecutionLease,private readonly distribution:DistributionOwnership,
  private readonly host:HostDistributionFence,private readonly enginePid:()=>number|null,
  private readonly assertAdmission:()=>void){}
 grant(owner:string,nonce:number):Promise<{term:number;ttlMs:number}>{
  const task=this.serial.then(async()=>{
   this.assertAdmission();this.host.assertOwned();this.distribution.assertOwned()
   const pid=this.enginePid()
   if(!pid)throw new Error('Engine local não está ativo.')
   if(this.current&&this.current.pid===pid&&this.current.owner!==owner)throw new Error('Outra identidade no mesmo processo não autoriza nova geração.')
   if(this.current&&this.current.pid!==pid){await this.current.lease.retireAfterObservedExit();this.current=null}
   if(!this.current)this.current={pid,owner,lease:new LocalRestoredEngineLease(this.execution,this.distribution,this.host,this.enginePid,this.assertAdmission)}
   return this.current.lease.grant(owner,nonce)
  })
  this.serial=task.catch(()=>{})
  return task
 }
 async retireAfterObservedExit(){await this.serial;if(this.current){await this.current.lease.retireAfterObservedExit();this.current=null}}
}

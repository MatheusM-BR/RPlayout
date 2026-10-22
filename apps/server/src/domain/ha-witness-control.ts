import type Database from 'better-sqlite3'
import {timingSafeEqual} from 'node:crypto'
import {z} from 'zod'
import {SecretVault} from './secret-vault.js'

const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const base={version:z.literal(1),clusterId:identifier,channelId:z.string().min(1).max(128),nodeId:identifier,requestTime:integer.positive()}
export const witnessControlRequest=z.discriminatedUnion('purpose',[
  z.object({...base,purpose:z.literal('ASSIGNMENT')}).strict(),
  z.object({...base,purpose:z.literal('TRANSFER'),requestId:z.string().uuid(),fromNodeId:identifier,targetNodeId:identifier,expectedTerm:integer,expectedRevision:integer.positive()}).strict(),
  z.object({...base,purpose:z.literal('TRANSFER_QUERY'),requestId:z.string().uuid()}).strict(),
])
export type WitnessControlRequest=z.infer<typeof witnessControlRequest>
export type WitnessTransferRequest=Extract<WitnessControlRequest,{purpose:'TRANSFER'}>
export const witnessTransferCommand=witnessControlRequest.options[1].omit({version:true,purpose:true,clusterId:true,nodeId:true,requestTime:true})
export function witnessControlCanonical(request:WitnessControlRequest){
  const common=[request.version,request.purpose,request.clusterId,request.channelId,request.nodeId,request.requestTime]
  return JSON.stringify(request.purpose==='TRANSFER'?[...common,request.requestId,request.fromNodeId,request.targetNodeId,request.expectedTerm,request.expectedRevision]:request.purpose==='TRANSFER_QUERY'?[...common,request.requestId]:common)
}
const assignmentSchema=z.object({version:z.literal(1),clusterId:identifier,channelId:z.string().min(1).max(128),selectedNodeId:identifier,revision:integer.positive(),lastTransferId:z.string().uuid().nullable(),assignedAt:z.string().datetime()}).strict()
const transferResult=z.object({kind:z.literal('TRANSFER'),version:z.literal(1),clusterId:identifier,channelId:z.string().min(1).max(128),requestId:z.string().uuid(),fromNodeId:identifier,targetNodeId:identifier,
  expectedTerm:integer,expectedRevision:integer.positive(),phase:z.enum(['TRANSFERRED','REFUSED']),reason:z.enum(['EXPLICIT_TRANSFER','CHANNEL_NOT_ASSIGNED','STALE_ASSIGNMENT','LEASE_NOT_EXPIRED','REVISION_EXHAUSTED']),
  recordedAt:z.string().datetime(),assignmentRevision:integer,automaticTake:z.literal(false),physicalOutputValidated:z.literal(false)}).strict()
const assignmentResult=z.object({kind:z.literal('ASSIGNMENT'),version:z.literal(1),clusterId:identifier,channelId:z.string().min(1).max(128),selectedNodeId:identifier.nullable(),revision:integer,lastTransferId:z.string().uuid().nullable(),lastTerm:integer,lastEngineOwnerId:z.string().uuid().nullable(),lastEngineNodeId:identifier.nullable(),engineLeaseActive:z.boolean(),waitingForLeaseExpiry:z.boolean(),automaticTake:z.literal(false),physicalOutputValidated:z.literal(false)}).strict()
const notFoundResult=z.object({kind:z.literal('NOT_FOUND'),version:z.literal(1),clusterId:identifier,channelId:z.string().min(1).max(128),requestId:z.string().uuid(),terminal:z.literal(false),automaticTake:z.literal(false),physicalOutputValidated:z.literal(false)}).strict()
export const witnessControlResponse=z.object({version:z.literal(1),responseTo:witnessControlRequest,result:z.discriminatedUnion('kind',[assignmentResult,transferResult,notFoundResult]),signature:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict()
type Result=z.infer<typeof witnessControlResponse>['result']
type Assignment=z.infer<typeof assignmentSchema>
type StoredTransfer={request:WitnessTransferRequest;result:z.infer<typeof transferResult>}
const equal=(a:string,b:string)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
const transferIdentity=(request:WitnessTransferRequest)=>JSON.stringify([request.version,request.purpose,request.clusterId,request.channelId,request.nodeId,request.requestId,request.fromNodeId,request.targetNodeId,request.expectedTerm,request.expectedRevision])
export class WitnessControlError extends Error {constructor(readonly status:number,message:string){super(message)}}

/** Durable node admission is separate from a short engine grant. Expiration
 * cannot silently re-admit the old primary. Control uses a DIFFERENT key;
 * an engine/relay holding the lease key cannot transfer node authority. */
export class HaWitnessControl {
  constructor(private readonly db:Database.Database,private readonly leaseVault:SecretVault,private readonly controlVault:SecretVault|null,
    private readonly clusterId:string,private readonly nodes:readonly string[],private readonly assertOwner:()=>void,
    private readonly state:(channelId:string)=>{term:number;lastEngineOwnerId:string|null;lastEngineNodeId:string|null;engineLeaseActive:boolean;transferBlocked:boolean}){}
  /** Run only inside the constructor's ownership/identity transaction. */
  initialize(){
    if(!this.db.inTransaction)throw new WitnessControlError(409,'Admissão da testemunha exige transação de posse.')
    this.db.exec(`CREATE TABLE IF NOT EXISTS witness_assignments(channel_id TEXT PRIMARY KEY,payload TEXT NOT NULL,signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS witness_transfers(request_id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,payload TEXT NOT NULL,signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS witness_control_identity(id INTEGER PRIMARY KEY CHECK(id=1),identity TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS witness_transfers_no_update BEFORE UPDATE ON witness_transfers BEGIN SELECT RAISE(ABORT,'transfer history cannot be updated'); END;
      CREATE TRIGGER IF NOT EXISTS witness_transfers_no_delete BEFORE DELETE ON witness_transfers BEGIN SELECT RAISE(ABORT,'transfer history cannot be deleted'); END;
      CREATE TRIGGER IF NOT EXISTS witness_transfers_no_replace BEFORE INSERT ON witness_transfers WHEN EXISTS(SELECT 1 FROM witness_transfers WHERE request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'transfer history cannot be replaced'); END;`)
    if(this.controlVault){
      const identity=JSON.stringify([this.clusterId,[...this.nodes].sort(),this.controlVault.fingerprint])
      const previous=this.db.prepare('SELECT identity FROM witness_control_identity WHERE id=1').get() as {identity:string}|undefined
      if(previous&&previous.identity!==identity)throw new WitnessControlError(409,'Chave de controle pertence a outro pareamento; histórico não será redefinido.')
      if(!previous)this.db.prepare('INSERT INTO witness_control_identity VALUES(1,?)').run(identity)
    }
    // Upgrade an existing witness without reverting its last admitted node.
    for(const row of this.db.prepare('SELECT channel_id,node_id,term FROM witness_channels').iterate() as Iterable<{channel_id:string;node_id:string;term:number}>){
      if(!this.nodes.includes(row.node_id)||!integer.positive().safeParse(row.term).success)throw new WitnessControlError(409,'Histórico de concessão inválido; admissão não será presumida.')
      if(!this.assignment(row.channel_id))this.createAssignment(row.channel_id,row.node_id)
    }
    for(const row of this.db.prepare('SELECT channel_id FROM witness_assignments').iterate() as Iterable<{channel_id:string}>){
      const assignment=this.assignment(row.channel_id)!
      if(assignment.revision===1&&assignment.lastTransferId!==null||assignment.revision>1&&!assignment.lastTransferId)throw new WitnessControlError(409,'Admissão não corresponde ao histórico de transferência.')
      if(assignment.lastTransferId){const record=this.transferRecord(assignment.lastTransferId);if(!record||record.result.phase!=='TRANSFERRED'||record.result.channelId!==assignment.channelId||record.result.targetNodeId!==assignment.selectedNodeId||record.result.assignmentRevision!==assignment.revision)throw new WitnessControlError(409,'Última transferência da admissão ausente/incompatível.')}
    }
    for(const row of this.db.prepare('SELECT request_id FROM witness_transfers').iterate() as Iterable<{request_id:string}>)this.transferRecord(row.request_id)
  }
  private assignment(channelId:string):Assignment|null{
    const row=this.db.prepare('SELECT payload,signature FROM witness_assignments WHERE channel_id=?').get(channelId) as {payload:string;signature:string}|undefined
    if(!row)return null
    if(!equal(row.signature,this.leaseVault.reviewIdentity(row.payload,'ha-witness-assignment:v1:'+this.clusterId+':'+channelId)))throw new WitnessControlError(409,'Admissão de nó alterada; nenhum engine autorizado.')
    const value=assignmentSchema.parse(JSON.parse(row.payload))
    if(value.clusterId!==this.clusterId||value.channelId!==channelId||!this.nodes.includes(value.selectedNodeId))throw new WitnessControlError(409,'Admissão não pertence ao cluster/canal.')
    return value
  }
  private createAssignment(channelId:string,nodeId:string){
    const value=assignmentSchema.parse({version:1,clusterId:this.clusterId,channelId,selectedNodeId:nodeId,revision:1,lastTransferId:null,assignedAt:new Date().toISOString()}),payload=JSON.stringify(value)
    this.db.prepare('INSERT INTO witness_assignments VALUES(?,?,?)').run(channelId,payload,this.leaseVault.reviewIdentity(payload,'ha-witness-assignment:v1:'+this.clusterId+':'+channelId))
    return value
  }
  admit(channelId:string,nodeId:string){
    if(!this.db.inTransaction)throw new WitnessControlError(409,'Concessão sem transação de autoridade.')
    const assignment=this.assignment(channelId)??this.createAssignment(channelId,nodeId)
    if(assignment.selectedNodeId!==nodeId)throw new WitnessControlError(409,'Nó não admitido neste canal. Expiração não transfere autoridade; transferência explícita obrigatória.')
  }
  assertAdmitted(channelId:string,nodeId:string){
    if(this.assignment(channelId)?.selectedNodeId!==nodeId)throw new WitnessControlError(409,'Nó de saída não possui admissão persistente do canal.')
  }
  private transferRecord(requestId:string):StoredTransfer|null{
    const row=this.db.prepare('SELECT channel_id,payload,signature FROM witness_transfers WHERE request_id=?').get(requestId) as {channel_id:string;payload:string;signature:string}|undefined
    if(!row)return null
    if(!equal(row.signature,this.leaseVault.reviewIdentity(row.payload,'ha-witness-transfer-record:v1:'+this.clusterId+':'+requestId)))throw new WitnessControlError(409,'Histórico de transferência alterado.')
    const schema=z.object({version:z.literal(1),request:witnessControlRequest.options[1],result:transferResult}).strict(),value=schema.parse(JSON.parse(row.payload))
    if(value.result.phase==='TRANSFERRED'&&(value.result.reason!=='EXPLICIT_TRANSFER'||value.result.assignmentRevision!==value.request.expectedRevision+1)||value.result.phase==='REFUSED'&&value.result.reason==='EXPLICIT_TRANSFER')throw new WitnessControlError(409,'Resultado de transferência incompatível com fase/revisão.')
    if(value.request.clusterId!==this.clusterId||value.request.channelId!==row.channel_id||value.request.requestId!==requestId||value.result.clusterId!==this.clusterId||value.result.channelId!==row.channel_id||value.result.requestId!==requestId||value.result.fromNodeId!==value.request.fromNodeId||value.result.targetNodeId!==value.request.targetNodeId||value.result.expectedTerm!==value.request.expectedTerm||value.result.expectedRevision!==value.request.expectedRevision||!this.nodes.includes(value.request.nodeId)||!this.nodes.includes(value.request.fromNodeId)||!this.nodes.includes(value.request.targetNodeId))throw new WitnessControlError(409,'Transferência não corresponde à intenção/canal originais.')
    return value
  }
  handle(value:unknown){
    if(!this.controlVault)throw new WitnessControlError(503,'Controle de transferência não configurado; chave de engine não permite promover nós.')
    const wire=z.object({request:witnessControlRequest,signature:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict().parse(value),request=wire.request
    if(request.clusterId!==this.clusterId||!this.nodes.includes(request.nodeId)||Math.abs(Date.now()-request.requestTime)>60000||!equal(wire.signature,this.controlVault.reviewIdentity(witnessControlCanonical(request),'ha-witness-control-request:v1')))throw new WitnessControlError(403,'Controle da testemunha não autenticado.')
    const result=this.db.transaction(():Result=>{
      this.assertOwner()
      if(request.purpose==='TRANSFER_QUERY'){
        const previous=this.transferRecord(request.requestId)
        if(previous&&previous.request.channelId!==request.channelId)throw new WitnessControlError(409,'Pedido de transferência de outro canal.')
        return previous?.result??{kind:'NOT_FOUND',version:1,clusterId:this.clusterId,channelId:request.channelId,requestId:request.requestId,terminal:false,automaticTake:false,physicalOutputValidated:false}
      }
      const admission=this.assignment(request.channelId),state=this.state(request.channelId)
      if(request.purpose==='ASSIGNMENT')return {kind:'ASSIGNMENT',version:1,clusterId:this.clusterId,channelId:request.channelId,selectedNodeId:admission?.selectedNodeId??null,revision:admission?.revision??0,lastTransferId:admission?.lastTransferId??null,lastTerm:state.term,lastEngineOwnerId:state.lastEngineOwnerId,lastEngineNodeId:state.lastEngineNodeId,engineLeaseActive:state.engineLeaseActive,waitingForLeaseExpiry:state.transferBlocked,automaticTake:false,physicalOutputValidated:false}
      if(!this.nodes.includes(request.fromNodeId)||!this.nodes.includes(request.targetNodeId)||request.fromNodeId===request.targetNodeId)throw new WitnessControlError(400,'Transferência exige os dois nós distintos configurados.')
      const prior=this.transferRecord(request.requestId)
      if(prior){if(transferIdentity(prior.request)!==transferIdentity(request))throw new WitnessControlError(409,'UUID já pertence a outra intenção de transferência.');return prior.result}
      const reason:z.infer<typeof transferResult>['reason']=!admission?'CHANNEL_NOT_ASSIGNED':admission.selectedNodeId!==request.fromNodeId||admission.revision!==request.expectedRevision||state.term!==request.expectedTerm?'STALE_ASSIGNMENT':state.transferBlocked?'LEASE_NOT_EXPIRED':!Number.isSafeInteger(admission.revision+1)?'REVISION_EXHAUSTED':'EXPLICIT_TRANSFER'
      const accepted=reason==='EXPLICIT_TRANSFER',recordedAt=new Date().toISOString(),revision=accepted?admission!.revision+1:admission?.revision??0
      const response=transferResult.parse({kind:'TRANSFER',version:1,clusterId:this.clusterId,channelId:request.channelId,requestId:request.requestId,fromNodeId:request.fromNodeId,targetNodeId:request.targetNodeId,expectedTerm:request.expectedTerm,expectedRevision:request.expectedRevision,phase:accepted?'TRANSFERRED':'REFUSED',reason,recordedAt,assignmentRevision:revision,automaticTake:false,physicalOutputValidated:false})
      if(accepted){
        const previousPayload=JSON.stringify(admission),previousSignature=this.leaseVault.reviewIdentity(previousPayload,'ha-witness-assignment:v1:'+this.clusterId+':'+request.channelId)
        const updated=assignmentSchema.parse({...admission,selectedNodeId:request.targetNodeId,revision,lastTransferId:request.requestId,assignedAt:recordedAt}),payload=JSON.stringify(updated)
        const changed=this.db.prepare('UPDATE witness_assignments SET payload=?,signature=? WHERE channel_id=? AND signature=?').run(payload,this.leaseVault.reviewIdentity(payload,'ha-witness-assignment:v1:'+this.clusterId+':'+request.channelId),request.channelId,previousSignature)
        if(changed.changes!==1)throw new WitnessControlError(409,'Admissão mudou durante a transferência.')
      }
      const payload=JSON.stringify({version:1,request,result:response})
      this.db.prepare('INSERT INTO witness_transfers VALUES(?,?,?,?)').run(request.requestId,request.channelId,payload,this.leaseVault.reviewIdentity(payload,'ha-witness-transfer-record:v1:'+this.clusterId+':'+request.requestId))
      return response
    }).immediate()
    const receipt={version:1 as const,responseTo:request,result}
    return {...receipt,signature:this.controlVault.reviewIdentity(JSON.stringify(receipt),'ha-witness-control-response:v1')}
  }
}

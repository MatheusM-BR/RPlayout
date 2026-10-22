import type Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {installationVault} from './secret-vault.js'
import {readOperationalPayload} from './operational-playlist.js'
import type {HaSnapshot} from './ha-replication.js'
import {sourceAddress} from './source-wire.js'

export interface HaLocalInput {key:string;label:string;family:string;reference:string}
export interface HaBindingInventory {inputs:HaLocalInput[];sdiOutputs:HaLocalInput[]}
type State={sequence:number;digest:string|null;snapshot:HaSnapshot|null}
const text=z.string().min(1).max(2048),identifier=z.string().min(1).max(128)
export const haBindingRequest=z.object({requestId:z.string().uuid(),channelId:identifier,sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),basePlanId:z.string().uuid().nullable(),reviewToken:text,
  inputs:z.array(z.object({sourceKey:z.string().regex(/^[a-f0-9]{64}$/),localKey:text}).strict()).max(1000),
  outputs:z.array(z.object({outputId:identifier,disposition:z.enum(['LOCAL','DISABLED']),localTarget:text.optional(),reason:z.string().trim().min(1).max(500).optional()}).strict()).max(256),
}).strict()
type Request=z.infer<typeof haBindingRequest>
type Stored={version:1;request:Request;planIdentity?:string|null;createdAt:string;actor:string|null;snapshotDigest:string;bindingDigest:string;confirmedSequence:number;inventoryHash:string;localInputs:Array<{sourceKey:string;local:HaLocalInput}>;localOutputs:Array<{outputId:string;kind:string;target:string|null;reason:string|null}>}
type Row={id:string;channel_id:string;payload:string}
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const family=(reference:string)=>reference.split(':',1)[0]!.toUpperCase()
const inputFamily=(value:string)=>value==='RTMPS'?'RTMP':value==='RTSPS'?'RTSP':value
export const haSourceBindingKey=(reference:string)=>sha([inputFamily(family(reference)),reference])
export class HaBindingError extends Error {constructor(readonly status:number,message:string){super(message)}}
/** Frozen local configuration review, not a promotion token. Primary paths,
 * live endpoints and device numbers can never silently become local bindings. */
export class HaBindings {
  private readonly table:string
  constructor(private readonly db:Database.Database,private readonly nodeContext:string,private readonly current:()=>State,scope:'MIRROR'|'RETURN'='MIRROR',private readonly planIdentity:string|null=null){
    // Identifiers come only from this closed enum, never an HTTP parameter.
    if(scope!=='MIRROR'&&scope!=='RETURN')throw new HaBindingError(409,'Escopo de vínculos inválido.')
    if(scope==='RETURN'&&!planIdentity||planIdentity!==null&&!z.string().min(1).max(256).safeParse(planIdentity).success)throw new HaBindingError(409,'Plano de retorno exige identidade de candidato explícita.')
    const prefix=scope==='RETURN'?'ha_return_binding':'ha_local_binding';this.table=prefix+'_plans'
    db.exec(`CREATE TABLE IF NOT EXISTS ${this.table}(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,payload TEXT NOT NULL)`)
    db.exec(`CREATE INDEX IF NOT EXISTS ${prefix}_channel ON ${this.table}(channel_id); CREATE TRIGGER IF NOT EXISTS ${prefix}_no_update BEFORE UPDATE ON ${this.table} BEGIN SELECT RAISE(ABORT,'Local HA plan is immutable'); END; CREATE TRIGGER IF NOT EXISTS ${prefix}_no_delete BEFORE DELETE ON ${this.table} BEGIN SELECT RAISE(ABORT,'Local HA history cannot be deleted'); END; CREATE TRIGGER IF NOT EXISTS ${prefix}_no_replace BEFORE INSERT ON ${this.table} WHEN EXISTS(SELECT 1 FROM ${this.table} WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Local HA plan cannot be replaced'); END;`)
  }
  private context(id:string){return 'ha-local-bindings:v1:'+this.nodeContext+':'+id}
  private decode(row:Row):Stored {
    const value=JSON.parse(installationVault(false).decrypt(row.payload,this.context(row.id))) as Stored
    const request=haBindingRequest.parse(value.request)
    if(value.version!==1||request.requestId!==row.id||request.channelId!==row.channel_id||!Array.isArray(value.localInputs)||!Array.isArray(value.localOutputs))throw new HaBindingError(409,'Plano local inválido; preserve o histórico.')
    if(value.planIdentity!=null&&!z.string().min(1).max(256).safeParse(value.planIdentity).success)throw new HaBindingError(409,'Identidade histórica inválida; preserve o plano.')
    return value
  }
  private latest(channelId:string){return this.db.prepare(`SELECT * FROM ${this.table} WHERE channel_id=? ORDER BY rowid DESC LIMIT 1`).get(channelId) as Row|undefined}
  private inventoryHash(inventory:HaBindingInventory){return installationVault(false).reviewIdentity(JSON.stringify([inventory.inputs,inventory.sdiOutputs]),'ha-binding-inventory:v1')}
  /** Read immutable receipt by UUID, including superseded decisions. Never
   * return the original request: its output targets can contain credentials. */
  queryPlan(requestId:string,channelId:string,inventory:HaBindingInventory){
    z.string().uuid().parse(requestId);identifier.parse(channelId)
    const row=this.db.prepare(`SELECT * FROM ${this.table} WHERE id=?`).get(requestId) as Row|undefined
    if(!row)return null
    const saved=this.decode(row)
    if(row.channel_id!==channelId||(saved.planIdentity??null)!==this.planIdentity)throw new HaBindingError(409,'Pedido histórico pertence a outro canal/candidato ou não possui vínculo explícito.')
    const required=this.requirements(channelId)
    return {id:saved.request.requestId,channelId,createdAt:saved.createdAt,actor:saved.actor,sequence:saved.confirmedSequence,current:this.latest(channelId)?.id===requestId,stale:saved.bindingDigest!==required.bindingDigest||saved.inventoryHash!==this.inventoryHash(inventory),inputs:structuredClone(saved.request.inputs),outputs:saved.localOutputs.map(output=>({...output,target:output.target?sourceAddress(output.target):null})),confirmationIsHistorical:true as const,operationalReady:false as const}
  }
  private requirements(channelId:string){
    const state=this.current(),channel=state.snapshot?.channels.find(row=>row.channelId===channelId)
    if(!channel||!state.digest||state.sequence<1)throw new HaBindingError(409,'Canal ainda não pertence ao espelho confirmado.')
    const inputs=new Map<string,{sourceKey:string;family:string;reference:string;items:Array<{revisionId:string;itemId:string;title:string}>}>()
    const checkpoint=(channel.checkpoint as {value?:{revisionId?:string;contingency?:{revisionId?:string;loopRevisionId?:string}}}|null)?.value
    const demanded=new Set([channel.configuration.executionRevisionId,checkpoint?.revisionId,checkpoint?.contingency?.revisionId,checkpoint?.contingency?.loopRevisionId].filter((value):value is string=>typeof value==='string'))
    for(const revision of channel.revisions){
      if(revision.active!==true&&!demanded.has(String(revision.id)))continue
      const payload=readOperationalPayload(revision.payload as Record<string,unknown>)
      for(const item of payload.items){
        const reference=item.sourceRef??item.liveEndpoint??item.liveConfig?.sourceEndpoint
        if(!reference)continue
        if(!['SDI','NDI','OMT','SRT','RTSP','RTSPS','RTMP','RTMPS','GUEST'].includes(family(reference)))continue
        const key=haSourceBindingKey(reference),entry=inputs.get(key)??{sourceKey:key,family:inputFamily(family(reference)),reference,items:[]}
        entry.items.push({revisionId:String(revision.id),itemId:item.id,title:item.title});inputs.set(key,entry)
      }
    }
    const outputs=(Array.isArray(channel.configuration.outputs)?channel.configuration.outputs:[]).filter((value:any)=>value.enabled!==false).map((value:any)=>({outputId:String(value.id),name:String(value.name??value.id),kind:value.role==='PROGRAM'?'RTMP':value.role==='PREVIEW'||value.role==='MONITOR'?'SRT':String(value.kind).toUpperCase(),reference:String(value.target??'')}))
    const config=channel.configuration.channel as {programSdiDeviceId?:string|null}|undefined
    if(config?.programSdiDeviceId)outputs.push({outputId:'@masterSDI',name:'Saída SDI principal',kind:'SDI',reference:config.programSdiDeviceId})
    if(new Set(outputs.map(row=>row.outputId)).size!==outputs.length)throw new HaBindingError(409,'Identidades de saída duplicadas no espelho.')
    const relevant=channel.revisions.filter(revision=>revision.active===true||demanded.has(String(revision.id)))
    const bindingDigest=sha([channel.configuration.channel,channel.configuration.revision,relevant.map(row=>[row.id,row.active,sha(row.payload)]),[...inputs.values()],outputs,channel.configuration.outputs])
    return {state,bindingDigest,inputs:[...inputs.values()],outputs}
  }
  private token(channelId:string,sequence:number,bindingDigest:string,basePlanId:string|null,inventoryHash:string){return installationVault(false).reviewIdentity(JSON.stringify([this.nodeContext,channelId,sequence,bindingDigest,basePlanId,inventoryHash]),'ha-binding-review:v1')}
  review(channelId:string,inventory:HaBindingInventory){
    const required=this.requirements(channelId),latest=this.latest(channelId),saved=latest?this.decode(latest):null,inventoryHash=this.inventoryHash(inventory)
    const reviewToken=this.token(channelId,required.state.sequence,required.bindingDigest,latest?.id??null,inventoryHash)
    return {channelId,sequence:required.state.sequence,basePlanId:latest?.id??null,reviewToken,
      inputs:required.inputs.map(row=>({...row,reference:sourceAddress(row.reference)})),outputs:required.outputs.map(row=>({...row,reference:sourceAddress(row.reference)})),
      localInputs:inventory.inputs.map(row=>({key:row.key,label:row.label,family:row.family})),localSdiOutputs:inventory.sdiOutputs.map(row=>({key:row.key,label:row.label,family:row.family})),
      saved:saved?{id:saved.request.requestId,createdAt:saved.createdAt,actor:saved.actor,stale:(saved.planIdentity??null)!==this.planIdentity||saved.bindingDigest!==required.bindingDigest||saved.inventoryHash!==inventoryHash,
        inputs:saved.request.inputs,outputs:saved.localOutputs.map(row=>({...row,target:row.target?sourceAddress(row.target):null}))}:null,
      automaticTake:false,promotionReady:false,physicalSignalValidated:false,mediaAndQcRequired:true,trimMixReviewRequired:true,
    }
  }
  save(value:unknown,inventory:HaBindingInventory,actor:string|null,authorize:()=>void){
    const request=haBindingRequest.parse(value)
    return this.db.transaction(()=>{
      authorize()
      const existing=this.db.prepare(`SELECT * FROM ${this.table} WHERE id=?`).get(request.requestId) as Row|undefined
      if(existing){const saved=this.decode(existing);if((saved.planIdentity??null)!==this.planIdentity||JSON.stringify(saved.request)!==JSON.stringify(request))throw new HaBindingError(409,'Pedido pertence a outro plano. Nenhum vínculo sobrescrito.');return this.review(request.channelId,inventory)}
      const review=this.review(request.channelId,inventory)
      const required=this.requirements(request.channelId)
      const expected=this.token(request.channelId,request.sequence,required.bindingDigest,review.basePlanId,this.inventoryHash(inventory))
      if(request.sequence>review.sequence||request.basePlanId!==review.basePlanId||request.reviewToken!==expected)throw new HaBindingError(409,'Edição, configuração, descoberta ou plano local mudou. Atualize a conferência.')
      if(new Set(request.inputs.map(row=>row.sourceKey)).size!==request.inputs.length||new Set(request.outputs.map(row=>row.outputId)).size!==request.outputs.length||request.inputs.length!==required.inputs.length||request.outputs.length!==required.outputs.length)throw new HaBindingError(422,'Selecione cada entrada e cada saída exatamente uma vez.')
      const localInputs=required.inputs.map(source=>{
        const selected=request.inputs.find(row=>row.sourceKey===source.sourceKey),matches=inventory.inputs.filter(row=>row.key===selected?.localKey)
        if(matches.length!==1||inputFamily(matches[0]!.family)!==source.family)throw new HaBindingError(422,'Entrada local ausente, ambígua ou de outro protocolo.')
        return {sourceKey:source.sourceKey,local:structuredClone(matches[0]!)}
      })
      const localOutputs=required.outputs.map(output=>{
        const selected=request.outputs.find(row=>row.outputId===output.outputId)
        if(!selected)throw new HaBindingError(422,'Saída não pertence à conferência.')
        if(selected.disposition==='DISABLED'){
          if(!selected.reason||selected.localTarget)throw new HaBindingError(422,'Desativação exige motivo e não aceita destino.')
          return {outputId:output.outputId,kind:output.kind,target:null,reason:selected.reason}
        }
        if(selected.reason||!selected.localTarget||selected.localTarget.includes('REDACTED'))throw new HaBindingError(422,'Escolha destino local completo; endereço redigido não é uma configuração.')
        if(output.kind==='SDI'){
          const matches=inventory.sdiOutputs.filter(row=>row.key===selected.localTarget)
          if(matches.length!==1)throw new HaBindingError(422,'Saída SDI deve ser descoberta como saída, não como entrada.')
          return {outputId:output.outputId,kind:output.kind,target:matches[0]!.reference,reason:null}
        }
        const protocol=family(selected.localTarget),accepted:Record<string,string[]>={SRT:['SRT'],RTMP:['RTMP','RTMPS'],NDI:['NDI'],OMT:['OMT'],RTSP:['RTSP','RTSPS'],FILE:['FILE'],RECORD:['FILE']}
        if(!accepted[output.kind]?.includes(protocol))throw new HaBindingError(422,'Tipo de destino local não corresponde à saída publicada.')
        return {outputId:output.outputId,kind:output.kind,target:selected.localTarget,reason:null}
      })
      const stored:Stored={version:1,request,planIdentity:this.planIdentity,createdAt:new Date().toISOString(),actor,snapshotDigest:required.state.digest!,bindingDigest:required.bindingDigest,confirmedSequence:required.state.sequence,inventoryHash:this.inventoryHash(inventory),localInputs,localOutputs}
      authorize()
      const final=this.requirements(request.channelId)
      if(final.bindingDigest!==required.bindingDigest||(this.latest(request.channelId)?.id??null)!==request.basePlanId)throw new HaBindingError(409,'Configuração ou plano mudou antes do registro. Atualize a conferência.')
      this.db.prepare(`INSERT INTO ${this.table} VALUES(?,?,?)`).run(request.requestId,request.channelId,installationVault().encrypt(JSON.stringify(stored),this.context(request.requestId)))
      return this.review(request.channelId,inventory)
    }).immediate()
  }
  executionBindings(channelId:string,planId:string,inventory:HaBindingInventory){
    const row=this.latest(channelId)
    if(!row||row.id!==planId)throw new HaBindingError(409,'Plano local não é mais a edição atual.')
    const saved=this.decode(row),required=this.requirements(channelId)
    if((saved.planIdentity??null)!==this.planIdentity||saved.bindingDigest!==required.bindingDigest||saved.inventoryHash!==this.inventoryHash(inventory))throw new HaBindingError(409,'Plano local mudou ou está desatualizado; nada será preparado para execução.')
    return {planId,bindingDigest:saved.bindingDigest,inputs:structuredClone(saved.localInputs),outputs:structuredClone(saved.localOutputs)}
  }
}

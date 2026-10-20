import { hostname } from 'node:os'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { App, ChannelRuntime } from '../app.js'
import type { Db } from '../db/client.js'
import { channels, operationalPlaylistRevisions, operatorDecisions, rundowns } from '../db/schema.js'
import { toChannel } from '../db/repo.js'
import { readOperationalPayload } from './operational-playlist.js'
import { rundownMidnight } from './rundown-clock.js'
import { installationVault } from './secret-vault.js'
import { boundaryAuthority, boundaryProcessesGone, inspectBoundary, PlaylistBoundaryLedger, type BoundaryOwner, type BoundaryRun } from './playlist-boundary.js'
import { CollaborativeEditError } from './collaborative-edit.js'
import { EngineTransport } from './engine.js'
import { assertOperationalCadence } from './operational-cadence.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'

export interface ContinuityPolicy {
  channelId:string;version:number;state:'ENABLED'|'DISABLED'|'SUSPENDED';mode:'PUBLISHED_ONLY';maxLateMinutes:number
  owner:BoundaryOwner;worker:{host:string;pid:number;boot:string;enginePid:number};channelContract:string;ignoreTerminalIds:string[]
  updatedAt:string;message:string;resultKey?:string
}
const policyKey=(channelId:string)=>`published-continuity:${channelId}`
export function readContinuityPolicy(db:Db,channelId:string):ContinuityPolicy|null{
  const row=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,policyKey(channelId))).get()
  return row?.kind==='PUBLISHED_CONTINUITY_POLICY' && row.payload.channelId===channelId ? row.payload as unknown as ContinuityPolicy:null
}
function channelContract(db:Db,id:string){
  const row=db.select().from(channels).where(eq(channels.id,id)).get()
  if(!row || row.archivedAt)throw new Error('Canal ativo não encontrado.')
  return installationVault().reviewIdentity(JSON.stringify(toChannel(row)),'continuity-channel:v1')
}
/** Strict chronological selection. Never resolves equal starts by UUID, skips
 * an earlier conflict, edits a draft, or treats duration as a signal guarantee. */
export function selectPublishedSuccessor(db:Db,channelId:string,sourceId:string,nowMs:number,maxLateMinutes:number){
  const source=db.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.id,sourceId)).get()
  if(!source?.active)throw new Error('A revisão de origem não está mais publicada como atual.')
  const from=readOperationalPayload(source.payload),base=rundownMidnight(from.rundown.date)
  if(from.rundown.channelId!==channelId || base===null)throw new Error('Origem inválida para este canal.')
  const channelRow=db.select().from(channels).where(eq(channels.id,channelId)).get()
  if(!channelRow||channelRow.archivedAt)throw new Error('Canal ativo não encontrado.')
  const channel=toChannel(channelRow);assertOperationalCadence(db,channel,from)
  const frameMs=1000*channel.rate.den/channel.rate.num
  const start=base+(from.schedule.items[0]?.start??from.rundown.plannedStart)*frameMs,end=base+from.schedule.endsAt*frameMs
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('A grade de origem não tem intervalo publicado válido.')
  const entries=db.select({row:operationalPlaylistRevisions}).from(operationalPlaylistRevisions).innerJoin(rundowns,eq(rundowns.id,operationalPlaylistRevisions.rundownId))
    .where(and(eq(operationalPlaylistRevisions.active,true),eq(rundowns.channelId,channelId))).all().flatMap(({row})=>{
    if(row.id===sourceId)return []
    const payload=readOperationalPayload(row.payload),midnight=rundownMidnight(payload.rundown.date)
    if(payload.rundown.channelId!==channelId)throw new Error('Publicação vinculada a outro canal; confira a integridade da grade.')
    if(midnight===null)throw new Error('Há grade publicada com data inválida. Corrija antes de habilitar continuidade.')
    assertOperationalCadence(db,channel,payload)
    const at=midnight+(payload.schedule.items[0]?.start??payload.rundown.plannedStart)*frameMs
    if(!Number.isFinite(at))throw new Error('Há grade publicada com início inválido. Corrija antes da passagem automática.')
    return at>start ? [{revisionId:row.id,rundownId:row.rundownId,name:payload.rundown.name,at}]:[]
  }).sort((a,b)=>a.at-b.at)
  const next=entries[0]
  if(!next)throw new Error('Nenhuma próxima grade publicada. Publique a programação seguinte; rascunhos não serão usados.')
  if(entries[1]?.at===next.at)throw new Error('Há duas grades publicadas com o mesmo início. Resolva a ambiguidade; nenhuma será escolhida automaticamente.')
  if(Math.abs(next.at-end)>frameMs+0.01)throw new Error('Há intervalo ou sobreposição entre as grades publicadas. Ajuste o timing e publique novamente antes da passagem automática.')
  if(nowMs>next.at+maxLateMinutes*60_000)throw new Error('A próxima grade ultrapassou o atraso autorizado. Confira a programação e retome explicitamente; nenhuma grade será pulada.')
  return next
}

/** One local owner across durable jobs. This is not remote fencing, a second
 * engine, recurring editorial assembly, or automatic approval of new media. */
export class PublishedContinuity {
  private readonly boot=randomUUID()
  private busy=false
  private closed=false
  constructor(private readonly app:Pick<App,'db'|'runtimes'>){}
  status(channelId:string){
    const saved=readContinuityPolicy(this.app.db,channelId)
    const workerState=!saved||saved.state!=='ENABLED'?'OFF':this.owns(saved)?'CURRENT_SERVER':boundaryProcessesGone({processOwner:JSON.stringify(saved.worker)} as BoundaryRun)?'WAITING_RECOVERY':'OTHER_OR_UNKNOWN_SERVER'
    return {channelId,mode:'PUBLISHED_ONLY' as const,version:saved?.version??0,state:saved?.state??'DISABLED',workerState,maxLateMinutes:saved?.maxLateMinutes??5,
      message:saved?.message??'Desligada. Somente uma autorização explícita habilita passagens recorrentes entre grades publicadas.'}
  }
  review(runtime:ChannelRuntime,maxLateMinutes:number,owner:BoundaryOwner){
    if(!Number.isInteger(maxLateMinutes)||maxLateMinutes<0||maxLateMinutes>180)throw new Error('Atraso autorizado deve ficar entre 0 e 180 minutos.')
    const sourceRevisionId=runtime.operationalRevision?.id
    if(!sourceRevisionId)throw new Error('Carregue uma grade publicada antes de configurar a continuidade.')
    const permission=boundaryAuthority(this.app.db,owner,runtime.channel.id),saved=readContinuityPolicy(this.app.db,runtime.channel.id)
    const contract=channelContract(this.app.db,runtime.channel.id)
    const next=selectPublishedSuccessor(this.app.db,runtime.channel.id,sourceRevisionId,Date.now(),maxLateMinutes)
    const plan=inspectBoundary(this.app.db,runtime.channel.id,sourceRevisionId,next.revisionId,owner)
    const token=installationVault().reviewIdentity(JSON.stringify({channelId:runtime.channel.id,sourceRevisionId,maxLateMinutes,owner,permission,version:saved?.version??0,contract,next,planToken:plan.token}),'published-continuity-review:v1')
    return {channelId:runtime.channel.id,sourceRevisionId,sourceRundownId:plan.sourceRundownId,version:saved?.version??0,maxLateMinutes,nextName:next.name,nextRevisionId:next.revisionId,token}
  }
  enable(runtime:ChannelRuntime,maxLateMinutes:number,owner:BoundaryOwner,token:string|undefined,authorize:()=>void){
    if(!(runtime.transport instanceof EngineTransport))throw new Error('Continuidade recorrente exige engine nativo; simulador não confirma passagens reais.')
    if(!runtime.transport.health().ready||!runtime.transport.processId())throw new Error('Engine ainda não está pronto; confira a conexão antes de habilitar continuidade.')
    return this.app.db.transaction(tx=>{
      authorize();const review=this.review(runtime,maxLateMinutes,owner),received=Buffer.from(token??''),expected=Buffer.from(review.token)
      if(!token)throw new CollaborativeEditError(428,{error:'Confira a política e a primeira passagem antes de habilitar.'})
      if(received.length!==expected.length||!timingSafeEqual(received,expected))throw new CollaborativeEditError(409,{error:'Política, publicação, mídia, canal ou permissão mudou. Confira novamente; continuidade não habilitada.'})
      const saved=readContinuityPolicy(this.app.db,runtime.channel.id)
      if(saved?.state==='ENABLED' && !this.owns(saved) && !boundaryProcessesGone({processOwner:JSON.stringify(saved.worker)} as BoundaryRun))throw new Error('Outro servidor ainda detém a continuidade. Encerre ambos os processos antigos; este host não faz fencing remoto.')
      const ledger=new PlaylistBoundaryLedger(this.app.db,runtime.channel.id)
      if(ledger.list().some(run=>['QUEUED','PREPARING','SWITCHING','UNCERTAIN'].includes(run.state)))throw new Error('Há passagem pendente ou incerta; cancele ou reconheça antes de habilitar outra política.')
      const at=new Date().toISOString(),policy:ContinuityPolicy={channelId:runtime.channel.id,version:(saved?.version??0)+1,state:'ENABLED',mode:'PUBLISHED_ONLY',maxLateMinutes,owner,
        worker:this.worker(runtime),channelContract:channelContract(this.app.db,runtime.channel.id),ignoreTerminalIds:ledger.list().filter(run=>run.plan.sourceRevisionId===review.sourceRevisionId).map(run=>run.id),updatedAt:at,message:'Habilitada para grades publicadas. Não monta nem publica rascunhos; não altera CUE/PGM agora.'}
      tx.insert(operatorDecisions).values({id:policyKey(runtime.channel.id),rundownId:review.sourceRundownId,kind:'PUBLISHED_CONTINUITY_POLICY',payload:policy as unknown as Record<string,unknown>,actorUsername:owner.username,createdAt:at})
        .onConflictDoUpdate({target:operatorDecisions.id,set:{payload:policy as unknown as Record<string,unknown>,actorUsername:owner.username}}).run()
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:review.sourceRundownId,kind:'PUBLISHED_CONTINUITY_ENABLED',payload:{channelId:runtime.channel.id,version:policy.version,maxLateMinutes,mode:policy.mode},actorUsername:owner.username,createdAt:at}).run()
      return this.status(runtime.channel.id)
    },{behavior:'immediate'})
  }
  suspend(channelId:string,actor:string|null,message:string,state:'DISABLED'|'SUSPENDED'='SUSPENDED',expectedVersion?:number){
    return this.app.db.transaction(tx=>{
      const saved=readContinuityPolicy(this.app.db,channelId)
      if(!saved || saved.state!=='ENABLED'||expectedVersion!==undefined&&saved.version!==expectedVersion)return this.status(channelId)
      const at=new Date().toISOString(),updated={...saved,version:saved.version+1,state,updatedAt:at,message}
      tx.update(operatorDecisions).set({payload:updated as unknown as Record<string,unknown>}).where(eq(operatorDecisions.id,policyKey(channelId))).run()
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,policyKey(channelId))).get()!.rundownId,kind:'PUBLISHED_CONTINUITY_SUSPENDED',payload:{channelId,version:saved.version,state,message},actorUsername:actor,createdAt:at}).run()
      return this.status(channelId)
    },{behavior:'immediate'})
  }
  private owns(policy:ContinuityPolicy){return policy.worker.host===hostname()&&policy.worker.pid===process.pid&&policy.worker.boot===this.boot}
  private worker(runtime:ChannelRuntime){return {host:hostname(),pid:process.pid,boot:this.boot,enginePid:runtime.transport.processId()!}}
  async tick(){
    if(this.busy||this.closed||isRecoveryRehearsal(this.app.db.$client))return;this.busy=true
    try{for(const runtime of this.app.runtimes.values())await this.advance(runtime)}finally{this.busy=false}
  }
  private async advance(runtime:ChannelRuntime){
    if(this.closed||!(runtime.transport instanceof EngineTransport)||!runtime.transport.state().playing||!runtime.operationalRevision)return
    const channelId=runtime.channel.id
    let saved=readContinuityPolicy(this.app.db,channelId)
    if(saved?.state!=='ENABLED')return
    if(!this.owns(saved)){
      if(!boundaryProcessesGone({processOwner:JSON.stringify(saved.worker)} as BoundaryRun))return
      this.app.db.transaction(tx=>{
        const current=readContinuityPolicy(this.app.db,channelId)
        if(current?.state!=='ENABLED'||current.version!==saved!.version||!boundaryProcessesGone({processOwner:JSON.stringify(current.worker)} as BoundaryRun))return
        const worker=this.worker(runtime)
        tx.update(operatorDecisions).set({payload:{...current,worker}}).where(eq(operatorDecisions.id,policyKey(channelId))).run()
        const policy=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,policyKey(channelId))).get()!
        tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:policy.rundownId,kind:'PUBLISHED_CONTINUITY_OWNER_RECLAIMED',payload:{channelId,version:current.version,from:current.worker,to:worker,localProcessesProvenGone:true},actorUsername:null,createdAt:new Date().toISOString()}).run()
      },{behavior:'immediate'})
      saved=readContinuityPolicy(this.app.db,channelId)
      if(!saved||!this.owns(saved))return
    }
    const captured=saved,source=runtime.operationalRevision.id,ledger=new PlaylistBoundaryLedger(this.app.db,channelId)
    const guard=()=>{
      const current=readContinuityPolicy(this.app.db,channelId)
      if(this.closed||!current||current.state!=='ENABLED'||current.version!==captured.version||!this.owns(current)||runtime.operationalRevision?.id!==source||!runtime.transport.state().playing)throw new Error('A continuidade foi suspensa ou a execução mudou.')
      boundaryAuthority(this.app.db,current.owner,channelId)
      if(current.channelContract!==channelContract(this.app.db,channelId))throw new Error('O formato/perfil do canal mudou; confira e habilite uma nova política.')
    }
    try{
      guard()
      const runs=ledger.list(),pending=runs.find(run=>['QUEUED','PREPARING','SWITCHING','UNCERTAIN'].includes(run.state))
      if(pending){if(pending.state==='UNCERTAIN')this.suspend(channelId,null,'Há passagem incerta; confira o PGM e reconheça antes de retomar.','SUSPENDED',captured.version);return}
      if(runs.some(run=>run.plan.sourceRevisionId===source&&!captured.ignoreTerminalIds.includes(run.id))){this.suspend(channelId,null,'Passagem concluída, cancelada ou recusada ainda corresponde à origem atual. Confira e retome explicitamente; TAKE não será repetido.','SUSPENDED',captured.version);return}
      const next=selectPublishedSuccessor(this.app.db,channelId,source,Date.now(),captured.maxLateMinutes)
      const owner={...captured.owner,policy:{id:policyKey(channelId),version:captured.version}}
      const plan=inspectBoundary(this.app.db,channelId,source,next.revisionId,owner)
      await runtime.transport.mutatePlaylist(()=>runtime.queuePlaylistBoundary(`continuity-${captured.version}-${source}`,plan,plan.token,guard))
      this.app.db.transaction(tx=>{
        const current=readContinuityPolicy(this.app.db,channelId)
        if(current?.state!=='ENABLED'||current.version!==captured.version||!this.owns(current)||runtime.operationalRevision?.id!==source)return
        tx.update(operatorDecisions).set({payload:{...current,message:`Passagem enfileirada para ${plan.targetName}; entrada somente após confirmação nativa do PGM.`,resultKey:source+':'+next.revisionId}}).where(eq(operatorDecisions.id,policyKey(channelId))).run()
      },{behavior:'immediate'})
    }catch(error){
      const message=error instanceof Error?error.message:String(error)
      // Missing/conflicting future publication waits for correction; authority
      // or contract loss is sticky. Persist changed reasons only, no flood.
      try{guard()}catch{this.suspend(channelId,null,message,'SUSPENDED',captured.version);return}
      const key=source+':'+message
      this.app.db.transaction(tx=>{
        const current=readContinuityPolicy(this.app.db,channelId)
        if(current?.state!=='ENABLED'||current.version!==captured.version||!this.owns(current)||current.resultKey===key)return
        tx.update(operatorDecisions).set({payload:{...current,message,resultKey:key}}).where(eq(operatorDecisions.id,policyKey(channelId))).run()
      },{behavior:'immediate'})
    }
  }
  close(){this.closed=true}
}

import {createHash,timingSafeEqual} from 'node:crypto'
import {and,asc,eq} from 'drizzle-orm'
import {DEFAULT_FIT,DEFAULT_QC_PROFILE,assessQc,qcApproved,resolveTrim,resolveAudio,type RundownItem} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,liveSources,mediaAssets,operationalPlaylistRevisions,operatorDecisions,qcDecisions} from '../db/schema.js'
import {toAsset,toChannel} from '../db/repo.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {installationVault} from './secret-vault.js'
import {applyQcDecisionsNow} from './qc-workflow.js'
import {readOperationalPayload,persistRevision,type OperationalPayload} from './operational-playlist.js'
import {assertOperationalCadence} from './operational-cadence.js'
import {assertPublishedAudio} from './audio-bus.js'
import {buildView,type RundownView} from './plan.js'
import {CollaborativeEditError} from './collaborative-edit.js'

export interface InsertionInput {requestId:string;mode:'NEXT'|'NOW';mediaId?:string;sourceId?:string;durationFrames?:number}
export interface InsertionContext {channelId:string;rundownId:string;revisionId:string;executionId:string|null;onAirItemId:string|null}
type Phase='PREPARING'|'SWITCHING'|'CONFIRMED'|'FAILED'|'UNCERTAIN'
export interface InsertionRun {requestId:string;channelId:string;rundownId:string;itemId:string;mode:'NEXT'|'NOW';phase:Phase;actor:string|null;digest:string;configurationRunId:string;sourceRevisionId:string;revisionId?:string;nativeProgramConfirmed:boolean;physicalOutputValidated:false;message?:string}
const key=(id:string)=>`operational-insert:${id}`
const conflict=(message:string)=>new CollaborativeEditError(409,{error:message})

/** Operates on the frozen edition. It never imports unrelated editorial edits,
 * clones external commands or mutates the editorial rundown/asset defaults. */
export function inspectInsertion(db:Db,context:InsertionContext,input:InsertionInput){
  return db.transaction(tx=>{
    const channelRow=tx.select().from(channels).where(eq(channels.id,context.channelId)).get()
    const revision=tx.select().from(operationalPlaylistRevisions).where(and(eq(operationalPlaylistRevisions.id,context.revisionId),eq(operationalPlaylistRevisions.active,true))).get()
    if(!channelRow || channelRow.archivedAt || !revision || revision.rundownId!==context.rundownId)throw conflict('Publique e carregue uma revisão operacional atual antes de inserir na execução.')
    const channel=toChannel(channelRow),old=readOperationalPayload(revision.payload)
    if(old.rundown.channelId!==context.channelId)throw conflict('Revisão de outro canal.')
    assertOperationalCadence(tx,channel,old)
    if(Boolean(input.mediaId)===Boolean(input.sourceId))throw conflict('Escolha um vídeo ou uma entrada cadastrada, não ambos.')
    const rawAsset=input.mediaId?tx.select().from(mediaAssets).where(eq(mediaAssets.id,input.mediaId)).get():undefined
    const source=input.sourceId?tx.select().from(liveSources).where(eq(liveSources.id,input.sourceId)).get():undefined
    const assets=new Map((old.assets??[]).map(asset=>[asset.id,asset]))
    if(input.mediaId){
      if(!rawAsset || rawAsset.kind!=='VIDEO' || !/^[a-f0-9]{64}$/i.test(rawAsset.contentHash))throw conflict('Selecione uma versão de vídeo com SHA válido.')
      const pinned=assets.get(rawAsset.id)
      if(pinned && pinned.contentHash!==rawAsset.contentHash)throw conflict('A edição usa outra versão deste ativo. Publique/revise separadamente; a inserção não substitui os demais VTs por bytes novos.')
      if(!pinned)assets.set(rawAsset.id,toAsset(rawAsset))
    }else if(!source || source.channelId!==context.channelId || !source.enabled || !source.targetUrl || !Number.isSafeInteger(input.durationFrames) || input.durationFrames!<=0)throw conflict('Escolha uma entrada habilitada deste canal e informe sua duração estimada em quadros.')
    const approved=applyQcDecisionsNow(tx,assets,channel.id),asset=input.mediaId?approved.get(input.mediaId):null
    if(input.mediaId && (!asset || asset.ignored || asset.probeError || !qcApproved(asset.qcStatus??'PENDING') || !assessQc(asset,channel.qcProfile??DEFAULT_QC_PROFILE).playable))throw conflict('Vídeo indisponível ou sem aprovação QC neste canal.')
    const position=context.onAirItemId?old.items.findIndex(item=>item.id===context.onAirItemId):-1
    if(context.onAirItemId && position<0)throw conflict('O PGM não pertence à edição em execução. Confira antes da inserção.')
    const selected=rawAsset?toAsset(rawAsset):null
    const item:RundownItem={id:`urgent:${input.requestId}`,rundownId:old.rundown.id,order:position+1,type:source?'LIVE':'VT',eventType:source?'LIVE':'SEQUENTIAL',title:source?.name??selected!.title,mediaId:asset?.id??null,sourceRef:source?.targetUrl??null,trim:selected?resolveTrim(null,selected,channel.rate).value:null,audio:selected?resolveAudio(null,selected,0).value:null,audioTrack:0,notes:null,durationOverride:source?input.durationFrames!:null,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',elastic:null,blockId:null,fit:DEFAULT_FIT,autoNext:true,loop:false,locked:false,protected:true,trimmable:false,optional:false,timingFlags:{protected:true,trimmable:false,optional:false}}
    if(old.items.some(existing=>existing.id===item.id))throw conflict('Esta inserção já pertence à revisão. Consulte o pedido original, sem repetir o TAKE.')
    const items=[...old.items];items.splice(position+1,0,item)
    const ordered=items.map((value,index)=>({...value,order:index}))
    assertPublishedAudio(channel.audioChannels??2,ordered,[...approved.values()])
    const view=buildView(old.rundown,channel,ordered,approved,null,null),candidate=view.items.find(entry=>entry.item.id===item.id)!
    if(candidate.trim.out<=candidate.trim.in || view.schedule.items.find(row=>row.id===item.id)?.state==='DROPPED')throw conflict('O item inserido não tem duração reproduzível. Confira QC/corte e a grade.')
    const payload:OperationalPayload={...old,items:ordered,assets:[...approved.values()],schedule:view.schedule,operation:{kind:'INSERT',mode:input.mode,requestId:input.requestId,itemId:item.id,sourceRevisionId:revision.id,at:''}}
    const decisions=tx.select().from(qcDecisions).orderBy(asc(qcDecisions.createdAt),asc(qcDecisions.id)).all().filter(row=>approved.has(row.assetId))
    const reviewToken=installationVault().reviewIdentity(JSON.stringify({context,input,revision,channel,configurationRevision:configurationRevision(db,channel.id),rawAsset,source,decisions,payload}),'operational-insert:v1')
    return {context,input,payload,view,itemId:item.id,reviewToken}
  })
}
export function requireInsertionReview(plan:ReturnType<typeof inspectInsertion>,token:string){
  const a=Buffer.from(plan.reviewToken),b=Buffer.from(token)
  if(a.length!==b.length||!timingSafeEqual(a,b))throw conflict('Execução, revisão, entrada, vídeo ou QC mudou. Confira novamente; nenhuma inserção/TAKE será feita.')
}
export class OperationalInsertions {
  constructor(private readonly db:Db){}
  read(id:string):InsertionRun|null{const row=this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,key(id))).get();return row?.kind==='OPERATIONAL_INSERT_COMMAND'?row.payload as unknown as InsertionRun:null}
  digest(input:InsertionInput,token:string,actor:string|null){return createHash('sha256').update(JSON.stringify([input,token,actor])).digest('hex')}
  publicRun(run:InsertionRun){const {digest,...publicRun}=run;return publicRun}
  claim(input:InsertionInput,plan:ReturnType<typeof inspectInsertion>,token:string,actor:string|null,configurationRunId:string){
    requireInsertionReview(plan,token)
    const run:InsertionRun={requestId:input.requestId,channelId:plan.context.channelId,rundownId:plan.context.rundownId,itemId:plan.itemId,mode:input.mode,phase:'PREPARING',actor,digest:this.digest(input,token,actor),configurationRunId,sourceRevisionId:plan.context.revisionId,nativeProgramConfirmed:false,physicalOutputValidated:false}
    this.db.insert(operatorDecisions).values({id:key(input.requestId),rundownId:run.rundownId,itemId:run.itemId,kind:'OPERATIONAL_INSERT_COMMAND',actorUsername:actor,createdAt:new Date().toISOString(),payload:run as unknown as Record<string,unknown>}).run()
    return run
  }
  phase(id:string,phase:Phase,details:Partial<Pick<InsertionRun,'revisionId'|'nativeProgramConfirmed'|'message'>>={}){
    const run=this.read(id);if(!run)throw conflict('Registro da inserção ausente; não repita o comando.')
    this.db.update(operatorDecisions).set({payload:{...run,...details,phase}}).where(eq(operatorDecisions.id,key(id))).run()
  }
  commit(plan:ReturnType<typeof inspectInsertion>,actor:string|null,nativeProgramConfirmed:boolean,view:RundownView=plan.view){
    return this.db.transaction(tx=>{
      const active=tx.select().from(operationalPlaylistRevisions).where(and(eq(operationalPlaylistRevisions.id,plan.context.revisionId),eq(operationalPlaylistRevisions.active,true))).get()
      if(!active)throw conflict('A edição original foi substituída; nenhuma publicação automática de rascunho será feita.')
      const payload={...plan.payload,schedule:view.schedule,operation:{...plan.payload.operation!,at:new Date().toISOString()}} as OperationalPayload
      const revision=persistRevision(tx,plan.context.rundownId,payload,actor,{kind:'OPERATIONAL_INSERT_COMMITTED',payload:{channelId:plan.context.channelId,requestId:plan.input.requestId,mode:plan.input.mode,itemId:plan.itemId,sourceRevisionId:plan.context.revisionId,nativeProgramConfirmed,physicalOutputValidated:false}})
      this.phase(plan.input.requestId,'CONFIRMED',{revisionId:revision.id,nativeProgramConfirmed})
      return revision
    },{behavior:'immediate'})
  }
}

import {and,eq} from 'drizzle-orm'
import {DEFAULT_FIT,DEFAULT_QC_PROFILE,assessQc,msToFrames,qcApproved,resolveAudio,resolveTrim,type RundownItem} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,mediaAssets,operationalPlaylistRevisions,operatorDecisions} from '../db/schema.js'
import {toAsset,toChannel} from '../db/repo.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {installationVault} from './secret-vault.js'
import {applyQcDecisionsNow} from './qc-workflow.js'
import {readOperationalPayload,persistRevision,type OperationalPayload} from './operational-playlist.js'
import {assertOperationalCadence} from './operational-cadence.js'
import {assertPublishedAudio} from './audio-bus.js'
import {buildView,toPlanItem} from './plan.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {listCutMarks} from './cut-marks.js'
import type {CompensationContext} from './operational-compensation.js'

/** Alinhamento de horário até um item em foco, aplicado direto no plano
 * publicado (como compensação e inserção): o operador acerta o horário sem
 * republicar a grade editável. Tudo numa revisão só, conferida por token.
 * INSERT: VTs aprovados entram logo antes do item em foco (opcionais, para
 *   poderem sair de novo).
 * DROP: item opcional futuro sai.
 * CUT: aplica uma marcação de corte de início/fim feita no QC num VT futuro. */
export type AlignmentAction = {kind:'INSERT';mediaId:string} | {kind:'DROP';itemId:string} | {kind:'CUT';itemId:string;markId:string}
export interface AlignmentInput {focusItemId:string;actions:AlignmentAction[]}
export interface AlignmentReview {
  reviewToken:string;sourceRevisionId:string;focusItemId:string;focusTitle:string
  beforeStart:number|null;afterStart:number|null;deltaFrames:number;conflicts:number
  /** Fim do item anterior ao foco (chegada natural); com horário fixo é a folga que muda. */
  beforeArrival:number|null;afterArrival:number|null;arrivalDeltaFrames:number
  lines:Array<{kind:AlignmentAction['kind'];title:string;frames:number}>
}

const fail=(message:string):never=>{throw new CollaborativeEditError(409,{error:message})}
const MIN_REMAINING_MS=1000

export function inspectAlignment(db:Db,context:CompensationContext,input:AlignmentInput,actor:string|null,requestId='review'){
  return db.transaction(tx=>{
    const raw=tx.select().from(channels).where(eq(channels.id,context.channelId)).get()
    const revision=tx.select().from(operationalPlaylistRevisions).where(and(eq(operationalPlaylistRevisions.id,context.revisionId),eq(operationalPlaylistRevisions.active,true))).get()
    if(!raw||raw.archivedAt||!revision||revision.rundownId!==context.rundownId)fail('A revisão publicada mudou. Confira novamente.')
    if(!input.actions.length||input.actions.length>12)fail('Escolha de 1 a 12 ajustes por alinhamento.')
    const channel=toChannel(raw!),old=readOperationalPayload(revision!.payload)
    if(old.rundown.channelId!==context.channelId)fail('Revisão de outro canal.')
    assertOperationalCadence(tx,channel,old)
    const current=context.onAirItemId?old.items.findIndex(item=>item.id===context.onAirItemId):-1
    if(context.onAirItemId&&current<0)fail('O PGM não pertence à revisão em execução. Confira antes de alinhar.')
    const focusIndex=old.items.findIndex(item=>item.id===input.focusItemId)
    if(focusIndex<0)fail('O item em foco não está na playlist no ar.')
    if(focusIndex<=current)fail('O item em foco já entrou no ar.')
    const future=(itemId:string)=>{
      const index=old.items.findIndex(item=>item.id===itemId)
      if(index<0)fail('Um dos itens escolhidos não está mais na playlist no ar.')
      if(index<=current)fail('Só dá para mexer em itens que ainda não entraram no ar.')
      if(index>focusIndex)fail('Só dá para mexer em itens antes do item em foco.')
      if(context.preview?.kind==='ITEM'&&context.preview.id===itemId)fail('Um dos itens está no CUE. Limpe o CUE antes de alinhar.')
      return old.items[index]!
    }
    const assets=new Map((old.assets??[]).map(asset=>[asset.id,asset]))
    const dropped=new Set<string>(),replaced=new Map<string,RundownItem>(),inserted:RundownItem[]=[],lines:AlignmentReview['lines']=[]
    const marks=new Map(listCutMarks(db,[...new Set(old.items.map(item=>item.mediaId).filter((id):id is string=>Boolean(id)))]).map(mark=>[mark.id,mark]))
    for(const [n,action] of input.actions.entries()){
      if(action.kind==='INSERT'){
        const rawAsset=tx.select().from(mediaAssets).where(eq(mediaAssets.id,action.mediaId)).get()
        if(!rawAsset||rawAsset.kind!=='VIDEO'||!/^[a-f0-9]{64}$/i.test(rawAsset.contentHash))fail('Selecione um vídeo com versão válida.')
        const pinned=assets.get(rawAsset!.id)
        if(pinned&&pinned.contentHash!==rawAsset!.contentHash)fail(`"${rawAsset!.title}" está na grade em outra versão; publique a grade antes de usá-lo no alinhamento.`)
        if(!pinned)assets.set(rawAsset!.id,toAsset(rawAsset!))
        const selected=toAsset(rawAsset!)
        inserted.push({id:`align:${requestId}:${n}`,rundownId:old.rundown.id,order:0,type:'VT',eventType:'SEQUENTIAL',title:selected.title,mediaId:selected.id,sourceRef:null,trim:resolveTrim(null,selected,channel.rate).value,audio:resolveAudio(null,selected,0).value,audioTrack:0,notes:'Inserido por alinhamento de horário',durationOverride:null,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',elastic:null,blockId:null,fit:DEFAULT_FIT,autoNext:true,loop:false,locked:false,protected:false,trimmable:false,optional:true,timingFlags:{protected:false,trimmable:false,optional:true}} as RundownItem)
        continue
      }
      const target=future(action.itemId)
      if(action.itemId===input.focusItemId)fail('O item em foco não pode ser retirado nem cortado pelo alinhamento.')
      if(dropped.has(target.id)||replaced.has(target.id))fail('O mesmo item aparece em dois ajustes.')
      const asset=target.mediaId?assets.get(target.mediaId):undefined
      const plan=toPlanItem(target,asset,channel.rate)
      if(target.locked||target.protected||target.timingFlags?.protected)fail(`"${target.title}" é obrigatório (travado/protegido).`)
      if(action.kind==='DROP'){
        if(!plan.timingFlags?.optional||target.anchor.kind==='FIXED'||target.anchor.kind==='HARD_TIME')fail(`"${target.title}" não é opcional; só itens opcionais sem horário obrigatório saem no alinhamento.`)
        dropped.add(target.id)
        continue
      }
      const mark=marks.get(action.markId)
      if(!mark||mark.assetId!==target.mediaId||!asset||mark.contentHash!==asset.contentHash)fail(`A marcação de corte não pertence à versão de "${target.title}" no ar.`)
      if(mark!.kind==='MIDDLE')fail('Corte no meio do VT ainda não é suportado pelo motor; use marcações de início ou fim.')
      if(target.type==='LIVE'||target.sourceRef||target.liveEndpoint)fail('Corte só vale para VT.')
      const trim=resolveTrim(target.trim,asset!,channel.rate).value
      const next=mark!.kind==='TAIL'?{in:trim.in,out:Math.min(trim.out,msToFrames(mark!.fromMs,channel.rate))}:{in:Math.max(trim.in,msToFrames(mark!.toMs,channel.rate)),out:trim.out}
      if(next.out-next.in<msToFrames(MIN_REMAINING_MS,channel.rate))fail(`O corte deixaria "${target.title}" sem conteúdo.`)
      if(next.in===trim.in&&next.out===trim.out)fail(`"${target.title}" já está cortado neste ponto.`)
      replaced.set(target.id,{...target,trim:next,durationOverride:next.out-next.in})
    }
    const kept=old.items.filter(item=>!dropped.has(item.id)).map(item=>replaced.get(item.id)??item)
    const at=kept.findIndex(item=>item.id===input.focusItemId)
    const items=[...kept.slice(0,at),...inserted,...kept.slice(at)].map((item,order)=>({...item,order}))
    const approved=applyQcDecisionsNow(tx,assets,channel.id)
    for(const item of inserted){
      const asset=approved.get(item.mediaId!)
      if(!asset||asset.ignored||asset.probeError||!qcApproved(asset.qcStatus??'PENDING')||!assessQc(asset,channel.qcProfile??DEFAULT_QC_PROFILE).playable)fail(`"${item.title}" não está aprovado no QC deste canal.`)
    }
    assertPublishedAudio(channel.audioChannels??2,items,[...approved.values()])
    const before=buildView(old.rundown,channel,old.items,approved,null,context.onAir)
    const view=buildView(old.rundown,channel,items,approved,null,context.onAir)
    const changed=new Set([...dropped,...replaced.keys(),...inserted.map(item=>item.id)])
    if(view.schedule.protections?.some(row=>changed.has(row.itemId)&&row.status==='OVERRIDDEN'))fail('O ajuste invadiria uma zona protegida.')
    for(const item of inserted){if(view.schedule.items.find(row=>row.id===item.id)?.state==='DROPPED')fail(`"${item.title}" não cabe na grade (seria descartado pelo agendador).`)}
    const startOf=(schedule:typeof view.schedule)=>schedule.items.find(row=>row.id===input.focusItemId)?.start??null
    const beforeStart=startOf(before.schedule),afterStart=startOf(view.schedule)
    const arrivalOf=(schedule:typeof view.schedule)=>{const rows=[...schedule.items].filter(row=>row.state!=='DROPPED').sort((a,b)=>a.order-b.order),index=rows.findIndex(row=>row.id===input.focusItemId);return index>0?rows[index-1]!.end:null}
    const beforeArrival=arrivalOf(before.schedule),afterArrival=arrivalOf(view.schedule)
    for(const id of dropped){const item=old.items.find(entry=>entry.id===id)!;lines.push({kind:'DROP',title:item.title,frames:-(before.schedule.items.find(row=>row.id===id)?.duration??0)})}
    for(const [id,item] of replaced){lines.push({kind:'CUT',title:item.title,frames:(view.schedule.items.find(row=>row.id===id)?.duration??0)-(before.schedule.items.find(row=>row.id===id)?.duration??0)})}
    for(const item of inserted)lines.push({kind:'INSERT',title:item.title,frames:view.schedule.items.find(row=>row.id===item.id)?.duration??0})
    const payload:OperationalPayload={...old,items,assets:[...approved.values()],schedule:view.schedule,operation:{kind:'ALIGNMENT',focusItemId:input.focusItemId,actions:input.actions,sourceRevisionId:revision!.id,at:''}}
    const {onAir,...stableContext}=context
    const reviewToken=installationVault().reviewIdentity(JSON.stringify({stableContext,input,actor,revision:revision!.id,configurationRevision:configurationRevision(tx,channel.id),marks:[...marks.values()].map(mark=>[mark.id,mark.contentHash])}),'operational-alignment:v1')
    const review:AlignmentReview={reviewToken,sourceRevisionId:revision!.id,focusItemId:input.focusItemId,focusTitle:old.items[focusIndex]!.title,beforeStart,afterStart,deltaFrames:beforeStart!==null&&afterStart!==null?afterStart-beforeStart:0,conflicts:view.schedule.conflicts.length,beforeArrival,afterArrival,arrivalDeltaFrames:beforeArrival!==null&&afterArrival!==null?afterArrival-beforeArrival:0,lines}
    return {payload,review}
  })
}

export function commitAlignment(db:Db,context:CompensationContext,input:AlignmentInput,requestId:string,token:string,actor:string|null,authorize:()=>void){
  return db.transaction(tx=>{
    authorize()
    const id=`operational-alignment:${requestId}`
    const duplicate=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,id)).get()
    if(duplicate){if(duplicate.kind!=='OPERATIONAL_ALIGNMENT'||duplicate.payload.token!==token)fail('Identificador pertence a outro alinhamento.');return {revision:duplicate.payload.revision as number,deduplicated:true}}
    // O token não depende do requestId (que só nomeia os itens inseridos).
    const plan=inspectAlignment(db,context,input,actor,requestId)
    if(plan.review.reviewToken!==token)fail('PGM, CUE, revisão, QC ou marcações mudaram. Confira novamente; nada foi alterado.')
    const revision=persistRevision(tx,context.rundownId,{...plan.payload,operation:{...plan.payload.operation as Extract<NonNullable<OperationalPayload['operation']>,{kind:'ALIGNMENT'}>,at:new Date().toISOString()}},actor)
    tx.insert(operatorDecisions).values({id,rundownId:context.rundownId,itemId:input.focusItemId,kind:'OPERATIONAL_ALIGNMENT',actorUsername:actor,createdAt:new Date().toISOString(),payload:{token,input,sourceRevisionId:context.revisionId,revision:revision.revision,deltaFrames:plan.review.deltaFrames,channelId:context.channelId}}).run()
    return {revision:revision.revision,deduplicated:false,deltaFrames:plan.review.deltaFrames}
  },{behavior:'immediate'})
}

import {and,eq} from 'drizzle-orm'
import {itemDuration,buildView,toPlanItem} from './plan.js'
import {readOperationalPayload,persistRevision,type OperationalPayload} from './operational-playlist.js'
import {channels,rundowns,operationalPlaylistRevisions,operatorDecisions} from '../db/schema.js'
import {configurationRevision} from '../db/channel-configuration.js'
import {toChannel} from '../db/repo.js'
import {installationVault} from './secret-vault.js'
import type {Db} from '../db/client.js'
import type {InsertionContext} from './operational-insertion.js'
import type {OperationalCompensationInput,OnAirState,PreviewTarget} from '@rplayout/protocol'
import {resolveTrim,durationIn} from '@rplayout/protocol'

export interface CompensationContext extends InsertionContext {onAir:OnAirState|null;preview:PreviewTarget|null}
const fail=(message:string):never=>{throw new Error(message)}
/** Read the historical commit only; no runtime refresh, retry or TAKE. */
export function compensationReceipt(db:Db,channelId:string,requestId:string,actor:string|null){
  const missing={state:'NOT_RECORDED' as const,requestId,currentExecutionObserved:false as const}
  const row=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,`operational-compensation:${requestId}`)).get()
  if(!row||row.kind!=='OPERATIONAL_COMPENSATION'||row.actorUsername!==actor)return missing
  const rundown=db.select().from(rundowns).where(eq(rundowns.id,row.rundownId)).get()
  if(!rundown||rundown.channelId!==channelId)return missing
  const revision=row.payload.revision
  if(!Number.isSafeInteger(revision)||Number(revision)<1)fail('Recibo de compensação inválido; nenhum ajuste será repetido.')
  return {state:'RECORDED' as const,requestId,revision:Number(revision),recordedAt:row.createdAt,currentExecutionObserved:false as const}
}
/** Changes only frozen future items. Existing scheduler remains timing authority. */
export function inspectCompensation(db:Db,context:CompensationContext,input:OperationalCompensationInput,actor:string|null){
  return db.transaction(tx=>{
    const raw=tx.select().from(channels).where(eq(channels.id,context.channelId)).get()
    const revision=tx.select().from(operationalPlaylistRevisions).where(and(eq(operationalPlaylistRevisions.id,context.revisionId),eq(operationalPlaylistRevisions.active,true))).get()
    if(!raw||raw.archivedAt||!revision||revision.rundownId!==context.rundownId)fail('A revisão publicada mudou. Confira novamente.')
    const channel=toChannel(raw!),old=readOperationalPayload(revision!.payload),assets=new Map((old.assets??[]).map(asset=>[asset.id,asset]))
    if(old.rundown.channelId!==context.channelId||!context.onAir||context.onAir.itemId!==context.onAirItemId)fail('A ocorrência no ar não pertence à revisão deste canal.')
    const index=old.items.findIndex(item=>item.id===input.itemId),item=old.items[index]
    const current=context.onAirItemId?old.items.findIndex(item=>item.id===context.onAirItemId):-1
    if(!item||current<0||index<=current)fail('A compensação só pode alterar itens futuros da playlist no ar.')
    const target=item!,asset=target.mediaId?assets.get(target.mediaId):undefined
    if(context.preview?.kind==='ITEM'&&context.preview.id===target.id)fail('O item está no CUE. Limpe o CUE antes de alterar o corte/duração.')
    const before=buildView(old.rundown,channel,old.items,assets,null,context.onAir)
    const nominal=buildView(old.rundown,channel,old.items,assets,null,null)
    const protectedIn=(view:typeof before)=>view.schedule.protections?.some(row=>row.itemId===target.id)
    if(target.locked||target.protected||target.timingFlags?.protected||protectedIn(before)||protectedIn(nominal))fail('Item obrigatório ou dentro de zona protegida: compensação recusada.')
    const duration=itemDuration(target,asset,channel.rate),plan=toPlanItem(target,asset,channel.rate)
    if(duration!==input.expectedFrames)fail('A duração exibida mudou. Confira novamente.')
    if(!Number.isSafeInteger(input.deltaFrames)||Math.abs(input.deltaFrames)>Math.ceil(600*channel.rate.num/channel.rate.den))fail('Ajuste inválido ou superior a dez minutos.')
    let replacement={...target},afterFrames=duration
    if(input.action==='DROP_OPTIONAL'){
      if(!plan.timingFlags?.optional||input.deltaFrames!==0||target.anchor.kind==='FIXED'||target.anchor.kind==='HARD_TIME')fail('Somente um item opcional sem horário obrigatório pode ser removido.')
      afterFrames=0
    }else if(input.action==='ACCEPT_DELAY'){
      if(input.deltaFrames<=0||!['SOFT','WINDOW'].includes(target.anchor.kind))fail('Aceitar atraso exige horário flexível. FIXED/HARD_TIME nunca são deslocados.')
      replacement.anchor=target.anchor.kind==='SOFT'?{...target.anchor,at:target.anchor.at+input.deltaFrames}:target.anchor.kind==='WINDOW'?{...target.anchor,from:target.anchor.from+input.deltaFrames,to:target.anchor.to+input.deltaFrames}:target.anchor
    }else{
      afterFrames=duration+input.deltaFrames
      if(afterFrames<=0||input.deltaFrames===0)fail('A duração deve permanecer positiva; use remover opcional quando permitido.')
      if(input.action==='FILLER'){
        if(!plan.isFiller||!target.elastic||afterFrames<Math.max(target.elastic.min,target.minDuration)||afterFrames>target.elastic.max)fail('Filler exige limites elásticos; ajuste fora do mínimo/máximo.')
        if(!asset||target.loop)fail('Escolha filler com arquivo de duração finita; loop contínuo exige outra política de saída.')
        const trim=resolveTrim(target.trim,asset!,channel.rate).value
        if(trim.in+afterFrames>durationIn(asset!,channel.rate))fail('O arquivo não contém quadros suficientes. Insira outro vídeo/filler para preencher o restante.')
        replacement={...replacement,durationOverride:afterFrames,trim:{in:trim.in,out:trim.in+afterFrames}}
      }else{
        if(!plan.timingFlags?.trimmable||input.deltaFrames>=0||!asset||target.type==='LIVE'||target.sourceRef||target.liveEndpoint)fail('Reduzir exige VT com corte permitido; não altera entrada ao vivo.')
        const minimum=target.minDuration>0?target.minDuration:Math.ceil(duration*0.7)
        if(afterFrames<minimum)fail('Corte abaixo da duração mínima permitida.')
        const trim=resolveTrim(target.trim,asset!,channel.rate).value
        if(afterFrames>trim.out-trim.in)fail('Duração excede o trecho disponível.')
        replacement={...replacement,trim:{in:trim.in,out:trim.in+afterFrames},durationOverride:afterFrames,minDuration:minimum}
      }
    }
    const items=(input.action==='DROP_OPTIONAL'?old.items.filter(item=>item.id!==target.id):old.items.map(item=>item.id===target.id?replacement:item)).map((item,order)=>({...item,order}))
    const graphics=old.graphics?{...old.graphics,cues:old.graphics.cues.filter(cue=>input.action!=='DROP_OPTIONAL'||cue.itemId!==target.id)}:undefined
    const secondaryEvents=old.secondaryEvents?.filter(event=>input.action!=='DROP_OPTIONAL'||event.rundownItemId!==target.id)
    const view=buildView(old.rundown,channel,items,assets,null,context.onAir)
    if(view.schedule.protections?.some(row=>row.itemId===target.id))fail('O ajuste levaria o item para uma zona protegida.')
    const payload:OperationalPayload={...old,items,graphics,secondaryEvents,schedule:view.schedule,operation:{kind:'COMPENSATION',action:input.action,itemId:target.id,deltaFrames:input.deltaFrames,sourceRevisionId:revision!.id,at:''}}
    // Elapsed advances during a human review, but occurrence/PGM/CUE cannot change.
    const {onAir,...stableContext}=context
    const reviewToken=installationVault().reviewIdentity(JSON.stringify({stableContext,input,actor,revision,configurationRevision:configurationRevision(tx,channel.id)}),'operational-compensation:v1')
    const beforeEffectiveFrames=before.schedule.items.find(row=>row.id===target.id)?.duration??0
    const afterEffectiveFrames=view.schedule.items.find(row=>row.id===target.id)?.duration??0
    const anchorChange=input.action==='ACCEPT_DELAY'?{before:target.anchor,after:replacement.anchor}:null
    return {payload,review:{input,reviewToken,sourceRevisionId:revision!.id,title:target.title,beforeFrames:duration,afterFrames,beforeEffectiveFrames,afterEffectiveFrames,anchorChange,conflicts:view.schedule.conflicts,notice:'Altera somente a playlist publicada; não publica rascunhos nem executa TAKE. Duração executável inclui os ajustes automáticos do timing e acompanha o tempo real.'}}
  })
}
export function commitCompensation(db:Db,context:CompensationContext,input:OperationalCompensationInput,requestId:string,token:string,actor:string|null,authorize:()=>void){
  return db.transaction(tx=>{
    authorize()
    const id=`operational-compensation:${requestId}`,digest=installationVault().reviewIdentity(JSON.stringify({channelId:context.channelId,input,token,actor}),'operational-compensation-request:v1')
    const duplicate=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,id)).get()
    if(duplicate){if(duplicate.kind!=='OPERATIONAL_COMPENSATION'||duplicate.payload.digest!==digest)fail('Identificador pertence a outra compensação.');return {revision:duplicate.payload.revision as number,deduplicated:true}}
    const plan=inspectCompensation(db,context,input,actor)
    if(plan.review.reviewToken!==token)fail('PGM, CUE, revisão ou configuração mudou. Confira novamente; nenhum ajuste aplicado.')
    const revision=persistRevision(tx,context.rundownId,{...plan.payload,operation:{...plan.payload.operation!,at:new Date().toISOString()}},actor)
    tx.insert(operatorDecisions).values({id,rundownId:context.rundownId,itemId:input.itemId,kind:'OPERATIONAL_COMPENSATION',actorUsername:actor,createdAt:new Date().toISOString(),payload:{digest,input,sourceRevisionId:context.revisionId,revision:revision.revision,revisionId:revision.id,beforeFrames:plan.review.beforeFrames,afterFrames:plan.review.afterFrames,beforeEffectiveFrames:plan.review.beforeEffectiveFrames,afterEffectiveFrames:plan.review.afterEffectiveFrames,anchorChange:plan.review.anchorChange,conflicts:plan.review.conflicts}}).run()
    return {revision:revision.revision,deduplicated:false}
  },{behavior:'immediate'})
}

import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {resolveTrim,resolveAudio,secondsToFrames,type Anchor,type Frames} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {operatorDecisions,rundownItems} from '../db/schema.js'
import {scheduleRuleRevision} from '../db/schedule-rule-revisions.js'
import {readStoredScheduleRules} from './schedule-rule-edit.js'
import {readEditorialState,editorialView} from './editorial-state.js'
import {buildCandidatesNow,planFill} from './autofill.js'
import {installationVault} from './secret-vault.js'
import {CollaborativeEditError} from './collaborative-edit.js'

type State=NonNullable<ReturnType<typeof readEditorialState>>
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0]
export interface FillRequest {
  minutes:number;categories?:string[];avoidHours?:number
  insertAtMinute?:number;insertAfterItemId?:string;insertAtOrder?:number
}
type Entry=Pick<typeof rundownItems.$inferInsert,'id'|'mediaId'|'title'|'trim'|'audio'|'minDuration'|'anchor'>
interface Proposal {
  version:1;kind:'WINDOW'|'DAY';channelId:string;editorialRevision:number;expiresAt:string
  dependency:string;entries:Entry[];ordered:string[];result:Record<string,unknown>
}
function rulesFor(tx:Tx,state:State){
  const weekday=String(new Date(`${state.rundown.date}T12:00:00`).getDay())
  return readStoredScheduleRules(tx,state.channel.id).filter(rule=>rule.weekdays.includes(weekday))
}
function dependency(tx:Tx,state:State,entries:Entry[],kind:Proposal['kind']){
  const ids=[...new Set(entries.map(entry=>entry.mediaId!))].sort()
  const candidates=new Map(buildCandidatesNow(tx,state.channel,[...state.assets.values()]).map(item=>[item.id,item]))
  return installationVault().reviewIdentity(JSON.stringify({channel:state.channel,assets:ids.map(id=>state.assets.get(id)??null),
    candidates:ids.map(id=>candidates.get(id)??null),rules:kind==='DAY'?rulesFor(tx,state):null,
    ...(kind==='DAY'?{rulesRevision:scheduleRuleRevision(tx,state.channel.id)}:{})}),'autofill-dependencies:v1')
}
function insertIndex(state:State,minute:number){
  const at=secondsToFrames(minute*60,state.channel.rate),index=editorialView(state).schedule.items.findIndex(item=>item.start>=at)
  return index<0?state.items.length:index
}
/** Immutable encrypted event-backed proposals share the audit store and survive
 * server restarts. No grade rows or transport commands are changed by review. */
export function proposeFill(tx:Tx,state:State,kind:Proposal['kind'],request:FillRequest|undefined,actor:string|null){
  const candidates=buildCandidatesNow(tx,state.channel,[...state.assets.values()]),entries:Entry[]=[],ordered=state.items.map(item=>item.id)
  const chosen:Record<string,unknown>[]=[]
  const bands:{rule:string;items:number;leftover:number}[]=[]
  const used=new Set<string>()
  const add=(minutes:number,categories:string[],avoidHours:number,index:number,startMinute?:number)=>{
    const available=kind==='DAY'&&avoidHours>0?candidates.filter(item=>!used.has(item.id)):candidates
    const plan=planFill(available,state.channel,secondsToFrames(minutes*60,state.channel.rate),categories,avoidHours*60)
    const selections=plan.items.map((item,i)=>{
      const asset=state.assets.get(item.id)!
      const anchor:Anchor=i===0&&startMinute!==undefined?{kind:'FIXED',at:secondsToFrames(startMinute*60,state.channel.rate)}:{kind:'FLOW'}
      const entry:Entry={id:randomUUID(),mediaId:asset.id,title:asset.title,trim:resolveTrim(null,asset,state.channel.rate).value,
        audio:resolveAudio(null,asset).value,minDuration:item.durationFrames,anchor}
      entries.push(entry);ordered.splice(index+i,0,entry.id);used.add(item.id)
      return {mediaId:asset.id,title:asset.title,durationFrames:item.durationFrames,trim:entry.trim,anchor,
        explanation:{category:item.categoryId,lastAiredAt:item.lastAiredMs===null?null:new Date(item.lastAiredMs).toISOString(),preference:item.preference}}
    })
    chosen.push(...selections)
    return {...plan,items:selections}
  }
  let result:Record<string,unknown>
  if(kind==='WINDOW'){
    if(!request)throw new CollaborativeEditError(400,{error:'Informe a janela de preenchimento.'})
    let index=state.items.length
    if(request.insertAfterItemId){
      const found=state.items.findIndex(item=>item.id===request.insertAfterItemId)
      if(found<0)throw new CollaborativeEditError(409,{error:'O item de inserção não pertence a esta grade. Revise o destino.'})
      index=found+1
    }else if(request.insertAtMinute!==undefined)index=insertIndex(state,request.insertAtMinute)
    else if(request.insertAtOrder!==undefined){const found=state.items.findIndex(item=>item.order>=request.insertAtOrder!);if(found>=0)index=found}
    result={plan:add(request.minutes,request.categories??[],request.avoidHours??0,index,request.insertAtMinute)}
  }else{
    const rules=rulesFor(tx,state)
    if(!rules.length)throw new CollaborativeEditError(400,{error:'Nenhuma faixa da pauta vale para este dia.'})
    for(const rule of rules){
      const base=insertIndex(state,rule.startMinute)
      const before=base===state.items.length?ordered.length:ordered.indexOf(state.items[base]!.id)
      const plan=add(rule.endMinute-rule.startMinute,rule.categories,rule.avoidHours,before,rule.startMinute)
      bands.push({rule:rule.name,items:plan.items.length,leftover:plan.leftover})
    }
    result={bands,plan:{window:rules.reduce((n,rule)=>n+secondsToFrames((rule.endMinute-rule.startMinute)*60,state.channel.rate),0),
      leftover:bands.reduce((n,band)=>n+band.leftover,0),reason:bands.every(band=>band.leftover===0)?'FILLED':'OUT_OF_MATERIAL',items:chosen}}
  }
  const id=randomUUID(),now=new Date().toISOString(),expiresAt=new Date(Date.now()+30*60_000).toISOString()
  const payload:Proposal={version:1,kind,channelId:state.channel.id,editorialRevision:state.editorialRevision,expiresAt,
    dependency:dependency(tx,state,entries,kind),entries,ordered,result}
  tx.insert(operatorDecisions).values({id,rundownId:state.rundown.id,kind:'AUTOFILL_PROPOSED',payload:payload as unknown as Record<string,unknown>,actorUsername:actor,createdAt:now}).run()
  return {...result,proposal:{id,rundownId:state.rundown.id,channelId:state.channel.id,editorialRevision:state.editorialRevision,expiresAt,kind}}
}
/** Caller owns the IMMEDIATE transaction, revision/access guards and history.
 * Applies stored rows only; never invokes the selection algorithm at commit. */
export function applyFillProposal(tx:Tx,state:State,id:string|undefined,kind:Proposal['kind'],actor:string|null){
  if(!id)throw new CollaborativeEditError(428,{error:'Confira uma proposta antes de aplicar. Nenhum item foi inserido.'})
  const row=tx.select().from(operatorDecisions).where(eq(operatorDecisions.id,id)).get()
  if(!row || row.kind!=='AUTOFILL_PROPOSED' || row.rundownId!==state.rundown.id || row.actorUsername!==actor)
    throw new CollaborativeEditError(409,{error:'Proposta não pertence a esta grade ou sessão. Confira uma nova proposta.'})
  const proposal=row.payload as unknown as Proposal
  if(proposal.version!==1 || proposal.kind!==kind || proposal.channelId!==state.channel.id || proposal.editorialRevision!==state.editorialRevision)
    throw new CollaborativeEditError(409,{error:'A grade ou o destino mudou desde a proposta. Confira novamente antes de aplicar.'})
  if(Date.parse(proposal.expiresAt)<=Date.now())throw new CollaborativeEditError(409,{error:'A conferência expirou após 30 minutos. Proponha novamente; os campos foram preservados.'})
  if(tx.select({id:operatorDecisions.id}).from(operatorDecisions).where(eq(operatorDecisions.id,`${id}:applied`)).get())
    throw new CollaborativeEditError(409,{error:'Esta proposta já foi aplicada. Não será inserida novamente.'})
  if(dependency(tx,state,proposal.entries,kind)!==proposal.dependency)
    throw new CollaborativeEditError(409,{error:'Mídia, QC, configuração, histórico de exibição ou pauta mudou desde a proposta. Confira uma nova proposta; nada foi inserido.'})
  if(!proposal.entries.length)throw new CollaborativeEditError(409,{error:'A proposta está vazia. Nenhum item foi inserido.'})
  const now=new Date().toISOString()
  for(const entry of proposal.entries){
    tx.insert(rundownItems).values({...entry,rundownId:state.rundown.id,sortOrder:0,type:'VT',sourceRef:null,durationOverride:null,
      onOverrun:'PUSH',elastic:null,locked:false,autoNext:true,loop:false,notes:null}).run()
    tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:state.rundown.id,itemId:entry.id,kind:'AUTO_FILLED',
      payload:{mediaId:entry.mediaId,proposalId:id},actorUsername:actor,createdAt:now}).run()
  }
  for(const [i,itemId] of proposal.ordered.entries())tx.update(rundownItems).set({sortOrder:(i+1)*10}).where(eq(rundownItems.id,itemId)).run()
  tx.insert(operatorDecisions).values({id:`${id}:applied`,rundownId:state.rundown.id,kind:'AUTOFILL_APPLIED',
    payload:{proposalId:id,items:proposal.entries.length,editorialOnly:true,requiresPublication:true},actorUsername:actor,createdAt:now}).run()
  return {...proposal.result,proposal:{id,editorialRevision:proposal.editorialRevision,consumed:true}}
}

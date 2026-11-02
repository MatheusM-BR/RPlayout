import {randomUUID} from 'node:crypto'
import {asc,eq} from 'drizzle-orm'
import {scheduleRuleETag,type ScheduleRuleReview} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,scheduleRules} from '../db/schema.js'
import {scheduleRuleRevision} from '../db/schedule-rule-revisions.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {createScheduleRule,updateScheduleRule,validScheduleRule} from './schedule-rule-schema.js'
import {conflictsWithScheduleRule} from './schedule-rules.js'
type Reader=Pick<Db,'select'>
type Transaction=Parameters<Parameters<Db['transaction']>[0]>[0]
export interface ScheduleRuleHooks {authorize:(tx:Reader,channelId:string)=>void;audit:(tx:Transaction,details:Record<string,unknown>)=>void}
function reject(status:number,error:string):never{throw new CollaborativeEditError(status,{error})}
function channel(tx:Reader,id:string,write:boolean){
  const row=tx.select().from(channels).where(eq(channels.id,id)).get()
  if(!row)reject(404,'Canal não encontrado.')
  if(write&&row.archivedAt)reject(409,'Canal arquivado: faixas não alteradas.')
}
export function readStoredScheduleRules(tx:Reader,id:string){
  const rows=tx.select().from(scheduleRules).where(eq(scheduleRules.channelId,id)).orderBy(asc(scheduleRules.startMinute),asc(scheduleRules.id)).all()
  if(rows.some(row=>!validScheduleRule.safeParse(row).success))reject(409,'Há uma faixa salva inválida. Corrija o legado explicitamente; nenhum dado foi normalizado.')
  // Existing overlap is explicit, never resolved by silently dropping a band.
  if(rows.some(row=>conflictsWithScheduleRule(row,rows,row.id)))reject(409,'Há faixas salvas sobrepostas. Corrija o legado explicitamente antes de conferir a pauta.')
  return rows
}
export function readScheduleRuleReview(db:Db,id:string,authorize:ScheduleRuleHooks['authorize']):ScheduleRuleReview{
  return db.transaction(tx=>{
    authorize(tx,id);channel(tx,id,false)
    return {channelId:id,revision:scheduleRuleRevision(tx,id),rules:readStoredScheduleRules(tx,id),editorialOnly:true,automaticTake:false}
  })
}
export function requireScheduleRuleRevision(header:unknown,id:string,current:number){
  if(header===undefined)reject(428,'Confira as faixas antes de alterar. Revisão original obrigatória.')
  if(typeof header!=='string')reject(400,'Revisão de faixas inválida.')
  const match=/^"rules:([^:]+):([1-9]\d*)"$/.exec(header)
  let owner:string|undefined
  try{owner=match?decodeURIComponent(match[1]!):undefined}catch{}
  if(!match||owner!==id||!Number.isSafeInteger(Number(match[2])))reject(400,'Revisão não corresponde ao canal das faixas.')
  if(Number(match[2])!==current)reject(409,'Faixas ou canal mudaram desde a conferência. Reabra explicitamente; rascunho não aplicado.')
}
export function editScheduleRule(db:Db,operation:'CREATE'|'UPDATE'|'DELETE',target:string,body:unknown,header:unknown,hooks:ScheduleRuleHooks){
  return db.transaction(tx=>{
    const parsed=operation==='CREATE'?createScheduleRule.safeParse(body):operation==='UPDATE'?updateScheduleRule.safeParse(body):null
    if(parsed&&!parsed.success)reject(400,'Faixa inválida. Confira dias únicos, horários, nome e categorias; nada foi gravado.')
    const existing=operation==='CREATE'?undefined:tx.select().from(scheduleRules).where(eq(scheduleRules.id,target)).get()
    if(operation!=='CREATE'&&!existing)reject(404,'Faixa não encontrada.')
    const id=existing?.channelId??target
    hooks.authorize(tx,id);channel(tx,id,true)
    const before=scheduleRuleRevision(tx,id);requireScheduleRuleRevision(header,id,before)
    let rule:typeof scheduleRules.$inferSelect|null=null
    if(operation==='DELETE')tx.delete(scheduleRules).where(eq(scheduleRules.id,target)).run()
    else{
      // Validate untouched legacy rows too: editing one band must not silently
      // certify the rest or discard an existing overlap.
      const rows=tx.select().from(scheduleRules).where(eq(scheduleRules.channelId,id)).all().filter(row=>row.id!==existing?.id)
      if(rows.some(row=>!validScheduleRule.safeParse(row).success))reject(409,'Há faixa legada inválida; nenhuma correção silenciosa foi aplicada.')
      const next=existing?{...existing,...parsed!.data}:{id:randomUUID(),channelId:id,...parsed!.data,createdAt:new Date().toISOString()}
      if(!validScheduleRule.safeParse(next).success)reject(400,'A faixa precisa terminar depois de começar.')
      rule=next as typeof scheduleRules.$inferSelect
      if(conflictsWithScheduleRule(rule,rows))reject(409,'Esta faixa se sobrepõe a outra faixa no mesmo dia.')
      if(existing)tx.update(scheduleRules).set(parsed!.data!).where(eq(scheduleRules.id,target)).run()
      else tx.insert(scheduleRules).values(rule).run()
    }
    const revision=scheduleRuleRevision(tx,id)
    hooks.audit(tx,{channelId:id,ruleId:rule?.id??target,operation,reviewedRevision:before,revision,changedFields:operation==='UPDATE'?Object.keys(parsed!.data!):[],editorialOnly:true,automaticTake:false})
    // Returning the complete list from this SAME commit avoids a separate GET
    // upgrading proof for a draft after a concurrent writer slipped in.
    const review={channelId:id,revision,rules:readStoredScheduleRules(tx,id),editorialOnly:true as const,automaticTake:false as const}
    return {...review,rule,applied:true as const,ok:true as const,eTag:scheduleRuleETag(id,revision)}
  },{behavior:'immediate'})
}

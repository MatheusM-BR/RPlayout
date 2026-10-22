import {secondsToFrames,type Rate} from '@rplayout/protocol'
import {score,type Candidate} from '@rplayout/scheduler'

export interface DayRule {id:string;name:string;weekdays:string;startMinute:number;endMinute:number;categories:string[];avoidHours:number}
export interface DayPlanRequest {date:string;weekday:number;midnightMs:number;rate:Rate;rules:DayRule[];candidates:Candidate[];maxItems:number}
export interface DayChoice {mediaId:string;start:number;duration:number;ruleId:string;firstInBand:boolean}
export interface DayPlan {items:DayChoice[];endsAt:number;bands:{ruleId:string;count:number;start:number;end:number}[]}
export function dayRules(rules:DayRule[],weekday:number):DayRule[]{
  if(!Number.isInteger(weekday)||weekday<0||weekday>6)throw new Error('Dia da semana inválido.')
  const selected=rules.filter(rule=>rule.weekdays.includes(String(weekday))).sort((a,b)=>a.startMinute-b.startMinute||a.id.localeCompare(b.id))
  let next=0
  for(const rule of selected){
    if(!/^[0-6]+$/.test(rule.weekdays)||!Number.isInteger(rule.startMinute)||!Number.isInteger(rule.endMinute)||rule.startMinute<0||rule.endMinute>1440||rule.endMinute<=rule.startMinute||!Number.isFinite(rule.avoidHours)||rule.avoidHours<0||rule.avoidHours>8760||!Array.isArray(rule.categories)||rule.categories.some(id=>typeof id!=='string'))throw new Error(`Faixa inválida: ${rule.name}.`)
    if(rule.startMinute!==next)throw new Error(`Pauta do dia ${weekday}: intervalo ou sobreposição antes de ${rule.name} (${next}–${rule.startMinute} min).`)
    next=rule.endMinute
  }
  if(next!==1440)throw new Error(`Pauta do dia ${weekday} cobre até ${next} min; complete as 24 horas antes de habilitar publicação automática.`)
  return selected
}
/** Exact, bounded and deterministic selection. No trim, filler, tolerance,
 * implicit QC, or transport command. Runs in the isolated planner process. */
export function planScheduleDay(request:DayPlanRequest):DayPlan{
  if(!Number.isFinite(request.midnightMs)||request.rate.num<=0||request.rate.den<=0||!Number.isSafeInteger(request.maxItems)||request.maxItems<1||request.maxItems>5000||request.candidates.length>10000)throw new Error('Limite/configuração de montagem inválido.')
  const rules=dayRules(request.rules,request.weekday)
  const candidates=request.candidates.filter(c=>Number.isSafeInteger(c.durationFrames)&&c.durationFrames>0&&Number.isFinite(c.preference)&&(c.lastAiredMs===null||Number.isFinite(c.lastAiredMs))).sort((a,b)=>a.id.localeCompare(b.id))
  if(new Set(candidates.map(c=>c.id)).size!==candidates.length)throw new Error('Acervo contém identificadores duplicados.')
  const last=new Map(candidates.map(c=>[c.id,c.lastAiredMs])),items:DayChoice[]=[],bands:DayPlan['bands']=[]
  for(const rule of rules){
    const start=secondsToFrames(rule.startMinute*60,request.rate),end=secondsToFrames(rule.endMinute*60,request.rate),allowed=candidates.filter(c=>!rule.categories.length||c.categoryId!==null&&rule.categories.includes(c.categoryId))
    const used=new Set<string>();let cursor=start,count=0
    while(cursor<end){
      if(items.length>=request.maxItems)throw new Error(`Limite de ${request.maxItems} itens atingido na faixa ${rule.name}; aumente a duração dos materiais.`)
      if(rule.avoidHours===0 && used.size===allowed.length)used.clear()
      const now=request.midnightMs+cursor*1000*request.rate.den/request.rate.num
      let chosen:Candidate|undefined,best=Number.NEGATIVE_INFINITY
      for(const candidate of allowed){
        if(rule.avoidHours===0 && used.has(candidate.id))continue
        const value=score({...candidate,lastAiredMs:last.get(candidate.id)??null},end-cursor,now,rule.avoidHours*3600000)
        if(value>best){chosen=candidate;best=value}
      }
      if(!chosen)throw new Error(`Faixa ${rule.name}: faltam ${end-cursor} quadros de material aprovado compatível, respeitando a repetição. Nenhum corte ou filler foi aplicado.`)
      items.push({mediaId:chosen.id,start:cursor,duration:chosen.durationFrames,ruleId:rule.id,firstInBand:count===0})
      used.add(chosen.id);last.set(chosen.id,now);cursor+=chosen.durationFrames;count++
    }
    bands.push({ruleId:rule.id,count,start,end})
  }
  return {items,bands,endsAt:secondsToFrames(86400,request.rate)}
}

import {describe,expect,it} from 'vitest'
import {dayRules,planScheduleDay,type DayPlanRequest} from './schedule-day.js'
const request=():DayPlanRequest=>({date:'2026-10-04',weekday:0,midnightMs:1e12,rate:{num:25,den:1},maxItems:2000,
  rules:[{id:'all',name:'Dia',weekdays:'0123456',startMinute:0,endMinute:1440,categories:[],avoidHours:0}],
  candidates:[{id:'vt',durationFrames:3600*25,categoryId:null,lastAiredMs:null,preference:0}]})
describe('montagem exata de pauta diária',()=>{
  it('preenche 24h sem folga e sem depender da ordem de acervo',()=>{
    const input=request(),plan=planScheduleDay(input)
    expect(plan.items).toHaveLength(24);expect(plan.endsAt).toBe(2160000)
    expect(plan.items.at(-1)!.start+plan.items.at(-1)!.duration).toBe(plan.endsAt)
    expect(plan.items.filter(i=>i.firstInBand)).toHaveLength(1)
  })
  it('recusa dia ausente, gap, sobreposição e faixa quebrada, sem preenchimento implícito',()=>{
    for(const rules of [[],[{...request().rules[0]!,startMinute:1}],[{...request().rules[0]!,endMinute:1439}],request().rules.concat(request().rules),[{...request().rules[0]!,endMinute:2000}]])expect(()=>dayRules(rules,0)).toThrow()
  })
  it('limita montagens patológicas e ignora duração zero/NaN',()=>{
    const input=request();input.maxItems=3;expect(()=>planScheduleDay(input)).toThrow('Limite de 3')
    input.maxItems=2000;input.candidates[0]={...input.candidates[0]!,durationFrames:0};expect(()=>planScheduleDay(input)).toThrow('faltam')
  })
  it('não corta material que não encaixa no tempo restante',()=>{
    const input=request();input.candidates[0]={...input.candidates[0]!,durationFrames:3601*25}
    expect(()=>planScheduleDay(input)).toThrow('Nenhum corte ou filler')
  })
  it('repetição considera horários planejados e volta após a janela, não só as-run',()=>{
    const input=request();input.rules[0]!.avoidHours=2
    input.candidates.push({...input.candidates[0]!,id:'vt2'})
    expect(planScheduleDay(input).items.map(i=>i.mediaId)).toEqual(Array.from({length:24},(_,i)=>i%2?'vt2':'vt'))
    input.rules[0]!.avoidHours=3;expect(()=>planScheduleDay(input)).toThrow('respeitando a repetição')
  })
  it('cadência fracionária usa limites absolutos, sem arredondar janela separadamente',()=>{
    const input=request();input.rate={num:30000,den:1001}
    input.rules=[{...input.rules[0]!,endMinute:1},{...input.rules[0]!,id:'rest',startMinute:1}]
    input.candidates=[{...input.candidates[0]!,id:'one',durationFrames:1798},{...input.candidates[0]!,id:'rest',durationFrames:2587613}]
    const plan=planScheduleDay(input)
    expect(plan.items).toHaveLength(2);expect(plan.items[1]!.start).toBe(1798)
    expect(plan.endsAt).toBe(2589411)
  })
})

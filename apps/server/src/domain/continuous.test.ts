import { describe, expect, it } from 'vitest'
import { activeHorizonRule, executionHorizon, horizonWarning, shouldFillHorizon } from './continuous.js'
import type { RundownView } from './plan.js'

const fps = 25, now = new Date(2026,9,1,0,1,0)
function view(): RundownView {
  return { channel:{rate:{num:fps,den:1}},rundown:{id:'grade',date:'2026-09-30',loop:false},
    items:[{item:{id:'pgm',type:'VT',autoNext:true,loop:false}}],
    schedule:{endsAt:(24*3600+5*60)*fps,items:[{id:'pgm',start:23*3600*fps,state:'ON_AIR',duration:6*3600*fps}],conflicts:[]} } as unknown as RundownView
}

describe('preenchimento contínuo', () => {
  it('só sinaliza quando a grade está no horizonte', () => {
    expect(shouldFillHorizon(600, 604)).toBe(true)
    expect(shouldFillHorizon(600, 606)).toBe(false)
  })
  it('seleciona a faixa do dia e horário atuais', () => {
    const rules = [{ weekdays: '01234', startMinute: 360, endMinute: 720 }, { weekdays: '56', startMinute: 720, endMinute: 1080 }]
    expect(activeHorizonRule(rules, 500, 2)).toEqual(rules[0])
    expect(activeHorizonRule(rules, 500, 6)).toBeNull()
    expect(activeHorizonRule(rules, 800, 6)).toEqual(rules[1])
  })
  it('conta 4min, não 24h04, na grade de ontem que ainda está em execução', () => {
    const status=executionHorizon(view(),{itemId:'pgm'},'published-1',now)
    expect(status).toMatchObject({mode:'FINITE',source:'PUBLISHED',minutesRemaining:4,coverageReady:false,rundownDate:'2026-09-30',automaticHandover:false})
    expect(horizonWarning(status,true,5*60*fps)?.rundownId).toBe('grade')
    expect(horizonWarning(status,false,5*60*fps)).toBeNull()
  })
  it('não transforma loop, espera por TAKE ou live aberto em cobertura finita/48h', () => {
    for(const [override,expected] of [[{loop:true},'LOOP'],[{autoNext:false},'MANUAL_HOLD'],[{type:'LIVE',liveAutoFollowOnEnd:false},'OPEN_LIVE']] as const){
      const grade=view();Object.assign(grade.items[0]!.item,override)
      const status=executionHorizon(grade,{itemId:'pgm'},'revision',now)
      expect(status.mode).toBe(expected);expect(status.minutesRemaining).toBeNull();expect(status.coverageReady).toBe(false)
      expect(horizonWarning(status,true,5*60*fps)).toBeNull()
    }
  })
  it('publicação é necessária; estimativa live e gap não recebem garantia verde de 48h', () => {
    const grade=view();Object.assign(grade.schedule,{endsAt:(24*3600+60+49*3600)*fps})
    expect(executionHorizon(grade,{itemId:'pgm'},'revision',now).coverageReady).toBe(true)
    expect(executionHorizon(grade,{itemId:'pgm'},null,now).coverageReady).toBe(false)
    Object.assign(grade.items[0]!.item,{type:'LIVE',liveEstimatedDuration:49*3600*fps,liveAutoFollowOnEnd:true})
    expect(executionHorizon(grade,{itemId:'pgm'},'revision',now)).toMatchObject({mode:'FINITE',coverageReady:false})
    Object.assign(grade.items[0]!.item,{type:'VT'});Object.assign(grade.schedule,{conflicts:[{kind:'GAP',severity:'WARN'}]})
    expect(executionHorizon(grade,{itemId:'pgm'},'revision',now).coverageReady).toBe(false)
  })
  it('não conta grade futura nem PGM alheio à revisão como cobertura disponível', () => {
    const grade=view();Object.assign(grade.rundown,{date:'2026-10-02'})
    expect(executionHorizon(grade,null,'revision',now)).toMatchObject({mode:'WAITING_START',coverageMinutes:null,coverageReady:false})
    expect(executionHorizon(grade,{itemId:'outro'},'revision',now)).toMatchObject({mode:'NO_EXECUTION',coverageMinutes:null})
  })
  it('mostra ausência ou data inválida sem inventar hoje ou contagem zero como sucesso', () => {
    expect(executionHorizon(null,null,null,now)).toMatchObject({source:'NONE',mode:'NO_EXECUTION',minutesRemaining:null})
    const grade=view();Object.assign(grade.rundown,{date:'2026-02-30'})
    expect(executionHorizon(grade,{itemId:'pgm'},'revision',now)).toMatchObject({mode:'INVALID_DATE',nowFrames:null,minutesRemaining:null})
  })
})

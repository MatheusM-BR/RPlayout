import {describe,it,expect} from 'vitest'
import type {ResolvedItem,CompensationAction} from '@rplayout/protocol'
import type {ItemView,RundownView} from './plan.js'
import {executionTrim} from './execution-trim.js'
const rate={num:25,den:1}
const entry=()=>({item:{id:'vt',type:'VT',durationOverride:null},asset:{kind:'VIDEO',durationNs:null,durationFrames:500},trim:{in:25,out:150}} as ItemView)
const timing=(duration:number,state='SCHEDULED')=>({duration,state} as ResolvedItem)
describe('corte operacional resolvido',()=>{
  it('aplica corte automático com mark-in e não modifica o nominal',()=>{
    const value=entry();expect(executionTrim(value,timing(75),rate)).toEqual({in:25,out:100});expect(value.trim).toEqual({in:25,out:150})
  })
  it('estende somente dentro dos quadros existentes',()=>{
    expect(executionTrim(entry(),timing(475),rate)).toEqual({in:25,out:500})
    expect(()=>executionTrim(entry(),timing(476),rate)).toThrow('excede os quadros')
  })
  it('retorno histórico não reaplica sacrifício do horário expirado',()=>{
    expect(executionTrim(entry(),timing(0,'DONE'),rate)).toEqual({in:25,out:150})
  })
  it('preserva duração declarada do item no ar quando não há pin montado',()=>{
    const original=entry(),value={...original,item:{...original.item,durationOverride:100}}
    expect(executionTrim(value,timing(40,'ON_AIR'),rate)).toEqual({in:25,out:125})
  })
  it('recusa duração vazia e posição inválida',()=>{
    expect(()=>executionTrim(entry(),timing(0),rate)).toThrow('reproduzível')
    expect(()=>executionTrim({...entry(),trim:{in:-1,out:125}},timing(75),rate)).toThrow('posição inválida')
  })
  it('imagem parada tem duração de exibição sem limite de arquivo',()=>{
    const value={...entry(),asset:{...entry().asset!,kind:'STILL' as const,durationFrames:0},trim:{in:0,out:0}}
    expect(executionTrim(value,undefined,rate)).toEqual({in:0,out:250})
    expect(executionTrim(value,timing(300),rate)).toEqual({in:0,out:300})
  })
})

describe('corte previsto para live depende de admissão real, não EOS antecipado',()=>{
  const action=(originalDuration=125,newDuration=75,targetAnchorId='live'):CompensationAction=>({itemId:'vt',actionType:'EMERGENCY_CUT',originalDuration,newDuration,deltaFrames:originalDuration-newDuration,targetAnchorId,targetAnchorType:'HARD_TIME',reason:'Texto editorial arbitrário, não usado para decidir execução.'})
  const context=(actions:CompensationAction[]=[action()],target:Record<string,unknown>={})=>({items:[{item:{id:'live',type:'LIVE',sourceRef:'ndi:ESTUDIO',anchor:{kind:'HARD_TIME',at:75},...target}},{item:{id:'fixed-file',type:'VT',anchor:{kind:'FIXED',at:100}}}],schedule:{compensationReport:{actions}}} as unknown as Pick<RundownView,'items'|'schedule'>)
  it('mantém o Mark In/corte de arquivo enquanto a grade continua projetando a interrupção',()=>{
    const plan=timing(75,'PENDING'),before=JSON.stringify(plan)
    expect(executionTrim(entry(),plan,rate,context())).toEqual({in:25,out:150})
    expect(JSON.stringify(plan)).toBe(before)
  })
  it.each(['FIXED','HARD_TIME'])('aceita apenas âncora %s de LIVE com endpoint concreto',kind=>{
    expect(executionTrim(entry(),timing(75),rate,context([action()],{anchor:{kind,at:75}}))).toEqual({in:25,out:150})
    expect(executionTrim(entry(),timing(75),rate,context([action()],{type:'VT',sourceRef:null}))).toEqual({in:25,out:100})
    expect(executionTrim(entry(),timing(75),rate,context([action()],{sourceRef:null}))).toEqual({in:25,out:100})
  })
  it('live FLOW não transforma ajuste normal em corte condicionado',()=>{
    expect(executionTrim(entry(),timing(75),rate,context([action()],{anchor:{kind:'FLOW'}}))).toEqual({in:25,out:100})
  })
  it('preserva cortes por âncoras de arquivo mesmo em plano misto',()=>{
    expect(executionTrim(entry(),timing(60),rate,context([action(125,75),action(75,60,'fixed-file')]))).toEqual({in:25,out:85})
  })
  it('não desfaz trim/duração manual que já pertencem à edição publicada',()=>{
    const original=entry(),value={...original,item:{...original.item,durationOverride:100}}
    expect(executionTrim(value,timing(50),rate,context([action(100,50)]))).toEqual({in:25,out:125})
  })
  it('mantém expansão anterior válida, mas nunca fabrica quadros fora do arquivo',()=>{
    expect(executionTrim(entry(),timing(75),rate,context([action(300,75)]))).toEqual({in:25,out:325})
    expect(()=>executionTrim(entry(),timing(75),rate,context([action(600,75)]))).toThrow('excede os quadros')
  })
  it('não deixa um corte antigo apagar expansão válida posterior à outra âncora',()=>{
    const stretch:CompensationAction={itemId:'vt',actionType:'EXPAND_FILLER',originalDuration:75,newDuration:200,deltaFrames:125,targetAnchorId:'fixed-file',reason:'expandir'}
    expect(executionTrim(entry(),timing(100),rate,context([action(125,75,'fixed-file'),stretch,action(200,100)]))).toEqual({in:25,out:225})
  })
  it('ajuste independente posterior vence cortes condicionais anteriores',()=>{
    expect(executionTrim(entry(),timing(30),rate,context([action(125,100),action(100,60,'fixed-file'),action(60,30)]))).toEqual({in:25,out:85})
  })
})

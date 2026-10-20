import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {channels,rundowns,rundownItems,mediaAssets,operationalPlaylistRevisions,operatorDecisions} from '../db/schema.js'
import {getChannel} from '../db/repo.js'
import {publishOperationalPlaylist,readOperationalPayload} from './operational-playlist.js'
import {inspectCompensation,commitCompensation,compensationReceipt,type CompensationContext} from './operational-compensation.js'
import type {OperationalCompensationInput} from '@rplayout/protocol'
import {compensationDeltaFrames} from '../../../web/src/domain/compensation-input.js'
import {compensationConflictMeasures,compensationMeasuredDelta} from '../../../web/src/domain/compensation-conflicts.js'
import {buildView} from './plan.js'

let database:ReturnType<typeof openDatabase>,context:CompensationContext
const input=(action:OperationalCompensationInput['action']='FILLER',deltaFrames=250):OperationalCompensationInput=>({itemId:action==='DROP_OPTIONAL'?'optional':action==='ACCEPT_DELAY'?'soft':action==='TRIM'?'vt':'filler',expectedFrames:action==='FILLER'?500:1000,action,deltaFrames})
const revision=()=>database.db.select().from(operationalPlaylistRevisions).all().find(row=>row.active)!
const payload=()=>readOperationalPayload(revision().payload)
const review=(value=input(),ctx=context)=>inspectCompensation(database.db,ctx,value,'operator')
const commit=(plan:ReturnType<typeof review>,id=randomUUID(),ctx=context,authorize=()=>{})=>commitCompensation(database.db,ctx,plan.review.input,id,plan.review.reviewToken,'operator',authorize)
beforeEach(async()=>{
  database=openDatabase(':memory:');const db=database.db,now=new Date().toISOString()
  db.insert(channels).values({id:'ch',name:'Canal',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
  db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Editorial',date:'2026-10-06',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
  db.insert(mediaAssets).values({id:'asset',path:'C:/fixture.mkv',contentHash:'a'.repeat(64),title:'Video',kind:'VIDEO',durationFrames:5000,durationNs:200_000_000_000,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:now}).run()
  for(const [order,id] of ['live','filler','vt','optional','soft','hard'].entries())db.insert(rundownItems).values({id,rundownId:'rd',sortOrder:order,title:id,type:id==='live'?'LIVE':id==='filler'?'FILLER':'VT',sourceRef:id==='live'?'ndi:CAM':null,mediaId:id==='live'?null:'asset',durationOverride:id==='filler'?500:1000,trim:id==='live'?null:{in:0,out:id==='filler'?500:1000},minDuration:0,elastic:id==='filler'?{min:100,max:2000}:null,protected:false,optional:id==='optional',trimmable:id==='vt',anchor:id==='soft'?{kind:'SOFT',at:7000,tolerance:500,priority:2}:id==='hard'?{kind:'HARD_TIME',at:10000}:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
  const published=await publishOperationalPlaylist(db,(await getChannel(db,'ch'))!,'rd','operator')
  context={channelId:'ch',rundownId:'rd',revisionId:published.id,executionId:'occurrence-1',onAirItemId:'live',onAir:{itemId:'live',startedAt:0,elapsed:20},preview:null}
})
afterEach(()=>database.sqlite.close())
describe('compensação da edição operacional',()=>{
  it('medida copiada do conflito chega à revisão publicada e ao commit sem TAKE ou duplicação',async()=>{
    const old=payload(),channel=(await getChannel(database.db,'ch'))!
    const view=buildView(old.rundown,channel,old.items,new Map((old.assets??[]).map(asset=>[asset.id,asset])),null,context.onAir)
    const [measure]=compensationConflictMeasures(view.items,'vt','TRIM',[{kind:'OVERRUN',itemId:'hard',frames:250}],channel.rate)
    expect(measure).toBeDefined()
    const plan=review(input('TRIM',compensationMeasuredDelta('vt','TRIM',measure!.secondsText,channel.rate,measure!)))
    expect(plan.review).toMatchObject({beforeFrames:1000,afterFrames:750})
    const id=randomUUID(),first=commit(plan,id);context.revisionId=revision().id
    expect(commit(plan,id)).toEqual({revision:first.revision,deduplicated:true})
    expect(payload().items.find(row=>row.id==='vt')!.trim!.out).toBe(750)
    expect(payload().items.find(row=>row.id==='live')!.sourceRef).toBe('ndi:CAM')
    expect(database.db.select().from(operatorDecisions).all().filter(row=>row.kind==='OPERATIONAL_COMPENSATION')).toHaveLength(1)
    expect(database.db.select().from(rundownItems).all().find(row=>row.id==='vt')!.trim!.out).toBe(1000)
  })
  it('atalho da tela não autoriza compensar um alvo que entrou no CUE',async()=>{
    const old=payload(),channel=(await getChannel(database.db,'ch'))!
    const view=buildView(old.rundown,channel,old.items,new Map((old.assets??[]).map(asset=>[asset.id,asset])),null,context.onAir)
    const [measure]=compensationConflictMeasures(view.items,'vt','TRIM',[{kind:'OVERRUN',itemId:'hard',frames:250}],channel.rate)
    expect(measure).toBeDefined();const before=revision().id
    expect(()=>review(input('TRIM',measure!.deltaFrames),{...context,preview:{kind:'ITEM',id:'vt'}})).toThrow('CUE')
    expect(revision().id).toBe(before)
  })
  it('ajuste decimal do operador é revisado e gravado em quadros sem publicar rascunho',()=>{
    const deltaFrames=compensationDeltaFrames('FILLER','2,5',{num:25,den:1})
    expect(deltaFrames).toBe(63)
    const plan=review(input('FILLER',deltaFrames))
    expect(plan.review.afterFrames).toBe(563)
    const result=commit(plan)
    expect(result.deduplicated).toBe(false)
    expect(payload().items.find(row=>row.id==='filler')!.durationOverride).toBe(563)
    expect(database.db.select().from(rundownItems).all().find(row=>row.id==='filler')!.durationOverride).toBe(500)
  })
  it('consulta commit persistido sem criar revisão/auditoria ou presumir execução atual',()=>{
    const id=randomUUID();expect(compensationReceipt(database.db,'ch',id,'operator').state).toBe('NOT_RECORDED')
    const committed=commit(review(),id)
    const before=database.db.select().from(operatorDecisions).all(),revisions=database.db.select().from(operationalPlaylistRevisions).all()
    for(let attempt=0;attempt<3;attempt++)expect(compensationReceipt(database.db,'ch',id,'operator')).toMatchObject({state:'RECORDED',requestId:id,revision:committed.revision,currentExecutionObserved:false})
    expect(database.db.select().from(operatorDecisions).all()).toEqual(before)
    expect(database.db.select().from(operationalPlaylistRevisions).all()).toEqual(revisions)
    expect(compensationReceipt(database.db,'other',id,'operator').state).toBe('NOT_RECORDED')
    expect(compensationReceipt(database.db,'ch',id,'other-operator').state).toBe('NOT_RECORDED')
  })
  it('revisão distingue duração nominal da duração executável após ajuste automático',()=>{
    const plan=review()
    expect(plan.review).toMatchObject({beforeFrames:500,afterFrames:750,beforeEffectiveFrames:2000,afterEffectiveFrames:2000})
    commit(plan)
    const decision=database.db.select().from(operatorDecisions).all().find(row=>row.kind==='OPERATIONAL_COMPENSATION')!
    expect(decision.payload).toMatchObject({beforeEffectiveFrames:2000,afterEffectiveFrames:2000})
  })
  it('estende filler no corte real sem publicar rascunho e mantém versão original',()=>{
    const original=structuredClone(payload()),count=database.db.select().from(operatorDecisions).all().length
    database.db.update(rundownItems).set({title:'Rascunho não publicado'}).where(eq(rundownItems.id,'filler')).run()
    const plan=review();expect(database.db.select().from(operatorDecisions).all()).toHaveLength(count)
    commit(plan)
    expect(payload().items.find(item=>item.id==='filler')).toMatchObject({title:'filler',durationOverride:750,trim:{in:0,out:750}})
    expect(readOperationalPayload(database.db.select().from(operationalPlaylistRevisions).all()[0]!.payload)).toEqual(original)
  })
  it('reduz filler nos limites elásticos',()=>{
    commit(review(input('FILLER',-250)));expect(payload().items.find(item=>item.id==='filler')!.trim!.out).toBe(250)
    context.revisionId=revision().id
    expect(()=>review({...input('FILLER',-151),expectedFrames:250})).toThrow('mínimo/máximo')
  })
  it('não estende além dos quadros reais mesmo com limite elástico maior',()=>{
    const row=revision(),old=payload();old.items=old.items.map(item=>item.id==='filler'?{...item,elastic:{min:100,max:20000}}:item)
    database.db.update(operationalPlaylistRevisions).set({payload:old as unknown as Record<string,unknown>}).where(eq(operationalPlaylistRevisions.id,row.id)).run()
    expect(()=>review(input('FILLER',5000))).toThrow('quadros suficientes')
  })
  it('trim grava corte executável e fixa piso de70% contra cortes sucessivos',()=>{
    commit(review(input('TRIM',-250)))
    expect(payload().items.find(item=>item.id==='vt')).toMatchObject({trim:{in:0,out:750},durationOverride:750,minDuration:700})
    context.revisionId=revision().id
    expect(()=>review({...input('TRIM',-100),expectedFrames:750})).toThrow('mínima')
  })
  it('remove opcional, reordena e audita sem remover o VT obrigatório',()=>{
    commit(review(input('DROP_OPTIONAL',0)))
    expect(payload().items.some(item=>item.id==='optional')).toBe(false)
    expect(payload().items.map(item=>item.order)).toEqual([0,1,2,3,4])
    context.revisionId=revision().id
    expect(()=>review({...input('DROP_OPTIONAL',0),itemId:'vt'})).toThrow('Somente')
  })
  it('aceitar atraso desloca só horário flexível e nunca hard time',()=>{
    const plan=review(input('ACCEPT_DELAY',750))
    expect(plan.review.anchorChange).toMatchObject({before:{kind:'SOFT',at:7000},after:{kind:'SOFT',at:7750}})
    commit(plan)
    expect(payload().items.find(item=>item.id==='soft')!.anchor).toMatchObject({at:7750})
    const decision=database.db.select().from(operatorDecisions).all().find(row=>row.kind==='OPERATIONAL_COMPENSATION')!
    expect(decision.payload.anchorChange).toEqual(plan.review.anchorChange)
    expect(payload().items.find(item=>item.id==='hard')!.anchor).toEqual({kind:'HARD_TIME',at:10000})
    context.revisionId=revision().id
    expect(()=>review({...input('ACCEPT_DELAY',750),itemId:'hard'})).toThrow('FIXED/HARD_TIME')
  })
  it('janela de atraso preserva largura e registra ambos os limites originais/resolvidos',()=>{
    const row=revision(),old=payload()
    old.items=old.items.map(item=>item.id==='soft'?{...item,anchor:{kind:'WINDOW',from:7000,to:7500,priority:2}}:item)
    database.db.update(operationalPlaylistRevisions).set({payload:old as unknown as Record<string,unknown>}).where(eq(operationalPlaylistRevisions.id,row.id)).run()
    const plan=review(input('ACCEPT_DELAY',750))
    expect(plan.review.anchorChange).toEqual({before:{kind:'WINDOW',from:7000,to:7500,priority:2},after:{kind:'WINDOW',from:7750,to:8250,priority:2}})
    commit(plan)
    const decision=database.db.select().from(operatorDecisions).all().find(row=>row.kind==='OPERATIONAL_COMPENSATION')!
    expect(decision.payload.anchorChange).toEqual(plan.review.anchorChange)
    expect(payload().items.find(item=>item.id==='soft')!.anchor).toEqual(plan.review.anchorChange!.after)
  })
  it('PGM e itens já exibidos não são editáveis por compensação',()=>{
    expect(()=>review({...input(),itemId:'live',expectedFrames:1000})).toThrow('futuros')
  })
  it('item no CUE é preservado',()=>{
    expect(()=>review(input(),{...context,preview:{kind:'ITEM',id:'filler'}})).toThrow('CUE')
  })
  it.each(['CUE','PGM'])('entrada do alvo em %s após review recusa commit sem revisão/auditoria',bus=>{
    const plan=review(),before=revision().id
    const changed:CompensationContext=bus==='CUE'?{...context,preview:{kind:'ITEM',id:'filler'}}
      :{...context,onAirItemId:'filler',onAir:{itemId:'filler',startedAt:100,elapsed:0}}
    expect(()=>commit(plan,randomUUID(),changed)).toThrow(bus==='CUE'?'CUE':'futuros')
    expect(revision().id).toBe(before)
    expect(payload().items.find(item=>item.id==='filler')!.durationOverride).toBe(500)
    expect(database.db.select().from(operatorDecisions).all().filter(row=>row.kind==='OPERATIONAL_COMPENSATION')).toHaveLength(0)
  })
  it('zona protegida bloqueia filler mesmo com prioridade da âncora superior',()=>{
    const row=revision(),old=payload();old.rundown={...old.rundown,protectedZones:[{id:'zone',label:'Obrigatório',from:1000,to:1500,priority:1}]}
    database.db.update(operationalPlaylistRevisions).set({payload:old as unknown as Record<string,unknown>}).where(eq(operationalPlaylistRevisions.id,row.id)).run()
    expect(()=>review()).toThrow('zona protegida')
  })
  it('reenvio após commit retorna a mesma revisão sem auditoria duplicada',()=>{
    const plan=review(),id=randomUUID(),first=commit(plan,id);context.revisionId=revision().id
    const repeated=commit(plan,id);expect(repeated).toEqual({revision:first.revision,deduplicated:true})
    expect(database.db.select().from(operatorDecisions).all().filter(row=>row.kind==='OPERATIONAL_COMPENSATION')).toHaveLength(1)
  })
  it('PGM/CUE ou ocorrência novos invalidam a conferência',()=>{
    const plan=review();expect(()=>commit(plan,randomUUID(),{...context,executionId:'occurrence-2'})).toThrow('PGM, CUE')
    expect(()=>commit(plan,randomUUID(),{...context,preview:{kind:'ASSET',id:'asset'}})).toThrow('PGM, CUE')
  })
  it('passagem do tempo não invalida a ocorrência nem reinventa a ação conferida',()=>{
    const plan=review();commit(plan,randomUUID(),{...context,onAir:{...context.onAir!,elapsed:100}})
    expect(payload().items.find(item=>item.id==='filler')!.durationOverride).toBe(750)
  })
  it('falha da auditoria reverte revisão e autorização revogada bloqueia inclusive retry',()=>{
    const plan=review(),before=revision().id
    database.sqlite.exec("CREATE TRIGGER deny_compensation BEFORE INSERT ON operator_decisions WHEN NEW.kind='OPERATIONAL_COMPENSATION' BEGIN SELECT RAISE(ABORT,'fixture audit unavailable'); END")
    expect(()=>commit(plan)).toThrow('fixture audit');expect(revision().id).toBe(before)
    database.sqlite.exec('DROP TRIGGER deny_compensation')
    const id=randomUUID();commit(plan,id)
    expect(()=>commit(plan,id,context,()=>{throw new Error('authorization revoked')})).toThrow('authorization revoked')
  })
})

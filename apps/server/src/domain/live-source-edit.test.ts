import {afterEach,describe,expect,it} from 'vitest'
import {eq} from 'drizzle-orm'
import {liveSourceETag} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {channels,liveSources,liveSourceVersions,channelProjectVersions,operatorDecisions} from '../db/schema.js'
import {editLiveSource,readLiveSourceReview,type LiveSourceEditHooks} from './live-source-edit.js'
const opened:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const f of opened.splice(0))f.sqlite.close()})
function fixture(){
  const f=openDatabase(':memory:');opened.push(f)
  for(const id of ['a','b'])f.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  const hooks:LiveSourceEditHooks={authorize:()=>{},audit:(tx,details)=>{tx.insert(operatorDecisions).values({id:'audit-'+details.revision,rundownId:'@security',kind:'LIVE_SOURCE_EDITED',payload:details,createdAt:'now'}).run()}}
  const review=(id='a')=>readLiveSourceReview(f.db,id,()=>{})
  const create=(body:object={})=>editLiveSource(f.db,'CREATE',undefined,{channelId:'a',name:'ESTÚDIO ÇÃO',kind:'NDI',targetUrl:'ndi:Estúdio çãó',...body},liveSourceETag('a',review().revision),hooks)
  const state=()=>[f.db.select().from(liveSources).all(),f.db.select().from(liveSourceVersions).all(),f.db.select().from(channelProjectVersions).all(),f.db.select().from(operatorDecisions).all()]
  return {...f,hooks,review,create,state}
}
describe('cadastro live confirma revisão original, nunca comanda o transporte',()=>{
  it('leitura é estável, privada e mantém distinção entre cadastro e sinal',()=>{
    const f=fixture();f.create({kind:'SRT',targetUrl:'srt://localhost:9000?passphrase=PRIVATE_FIXTURE_PASSWORD'})
    const before=f.state(),review=f.review()
    expect(f.review()).toEqual(review);expect(f.state()).toEqual(before)
    expect(review).toMatchObject({automaticTake:false,physicalSignalValidated:false})
    expect(JSON.stringify(review)).not.toContain('PRIVATE_FIXTURE_PASSWORD')
    expect(review.sources[0]?.controlRef).toMatch(/^srt:protected:v1:/)
  })
  it.each([undefined,'*','"sources:b:1"','"sources:a:0"','"sources:a:9007199254740992"',['"sources:a:1"']])('recusa revisão ausente/malformada ou de outro canal: %s',header=>{
    const f=fixture(),before=f.state()
    expect(()=>editLiveSource(f.db,'CREATE',undefined,{channelId:'a',name:'QA',kind:'NDI',targetUrl:'ndi:QA'},header,f.hooks)).toThrow()
    expect(f.state()).toEqual(before)
  })
  it('outro escritor e reversão ABA invalidam confirmação antiga',()=>{
    const f=fixture(),source=f.create().source!,review=f.review()
    f.db.update(liveSources).set({name:'Outro'}).where(eq(liveSources.id,source.id)).run()
    f.db.update(liveSources).set({name:source.name}).where(eq(liveSources.id,source.id)).run()
    const before=f.state()
    expect(()=>editLiveSource(f.db,'UPDATE',source.id,{name:'Velho rascunho'},liveSourceETag('a',review.revision),f.hooks)).toThrow('mudaram')
    expect(f.state()).toEqual(before)
  })
  it.each(['CREATE','UPDATE','DELETE'] as const)('falha de auditoria reverte dados e os dois contadores: %s',operation=>{
    const f=fixture(),source=f.create().source!,review=f.review(),before=f.state()
    const body=operation==='CREATE'?{channelId:'a',name:'QA',kind:'OMT',targetUrl:'omt:QA'}:{name:'Novo'}
    expect(()=>editLiveSource(f.db,operation,source.id,body,liveSourceETag('a',review.revision),{...f.hooks,audit:()=>{throw new Error('AUDIT_FAIL')}})).toThrow('AUDIT_FAIL')
    expect(f.state()).toEqual(before)
  })
  it('autorização é reconferida na transação antes da escrita',()=>{
    const f=fixture(),before=f.state()
    expect(()=>editLiveSource(f.db,'CREATE',undefined,{channelId:'a',name:'QA',kind:'NDI',targetUrl:'ndi:QA'},liveSourceETag('a',f.review().revision),{...f.hooks,authorize:()=>{expect(f.sqlite.inTransaction).toBe(true);throw new Error('REVOKED')}})).toThrow('REVOKED')
    expect(f.state()).toEqual(before)
  })
  it('recusa mudança de dono, canal arquivado e operação vazia',()=>{
    const f=fixture(),source=f.create().source!,header=liveSourceETag('a',f.review().revision),before=f.state()
    for(const body of [{channelId:'b',name:'Novo'},{}])expect(()=>editLiveSource(f.db,'UPDATE',source.id,body,header,f.hooks)).toThrow('Parâmetros')
    expect(f.state()).toEqual(before)
    f.db.update(channels).set({archivedAt:'now'}).where(eq(channels.id,'a')).run()
    expect(()=>editLiveSource(f.db,'DELETE',source.id,null,header,f.hooks)).toThrow('arquivado')
  })
  it.each([{kind:'NDI',targetUrl:''},{kind:'SRT',targetUrl:'rtmp://localhost/live'},{kind:'SDI',targetUrl:'sdi:-1'},{kind:'OMT',targetUrl:'ndi:QA'},{failoverConfig:{maxLossPercent:101}},{failoverConfig:{maxTimeoutMs:-1}},{srtConfig:{mode:'caller',host:'x',port:9000,latencyMs:800}},{unknown:'PRIVATE_FIXTURE_PASSWORD'}])('recusa conexão/limites incoerentes sem valores privados: %s',body=>{
    const f=fixture(),before=f.state()
    expect(()=>f.create(body)).toThrow()
    expect(f.state()).toEqual(before)
  })
  it('pares são do mesmo canal e exclusão exige desvinculação explícita',()=>{
    const f=fixture(),primary=f.create().source!,backup=f.create({name:'Reserva',role:'BACKUP',pairedSourceId:primary.id}).source!
    const before=f.state()
    expect(()=>editLiveSource(f.db,'DELETE',primary.id,null,liveSourceETag('a',f.review().revision),f.hooks)).toThrow('Desvincule')
    expect(()=>f.create({pairedSourceId:primary.id})).toThrow('distinto')
    const foreign=editLiveSource(f.db,'CREATE',undefined,{channelId:'b',name:'B',kind:'NDI',targetUrl:'ndi:B',role:'BACKUP'},liveSourceETag('b',f.review('b').revision),{...f.hooks,audit:()=>{}}).source!
    expect(()=>f.create({pairedSourceId:foreign.id})).toThrow('mesmo canal')
    expect(f.state().slice(0,1)).not.toEqual(before.slice(0,1)) // only deliberate foreign create changed data
    editLiveSource(f.db,'UPDATE',backup.id,{pairedSourceId:null},liveSourceETag('a',f.review().revision),f.hooks)
    editLiveSource(f.db,'DELETE',primary.id,null,liveSourceETag('a',f.review().revision),f.hooks)
    expect(f.review().sources.map(s=>s.id)).toEqual([backup.id])
  })
  it('apelido mantém credenciais, mudança explícita de protocolo remove configuração SRT antiga',()=>{
    const f=fixture(),source=f.create({kind:'SRT',srtConfig:{mode:'caller',host:'localhost',port:9000,latencyMs:800,passphrase:'PRIVATE_FIXTURE_PASSWORD'},targetUrl:''}).source!
    const result=editLiveSource(f.db,'UPDATE',source.id,{name:'Apelido',targetUrl:source.controlRef},liveSourceETag('a',f.review().revision),f.hooks)
    expect(result.source?.name).toBe('Apelido');expect(JSON.stringify(result)).not.toContain('PRIVATE_FIXTURE_PASSWORD')
    expect(f.db.select().from(liveSources).get()?.srtConfig?.passphrase).toBe('PRIVATE_FIXTURE_PASSWORD')
    editLiveSource(f.db,'UPDATE',source.id,{kind:'OMT',targetUrl:'omt:Novo'},liveSourceETag('a',f.review().revision),f.hooks)
    expect(f.db.select().from(liveSources).get()?.srtConfig).toBeNull()
  })
})

import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {eq} from 'drizzle-orm'
import {graphicsETag,type GraphicsReview} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {channels,graphicTemplates,itemGraphics,rundowns,rundownItems,secondaryEvents} from '../db/schema.js'
import {editGraphicTemplate,editSlate,readGraphicsReview,type GraphicsHooks} from './graphics-edit.js'
let value:ReturnType<typeof openDatabase>
const hooks:GraphicsHooks={authorize:()=>{},audit:(tx,details)=>{expect(details).not.toHaveProperty('svg');expect(details).not.toHaveProperty('fields')}}
const draft={name:'Arte Çãó',svg:'<g><text>{{nome}}</text></g>'}
beforeEach(()=>{value=openDatabase(':memory:');for(const id of ['a','b','G','ch:ç'])value.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()})
afterEach(()=>value.sqlite.close())
const read=(id:string|null='a')=>readGraphicsReview(value.db,id,hooks.authorize)
const header=(id:string|null='a')=>graphicsETag(read(id))
const create=(id:string|null='a')=>editGraphicTemplate(value.db,'CREATE',undefined,{...draft,channelId:id},header(id),hooks)
const state=()=>Object.fromEntries(['channels','graphic_templates','graphics_versions','channel_project_versions','channel_configuration_versions','editorial_revision_counters'].map(table=>[table,value.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
describe('templates e slate usam a revisão original, sem mass assignment',()=>{
  it('consulta estável não grava; lista local inclui apenas compartilhadas e do canal',()=>{
    create('b');create(null);const before=state(),original=read()
    expect(original.templates.map(row=>row.channelId)).toEqual([null]);expect(read()).toEqual(original);expect(state()).toEqual(before)
    expect(original).toMatchObject({automaticTake:false,physicalOutputValidated:false,slateTemplateId:null,channelArchived:false})
  })
  it.each([undefined,'*','W/"1"','"graphics:C%3Aa:0:1"','"graphics:C%3Aa:01:1"','"graphics:C%3Aa:1:9007199254740992"','"graphics:%XX:1:1"','"graphics:C%3Ab:1:1"',[]])('recusa prova ausente/malformada %s',proof=>{
    const before=state();expect(()=>editGraphicTemplate(value.db,'CREATE',undefined,{...draft,channelId:'a'},proof,hooks)).toThrow();expect(state()).toEqual(before)
  })
  it('uma prova tem vencedor único e defaults/campos declarados são consistentes',()=>{
    const original=header(),saved=editGraphicTemplate(value.db,'CREATE',undefined,{...draft,channelId:'a'},original,hooks)
    expect(saved.template).toMatchObject({channelId:'a',fadeMs:300,holdSeconds:null,fields:[{key:'nome',label:'nome',defaultValue:''}]})
    expect(saved.templates).toEqual([saved.template]);expect(saved.eTag).toBe(graphicsETag(saved));expect(()=>editGraphicTemplate(value.db,'CREATE',undefined,{...draft,channelId:'a'},original,hooks)).toThrow('mudaram')
  })
  it('PATCH parcial conserva campos declarados e atualização de SVG deriva campos visíveis',()=>{
    const saved=create(),row=saved.template!
    editGraphicTemplate(value.db,'UPDATE',row.id,{fields:[{key:'nome',label:'Nome próprio',defaultValue:'Maria'}]},header(),hooks)
    const named=editGraphicTemplate(value.db,'UPDATE',row.id,{name:'Novo nome'},header(),hooks)
    expect(named.template!.fields).toEqual([{key:'nome',label:'Nome próprio',defaultValue:'Maria'}]);expect(named.template!.svg).toBe(draft.svg)
    const changed=editGraphicTemplate(value.db,'UPDATE',row.id,{svg:'<text>{{nome}} {{cargo}}</text>'},header(),hooks)
    expect(changed.template!.fields).toEqual([{key:'nome',label:'Nome próprio',defaultValue:'Maria'},{key:'cargo',label:'cargo',defaultValue:''}])
  })
  it.each([{}, {channelId:'b'}, {id:'forged'}, {fadeMs:-1}, {holdSeconds:0}, {name:'  '}, {fields:[{key:'k',label:'K',defaultValue:''},{key:'k',label:'K',defaultValue:''}]}])('PATCH estrito recusa %j',patch=>{
    const saved=create(),before=state();expect(()=>editGraphicTemplate(value.db,'UPDATE',saved.template!.id,patch,header(),hooks)).toThrow('inválida');expect(state()).toEqual(before)
  })
  it.each(['same-value','ABA','owner','channel','global'])('alteração durável invalida conferência: %s',change=>{
    const saved=create(),global=create(null),original=header()
    if(change==='same-value')value.sqlite.exec("UPDATE graphic_templates SET name=name WHERE channel_id='a'")
    if(change==='ABA')value.sqlite.exec("UPDATE graphic_templates SET name='Other' WHERE channel_id='a'; UPDATE graphic_templates SET name='Arte Çãó' WHERE channel_id='a'")
    if(change==='owner')value.sqlite.exec("UPDATE graphic_templates SET channel_id='b' WHERE channel_id='a'")
    if(change==='channel')value.sqlite.exec("UPDATE channels SET name=name WHERE id='a'")
    if(change==='global')value.sqlite.prepare('UPDATE graphic_templates SET name=name WHERE id=?').run(global.template!.id)
    const before=state();expect(()=>editGraphicTemplate(value.db,'UPDATE',saved.template!.id,{name:'Stale'},original,hooks)).toThrow();expect(state()).toEqual(before)
  })
  it('outro canal não invalida prova local; global e canal G são distintos e Unicode funciona',()=>{
    const original=header();create('b');expect(()=>editGraphicTemplate(value.db,'CREATE',undefined,{...draft,channelId:'a'},original,hooks)).not.toThrow()
    expect(header('G')).not.toBe(header(null));expect(create('ch:ç').channelId).toBe('ch:ç')
  })
  it('slate aceita global/local e rejeita ausente, owner errado e campos ocultos',()=>{
    const local=create(),foreign=create('b'),shared=create(null)
    for(const templateId of [local.template!.id,shared.template!.id,null])expect(editSlate(value.db,'a',{templateId},header(),hooks).slateTemplateId).toBe(templateId)
    for(const body of [{templateId:'missing'},{templateId:foreign.template!.id},{templateId:null,channelId:'b'}]){const before=state();expect(()=>editSlate(value.db,'a',body,header(),hooks)).toThrow();expect(state()).toEqual(before)}
  })
  it('prova anterior à alteração global/ABA não autoriza slate, mesmo com mesmo conteúdo',()=>{
    const shared=create(null),original=header();value.sqlite.exec('UPDATE graphic_templates SET name=name')
    const before=state();expect(()=>editSlate(value.db,'a',{templateId:shared.template!.id},original,hooks)).toThrow('mudaram');expect(state()).toEqual(before)
  })
  it.each(['slate','cue','secondary'])('exclusão recusa vínculo %s sem apagar referência',kind=>{
    const saved=create(),id=saved.template!.id
    if(kind==='slate')editSlate(value.db,'a',{templateId:id},header(),hooks)
    else{
      value.db.insert(rundowns).values({id:'rd',channelId:'a',name:'rd',date:'2026-10-05',plannedStart:0,loop:false,createdAt:'now',updatedAt:'now'}).run()
      value.db.insert(rundownItems).values({id:'item',rundownId:'rd',sortOrder:0,type:'LIVE',title:'fixture',minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:false,loop:false}).run()
      if(kind==='cue')value.db.insert(itemGraphics).values({id:'cue',itemId:'item',templateId:id,values:{},atSeconds:0,createdAt:'now'}).run()
      else value.db.insert(secondaryEvents).values({id:'event',channelId:'a',itemId:'item',definition:{id:'event',targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:id,payload:{},enabled:false},createdAt:'now',updatedAt:'now'}).run()
    }
    const before=state();expect(()=>editGraphicTemplate(value.db,'DELETE',id,undefined,header(),hooks)).toThrow('vinculada');expect(state()).toEqual(before)
  })
  it('remover sem vínculos é explícito e consome revisão, sem apagar histórico alheio',()=>{
    const saved=create(),foreign=create('b'),original=header();expect(editGraphicTemplate(value.db,'DELETE',saved.template!.id,undefined,original,hooks).template).toBeNull()
    expect(value.db.select().from(graphicTemplates).where(eq(graphicTemplates.id,foreign.template!.id)).get()).toEqual(foreign.template)
    expect(()=>editGraphicTemplate(value.db,'DELETE',saved.template!.id,undefined,original,hooks)).toThrow('não encontrada')
  })
  it('canal arquivado conserva consulta histórica, mas não edição; ausente não é sucesso',()=>{
    create();value.sqlite.exec("UPDATE channels SET archived_at='now' WHERE id='a'");expect(read().channelArchived).toBe(true)
    expect(()=>editSlate(value.db,'a',{templateId:null},header(),hooks)).toThrow('arquivado');expect(()=>read('missing')).toThrow('não encontrado')
  })
  it('arte legada inválida não desaparece da lista nem recebe sucesso de conferência',()=>{
    create();value.sqlite.exec('UPDATE graphic_templates SET fade_ms=-1');const before=state();expect(()=>read()).toThrow('salva inválida');expect(state()).toEqual(before)
  })
})

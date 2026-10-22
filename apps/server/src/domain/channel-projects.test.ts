import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client.js'
import { channels, rundowns, rundownItems, graphicTemplates, itemGraphics, secondaryEvents,channelProjectSnapshots,operationalPlaylistRevisions,outputProfiles,transmissionPresets,liveSources,scheduleRules,multiviewConfigs,destinations,guestKeys,operatorDecisions,channelConfigurationVersions,channelProjectVersions,playlistVersions,asRun,externalDevices } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { restoreChannelProject as guardedRestore, reviewChannelProject, saveChannelProject,type ProjectMutationHooks } from './channel-projects.js'
import {projectRestoreETag} from '@rplayout/protocol'
import {projectRevision,validateProjectRevisions} from '../db/project-revisions.js'
// Legacy integrity fixtures explicitly obtain a review; production has no fallback.
async function restoreChannelProject(db:Parameters<typeof guardedRestore>[0],channelId:string,id:string,hooks?:ProjectMutationHooks){
  const review=reviewChannelProject(db,channelId,id,null)
  return guardedRestore(db,channelId,id,{header:projectRestoreETag(review),token:review.token,actorId:null},hooks)
}
const databases:ReturnType<typeof openDatabase>[]=[]
const ownedTables={outputs:outputProfiles,presets:transmissionPresets,sources:liveSources,rules:scheduleRules,multiview:multiviewConfigs,destinations,guests:guestKeys,graphics:graphicTemplates,rundowns,items:rundownItems,cues:itemGraphics,secondaryEvents}
async function fixture(){
  const value=openDatabase(':memory:');databases.push(value)
  const db=value.db,now='2026-10-05T12:00:00.000Z'
  for(const id of ['a','b']){
    db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now}).run()
    const rows={outputs:{id:'out-'+id,channelId:id,name:id,kind:'RTMP',target:'rtmp://localhost/live/fixture',enabled:false,createdAt:now},
      presets:{id:'preset-'+id,channelId:id,name:id,kind:'RTMP',target:'rtmp://localhost/live/fixture',createdAt:now},
      sources:{id:'source-'+id,channelId:id,name:id,kind:'NDI',targetUrl:'ndi:CAM-'+id,createdAt:now},
      rules:{id:'rule-'+id,channelId:id,name:id,weekdays:'0123456',startMinute:0,endMinute:60,categories:[],avoidHours:0,createdAt:now},
      multiview:{id:'multi-'+id,channelId:id,cells:[],updatedAt:now},
      destinations:{id:'dest-'+id,channelId:id,name:id,url:'rtmp://localhost/live/fixture',enabled:false,createdAt:now},
      guests:{id:'guest-'+id,channelId:id,label:id,streamKey:'FIXTURE_NOT_A_REAL_KEY_'+id,enabled:false,createdAt:now},
      graphics:{id:'cg-'+id,channelId:id,name:id,svg:'<svg/>',fields:[],fadeMs:0,createdAt:now},
      rundowns:{id:'rd-'+id,channelId:id,name:id,date:'2026-10-05',plannedStart:0,loop:false,createdAt:now,updatedAt:now},
      items:{id:'item-'+id,rundownId:'rd-'+id,sortOrder:0,title:id,type:'LIVE',durationOverride:250,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false},
      cues:{id:'cue-'+id,itemId:'item-'+id,templateId:'cg-'+id,values:{},atSeconds:2,createdAt:now},
      secondaryEvents:{id:'event-'+id,channelId:id,itemId:'item-'+id,definition:{id:'event-'+id,rundownItemId:'item-'+id,targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'cg-'+id,payload:{},enabled:true},createdAt:now,updatedAt:now},
    }
    for(const [key,table] of Object.entries(ownedTables))db.insert(table).values(rows[key as keyof typeof rows] as never).run()
  }
  const project=await saveChannelProject(db,'a','Antes')
  const payload=structuredClone(db.select().from(channelProjectSnapshots).where(eq(channelProjectSnapshots.id,project.id)).get()!.payload) as any
  const state=()=>Object.fromEntries(Object.entries({...ownedTables,channels,operatorDecisions,channelConfigurationVersions,channelProjectVersions,channelProjectSnapshots}).map(([key,table])=>[key,db.select().from(table).all()]))
  const tamper=()=>db.update(channelProjectSnapshots).set({payload}).where(eq(channelProjectSnapshots.id,project.id)).run()
  return {...value,project,payload,state,tamper}
}
afterEach(()=>{for(const value of databases.splice(0)) value.sqlite.close()})

describe('conteúdo semântico é conferido antes de remover/gravar projeto',()=>{
  const level={mode:'MANUAL',gainDb:0,measured:null}
  const multiview={id:'cell',name:'QA',sourceUrl:'ndi:CAM',tally:'OFFLINE',audioPeakDb:[-90,-90],syncState:'LOST'}
  it('captura também recusa configuração inválida sem gravar snapshot/auditoria',async()=>{
    const f=await fixture();f.db.update(rundownItems).set({anchor:{kind:'WINDOW',from:100,to:50,priority:5}}).where(eq(rundownItems.id,'item-a')).run()
    const before=f.state()
    await expect(saveChannelProject(f.db,'a','Não deve salvar',{authorize:()=>{},audit:()=>{throw new Error('Não deve chegar')}})).rejects.toThrow('Conteúdo inválido')
    expect(f.state()).toEqual(before)
  })
  it.each([
    ['scan',(p:any):unknown=>p.channel.scan='AUTO'],['field order',(p:any):unknown=>p.channel.fieldOrder='X'],['geometria',(p:any):unknown=>p.channel.width=99999],['loudness',(p:any):unknown=>p.channel.targetLufs=100],
    ['QC',(p:any):unknown=>p.channel.qcProfile={codecs:[],width:null,height:null,fps:null,scan:'ANY',requireAudio:true,minDurationSeconds:0,requireLoudness:true,minLufs:-10,maxLufs:-30,maxTruePeakDbtp:-1}],
    ['cadência nativa',(p:any):unknown=>p.channel.rateNum=2**31],['cadência saída nativa',(p:any):unknown=>Object.assign(p.outputs[0],{rateNum:2**31,rateDen:1})],
    ['tipo saída',(p:any):unknown=>p.outputs[0].kind='HTTP'],['papel saída',(p:any):unknown=>p.outputs[0].role='ROOT'],['URL saída',(p:any):unknown=>p.outputs[0].target='srt://localhost:9000'],['cadência saída',(p:any):unknown=>p.outputs[0].rateNum=25],['bitrate',(p:any):unknown=>p.outputs[0].bitrateKbps=-1],
    ['preview pesado',(p:any):unknown=>Object.assign(p.outputs[0],{role:'PREVIEW',width:1920,height:1080,rateNum:25,rateDen:1,scan:'PROGRESSIVE',bitrateKbps:10000})],
    ['preset',(p:any):unknown=>p.presets[0].kind='FILE'],['URL preset',(p:any):unknown=>p.presets[0].target='srt://localhost:9000'],
    ['tipo fonte',(p:any):unknown=>p.sources[0].kind='NMOS'],['papel fonte',(p:any):unknown=>p.sources[0].role='MAIN'],['par próprio',(p:any):unknown=>p.sources[0].pairedSourceId=p.sources[0].id],
    ['SRT malformado',(p:any):void=>{p.sources[0].kind='SRT';p.sources[0].srtConfig={mode:'caller',host:'localhost',port:70000,latencyMs:800}}],
    ['SRT em NDI',(p:any):unknown=>p.sources[0].srtConfig={mode:'caller',host:'localhost',port:9000,latencyMs:800}],
    ['failover',(p:any):unknown=>p.sources[0].failoverConfig={autoFailover:true,maxLossPercent:101,maxTimeoutMs:1500,maxRttMs:2400,switchDelayMs:120}],
    ['dias',(p:any):unknown=>p.rules[0].weekdays='7'],['dias duplicados',(p:any):unknown=>p.rules[0].weekdays='11'],['faixa',(p:any):unknown=>p.rules[0].endMinute=0],['categorias',(p:any):unknown=>p.rules[0].categories=[{}]],
    ['faixas sobrepostas',(p:any):unknown=>p.rules.push({...p.rules[0],id:'new-rule',startMinute:30,endMinute:90})],
    ['layout',(p:any):unknown=>p.multiview[0].layout='UNKNOWN'],['célula',(p:any):unknown=>p.multiview[0].cells=[{...multiview,tally:'PGM'}]],['IDs células',(p:any):unknown=>p.multiview[0].cells=[multiview,multiview]],
    ['grafismo campos',(p:any):unknown=>p.graphics[0].fields=[{key:'k',label:'QA',defaultValue:0}]],['grafismo duplicado',(p:any):unknown=>p.graphics[0].fields=[{key:'k',label:'QA',defaultValue:''},{key:'k',label:'QA',defaultValue:''}]],['fade',(p:any):unknown=>p.graphics[0].fadeMs=-1],
    ['data',(p:any):unknown=>p.rundowns[0].date='2026-02-30'],['zonas',(p:any):unknown=>p.rundowns[0].protectedZones=[{id:'z',label:'QA',from:100,to:50,priority:5}]],
    ['tipo item',(p:any):unknown=>p.items[0].type='AOVIVO'],['ordem',(p:any):unknown=>p.items[0].sortOrder=-1],['âncora',(p:any):unknown=>p.items[0].anchor={kind:'WINDOW',from:100,to:50,priority:1}],['âncora desconhecida',(p:any):unknown=>p.items[0].anchor={kind:'FLOW',at:100}],
    ['corte',(p:any):unknown=>p.items[0].trim={in:100,out:50}],['corte desconhecido',(p:any):unknown=>p.items[0].trim={in:0,out:50,hidden:true}],['elástico',(p:any):unknown=>p.items[0].elastic={min:100,max:50}],['overrun',(p:any):unknown=>p.items[0].onOverrun='CUT'],
    ['roteamento',(p:any):unknown=>p.items[0].audio={...level,routing:{mode:'MATRIX',matrix:[[1],[1,0]]}}],['mix duplicado',(p:any):unknown=>p.items[0].audio={...level,routing:{mode:'PAIR_MIX',pairs:[0,0]}}],['ganho',(p:any):unknown=>p.items[0].audio={...level,gainDb:21}],
    ['duração live',(p:any):unknown=>Object.assign(p.items[0],{liveEstimatedDuration:100,liveMaxDuration:50})],['tipo live',(p:any):unknown=>p.items[0].liveSourceType='IP'],
    ['identidade vazia de entrada',(p:any):unknown=>p.items[0].configuredSourceId=''],
    ['identidade enorme de entrada',(p:any):unknown=>p.items[0].configuredSourceId='x'.repeat(201)],
    ['identidade live em arquivo',(p:any):unknown=>Object.assign(p.items[0],{type:'VT',configuredSourceId:'configured'})],
    ['deixa',(p:any):unknown=>p.cues[0].values={name:10}],['offset',(p:any):unknown=>p.cues[0].atSeconds=-1],
    ['evento camada',(p:any):unknown=>p.secondaryEvents[0].definition.targetLayer='ALL'],['evento disparo',(p:any):unknown=>p.secondaryEvents[0].definition.triggerMode='AUTO'],['evento comando escondido',(p:any):unknown=>p.secondaryEvents[0].definition.deviceConfig={token:'DO_NOT_LEAK'}],['evento executado',(p:any):unknown=>p.secondaryEvents[0].definition.executionState='EXECUTED'],
    ['SCTE PTS',(p:any):unknown=>Object.assign(p.secondaryEvents[0].definition,{type:'SCTE_TRIGGER',scteConfig:{spliceEventId:1,ptsTime:2**33,autoReturn:false,prerollMs:0}})],
  ] as const)('recusa %s na prévia e novamente no commit, sem normalização ou vazamento',async(_label,mutate)=>{
    const f=await fixture();mutate(f.payload);f.tamper();const before=f.state()
    expect(()=>reviewChannelProject(f.db,'a',f.project.id,null)).toThrow('Conteúdo inválido')
    const header=projectRestoreETag({channelId:'a',projectId:f.project.id,projectRevision:projectRevision(f.db,'a')})
    await expect(guardedRestore(f.db,'a',f.project.id,{header,token:'0'.repeat(64),actorId:null})).rejects.toThrow('Conteúdo inválido')
    expect(f.state()).toEqual(before)
  })
  it('projeto legado sem identidade cadastral restaura sem inferir pelo endpoint',async()=>{
    const f=await fixture()
    delete f.payload.items[0].configuredSourceId
    f.payload.items[0].sourceRef='ndi:CAM-a'
    f.tamper()
    await restoreChannelProject(f.db,'a',f.project.id)
    expect(f.db.select().from(rundownItems).where(eq(rundownItems.id,'item-a')).get()?.configuredSourceId).toBeNull()
  })
  it('captura e restaura a escolha explícita sem substituí-la por outro cadastro',async()=>{
    const f=await fixture()
    f.db.update(rundownItems).set({configuredSourceId:'source-a',sourceRef:'ndi:CAM-a'}).where(eq(rundownItems.id,'item-a')).run()
    const saved=await saveChannelProject(f.db,'a','Identidade selecionada')
    f.db.update(rundownItems).set({configuredSourceId:null}).where(eq(rundownItems.id,'item-a')).run()
    await restoreChannelProject(f.db,'a',saved.id)
    expect(f.db.select().from(rundownItems).where(eq(rundownItems.id,'item-a')).get()?.configuredSourceId).toBe('source-a')
    expect(f.db.select().from(rundownItems).where(eq(rundownItems.id,'item-b')).get()?.configuredSourceId).toBeNull()
  })
  it('captura recusa pauta sobreposta sem descartar faixas nem registrar sucesso',async()=>{
    const f=await fixture()
    f.db.insert(scheduleRules).values({...f.payload.rules[0],id:'new-rule',startMinute:30,endMinute:90}).run()
    const before=f.state();await expect(saveChannelProject(f.db,'a','Overlap')).rejects.toThrow('Conteúdo inválido');expect(f.state()).toEqual(before)
  })
  it.each(['adjacent','distinct-days'])('projeto aceita faixas não sobrepostas: %s',async kind=>{
    const f=await fixture();f.payload.rules[0].weekdays='0'
    f.payload.rules.push({...f.payload.rules[0],id:'new-rule',...(kind==='adjacent'?{startMinute:60,endMinute:120}:{weekdays:'1'})});f.tamper()
    await restoreChannelProject(f.db,'a',f.project.id);expect(f.db.select().from(scheduleRules).all().filter(row=>row.channelId==='a')).toHaveLength(2)
  })
  it('aceita JSONs válidos e deixa legado sem tipo como grafismo, sem alterar o payload',async()=>{
    const f=await fixture();f.payload.items[0].audio={...level,routing:{mode:'MATRIX',matrix:[[1,0],[0,1]]}}
    f.payload.items[0].trim={in:0,out:100};f.payload.items[0].elastic={min:50,max:100};f.payload.multiview[0].cells=[multiview]
    f.payload.rundowns[0].protectedZones=[{id:'z',label:'QA',from:10,to:20,priority:5}];f.tamper()
    const snapshotBefore=f.db.select().from(channelProjectSnapshots).all()
    await restoreChannelProject(f.db,'a',f.project.id)
    expect(f.db.select().from(channelProjectSnapshots).all()).toEqual(snapshotBefore)
    expect(f.db.select().from(rundownItems).where(eq(rundownItems.id,'item-a')).get()?.audio).toEqual(f.payload.items[0].audio)
  })
  it('confere referência de equipamento sem enviar comando ou persistir hash operacional',async()=>{
    const f=await fixture();f.db.insert(externalDevices).values({id:'router',name:'QA',kind:'VIDEOHUB_ROUTER',host:'127.0.0.1',port:9990,enabled:true,createdAt:'now'}).run()
    Object.assign(f.payload.secondaryEvents[0].definition,{type:'DEVICE_AUTOMATION',deviceConfig:{deviceId:'router',targetDevice:'VIDEOHUB_ROUTER',action:'ROUTE_CROSSPOINT',params:{source:0,destination:0}}});f.tamper()
    reviewChannelProject(f.db,'a',f.project.id,null)
    expect(f.db.select().from(operatorDecisions).all()).toHaveLength(0)
    expect(f.db.select().from(channelProjectSnapshots).get()?.payload).not.toHaveProperty('secondaryEvents.0.definition.deviceConfig.configurationHash')
    f.db.update(externalDevices).set({enabled:false}).where(eq(externalDevices.id,'router')).run()
    expect(()=>reviewChannelProject(f.db,'a',f.project.id,null)).toThrow('Conteúdo inválido')
  })
  it('conserva estrutura de medição e SCTE editorial válidos sem aprovar AUTO ou executar evento',async()=>{
    const f=await fixture()
    f.payload.items[0].audio={...level,analysisId:'11111111-1111-4111-8111-111111111111',measured:{integratedLufs:-23,lra:5,truePeakDbtp:-1,scope:'TRIM',measuredAt:'now',input:{contentHash:'sha',audioTrack:0,routing:{mode:'DEFAULT'}}}}
    Object.assign(f.payload.secondaryEvents[0].definition,{type:'SCTE_TRIGGER',scteConfig:{spliceEventId:1,ptsTime:90000,autoReturn:true,prerollMs:500,durationSeconds:30}});f.tamper()
    await restoreChannelProject(f.db,'a',f.project.id)
    expect(f.db.select().from(rundownItems).where(eq(rundownItems.id,'item-a')).get()?.audio).toEqual(f.payload.items[0].audio)
    expect(f.db.select().from(secondaryEvents).where(eq(secondaryEvents.id,'event-a')).get()?.definition).toEqual(f.payload.secondaryEvents[0].definition)
    expect(f.db.select().from(operatorDecisions).all()).toHaveLength(0)
  })
})

describe('conferência original durável de projeto',()=>{
  const guard=(review:ReturnType<typeof reviewChannelProject>,actorId:string|null=null)=>({header:projectRestoreETag(review),token:review.token,actorId})
  it('recusa confirmação cega, malformada e vinculada a outro projeto/canal',async()=>{
    const f=await fixture(),before=f.state(),review=reviewChannelProject(f.db,'a',f.project.id,null)
    for(const proof of [{header:undefined,token:undefined,actorId:null},{...guard(review),header:'*'},{...guard(review),header:projectRestoreETag({...review,channelId:'b'})},{...guard(review),token:'bad'}])await expect(guardedRestore(f.db,'a',f.project.id,proof)).rejects.toThrow()
    expect(f.state()).toEqual(before)
  })
  it('conferência é somente leitura, estável e não expõe URLs/chaves/payload',async()=>{
    const f=await fixture(),before=f.state(),revision=projectRevision(f.db,'a')
    const first=reviewChannelProject(f.db,'a',f.project.id,'actor')
    expect(reviewChannelProject(f.db,'a',f.project.id,'actor')).toEqual(first)
    expect(first).toMatchObject({replacing:{sources:1,items:1},restoring:{sources:1,items:1},automaticTake:false,physicalOutputValidated:false})
    const text=JSON.stringify(first);expect(text).not.toContain('rtmp://');expect(text).not.toContain('FIXTURE_NOT_A_REAL_KEY');expect(text).not.toContain('payload')
    expect(f.state()).toEqual(before);expect(projectRevision(f.db,'a')).toBe(revision)
  })
  it.each(Object.keys(ownedTables))('alteração e reversão ABA em %s invalida a revisão original',async key=>{
    const f=await fixture(),review=reviewChannelProject(f.db,'a',f.project.id,null),table=ownedTables[key as keyof typeof ownedTables]
    const row=f.db.select().from(table).all().find((value:any)=>value.id.endsWith('-a'))!
    // Even a same-value UPDATE is an observed durable write, not a content hash.
    f.db.update(table).set(row as never).where(eq(table.id,row.id)).run()
    const before=f.state();await expect(guardedRestore(f.db,'a',f.project.id,guard(review))).rejects.toThrow('mudaram');expect(f.state()).toEqual(before)
  })
  it('snapshot alterado e devolvido ao original não ressuscita a conferência',async()=>{
    const f=await fixture(),review=reviewChannelProject(f.db,'a',f.project.id,null)
    f.db.update(channelProjectSnapshots).set({label:'Outro'}).where(eq(channelProjectSnapshots.id,f.project.id)).run()
    f.db.update(channelProjectSnapshots).set({label:'Antes'}).where(eq(channelProjectSnapshots.id,f.project.id)).run()
    await expect(guardedRestore(f.db,'a',f.project.id,guard(review))).rejects.toThrow('mudaram')
  })
  it('vincula sessão e aceita a revisão uma única vez',async()=>{
    const f=await fixture(),review=reviewChannelProject(f.db,'a',f.project.id,'one')
    await expect(guardedRestore(f.db,'a',f.project.id,guard(review,'two'))).rejects.toThrow('sessão')
    await guardedRestore(f.db,'a',f.project.id,guard(review,'one'))
    await expect(guardedRestore(f.db,'a',f.project.id,guard(review,'one'))).rejects.toThrow('mudaram')
  })
  it('falha atômica conserva o contador e a prova original para tentativa explícita',async()=>{
    const f=await fixture(),review=reviewChannelProject(f.db,'a',f.project.id,null),revision=projectRevision(f.db,'a')
    await expect(guardedRestore(f.db,'a',f.project.id,guard(review),{authorize:()=>{},audit:()=>{throw new Error('rollback')}})).rejects.toThrow('rollback')
    expect(projectRevision(f.db,'a')).toBe(revision)
    await guardedRestore(f.db,'a',f.project.id,guard(review))
  })
  it('triggers sobrevivem à validação; ausência e overflow falham sem restaurar dados',async()=>{
    const f=await fixture();validateProjectRevisions(f.sqlite)
    f.sqlite.prepare('UPDATE channel_project_versions SET version=? WHERE channel_id=?').run(Number.MAX_SAFE_INTEGER,'a')
    const before=f.state();expect(()=>f.db.update(channels).set({width:640}).where(eq(channels.id,'a')).run()).toThrow();expect(f.state()).toEqual(before)
    f.sqlite.exec('DROP TRIGGER project_revision_rundown_items_update')
    expect(()=>validateProjectRevisions(f.sqlite)).toThrow('ausente ou alterada')
  })
})

describe('projetos preservam a programação editorial de gráficos',()=>{
  it('restaura deixas e eventos sem apagar os de outro canal',async()=>{
    const value=openDatabase(':memory:');databases.push(value)
    const db=value.db,now=new Date().toISOString()
    for(const id of ['a','b']) {
      await db.insert(channels).values({id,name:id,rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:now})
      await db.insert(rundowns).values({id:'rd-'+id,channelId:id,name:id,date:'2026-09-30',plannedStart:0,loop:false,createdAt:now,updatedAt:now})
      await db.insert(rundownItems).values({id:'item-'+id,rundownId:'rd-'+id,sortOrder:0,title:id,type:'LIVE',durationOverride:250,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false})
      await db.insert(graphicTemplates).values({id:'cg-'+id,channelId:id,name:id,svg:'<svg>'+id+'</svg>',fields:[],fadeMs:0,createdAt:now})
      await db.insert(itemGraphics).values({id:'cue-'+id,itemId:'item-'+id,templateId:'cg-'+id,values:{},atSeconds:2,createdAt:now})
      const definition={id:'event-'+id,channelId:id,rundownItemId:'item-'+id,targetLayer:'LOWER_THIRD' as const,triggerMode:'MANUAL' as const,offsetFrames:0,templateId:'cg-'+id,payload:{},enabled:true}
      await db.insert(secondaryEvents).values({id:definition.id,channelId:id,itemId:'item-'+id,definition,createdAt:now,updatedAt:now})
    }
    const project=await saveChannelProject(db,'a','Antes')
    await db.insert(operationalPlaylistRevisions).values({id:'pub-a',rundownId:'rd-a',revision:1,state:'PUBLISHED',active:true,payload:{version:1,evidence:'immutable'},publishedAt:now})
    await db.delete(itemGraphics).where(eq(itemGraphics.itemId,'item-a'))
    await db.delete(secondaryEvents).where(eq(secondaryEvents.channelId,'a'))
    await restoreChannelProject(db,'a',project.id)
    expect((await db.select().from(itemGraphics)).map(row=>row.id).sort()).toEqual(['cue-a','cue-b'])
    expect((await db.select().from(secondaryEvents)).map(row=>row.id).sort()).toEqual(['event-a','event-b'])
    expect((await db.select().from(operationalPlaylistRevisions)).map(row=>row.id)).toEqual(['pub-a'])
    const [snapshot]=await db.select().from(channelProjectSnapshots)
    expect((snapshot!.payload as any).secondaryEvents[0].id).toBe('event-a')
    await expect(restoreChannelProject(db,'b',project.id)).rejects.toThrow('não pertence')
    await db.update(channels).set({rateNum:50}).where(eq(channels.id,'a'))
    await expect(restoreChannelProject(db,'a',project.id)).rejects.toThrow('cadência')
    expect((await db.select().from(channels).where(eq(channels.id,'a')))[0]!.rateNum).toBe(50)
    await db.update(channels).set({rateNum:25}).where(eq(channels.id,'a'))
    await db.insert(rundowns).values({id:'new-a',channelId:'a',name:'Nova publicada',date:'2026-10-01',plannedStart:0,loop:false,createdAt:now,updatedAt:now})
    await db.insert(operationalPlaylistRevisions).values({id:'pub-new',rundownId:'new-a',revision:1,state:'PUBLISHED',active:true,payload:{version:1},publishedAt:now})
    await expect(restoreChannelProject(db,'a',project.id)).rejects.toThrow('histórico publicado')
    expect((await db.select().from(operationalPlaylistRevisions)).map(row=>row.id).sort()).toEqual(['pub-a','pub-new'])
  })
})

describe('restauração não escreve fora do canal e é atômica',()=>{
  it.each(Object.keys(ownedTables))('recusa colisão de ID em %s sem apagar dados',async key=>{
    const f=await fixture(),foreign=f.db.select().from(ownedTables[key as keyof typeof ownedTables]).all()[1]!
    f.payload[key][0].id=foreign.id;f.tamper();const before=f.state()
    await expect(restoreChannelProject(f.db,'a',f.project.id)).rejects.toThrow('outro canal')
    expect(f.state()).toEqual(before)
  })
  it.each([
    ['dono de registro',(p:any):void=>{p.outputs[0].channelId='b'}],
    ['grade de item',(p:any):void=>{p.items[0].rundownId='rd-b'}],
    ['modelo de deixa',(p:any):void=>{p.cues[0].templateId='cg-b'}],
    ['item de evento',(p:any):void=>{p.secondaryEvents[0].definition.rundownItemId='item-b'}],
    ['canal de evento',(p:any):void=>{p.secondaryEvents[0].definition.channelId='b'}],
    ['slate estrangeiro',(p:any):void=>{p.channel.slateTemplateId='cg-b'}],
    ['fonte pareada',(p:any):void=>{p.sources[0].pairedSourceId='source-b'}],
    ['mídia ausente',(p:any):void=>{p.items[0].mediaId='missing'}],
    ['seção truncada',(p:any):void=>{delete p.outputs}],
    ['seção inválida',(p:any):void=>{p.outputs={}}],
    ['ID duplicado',(p:any):void=>{p.items.push({...p.items[0]})}],
    ['tipo de campo',(p:any):void=>{p.channel.width='320'}],
    ['formato inválido',(p:any):void=>{p.channel.rateDen=0}],
    ['campo desconhecido',(p:any):void=>{p.channel.unknown=true}],
  ] as const)('recusa %s antes de qualquer remoção',async(_name,mutate)=>{
    const f=await fixture();mutate(f.payload);f.tamper();const before=f.state()
    await expect(restoreChannelProject(f.db,'a',f.project.id)).rejects.toThrow()
    expect(f.state()).toEqual(before)
  })
  it('não remove por cascata uma deixa estrangeira que referencia modelo deste canal',async()=>{
    const f=await fixture()
    f.db.update(itemGraphics).set({templateId:'cg-a'}).where(eq(itemGraphics.id,'cue-b')).run()
    const before=f.state()
    await expect(restoreChannelProject(f.db,'a',f.project.id)).rejects.toThrow('outro canal')
    expect(f.state()).toEqual(before)
  })
  it.each(['event','slate'])('recusa modelo local utilizado por %s de outro canal',async kind=>{
    const f=await fixture()
    if(kind==='event')f.db.update(secondaryEvents).set({definition:{...f.payload.secondaryEvents[0].definition,id:'event-b',rundownItemId:'item-b',templateId:'cg-a'}}).where(eq(secondaryEvents.id,'event-b')).run()
    else f.db.update(channels).set({slateTemplateId:'cg-a'}).where(eq(channels.id,'b')).run()
    const before=f.state();await expect(restoreChannelProject(f.db,'a',f.project.id)).rejects.toThrow('outro canal');expect(f.state()).toEqual(before)
  })
  it.each(['import','asrun'])('não remove uma grade que possui histórico %s',async kind=>{
    const f=await fixture(),now=new Date().toISOString()
    f.db.insert(rundowns).values({id:'old-a',channelId:'a',name:'Com histórico',date:'2026-10-05',plannedStart:0,loop:false,createdAt:now,updatedAt:now}).run()
    if(kind==='import')f.db.insert(playlistVersions).values({id:'import-a',rundownId:'old-a',sourceName:'fixture',mode:'APPEND',loaded:1,skipped:0,publishedAt:now}).run()
    else f.db.insert(asRun).values({id:'as-a',channelId:'a',rundownId:'old-a',title:'Fixture',type:'LIVE',startedAt:now,actualStart:0,createdAt:now}).run()
    const before=f.state(),imports=f.db.select().from(playlistVersions).all(),history=f.db.select().from(asRun).all()
    await expect(restoreChannelProject(f.db,'a',f.project.id)).rejects.toThrow('histórico')
    expect(f.state()).toEqual(before);expect(f.db.select().from(playlistVersions).all()).toEqual(imports);expect(f.db.select().from(asRun).all()).toEqual(history)
  })
  it('substitui eventos do canal e conserva os demais, inclusive em restauração repetida',async()=>{
    const f=await fixture()
    f.db.update(secondaryEvents).set({definition:{...f.payload.secondaryEvents[0].definition,offsetFrames:999}}).where(eq(secondaryEvents.id,'event-a')).run()
    await restoreChannelProject(f.db,'a',f.project.id);await restoreChannelProject(f.db,'a',f.project.id)
    expect(f.db.select().from(secondaryEvents).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({id:'event-a',definition:expect.objectContaining({offsetFrames:0})}),expect.objectContaining({id:'event-b'}),
    ]))
  })
  it('falha de auditoria reverte restauração e counter de configuração',async()=>{
    const f=await fixture();f.db.update(channels).set({width:640}).where(eq(channels.id,'a')).run();const before=f.state()
    await expect(restoreChannelProject(f.db,'a',f.project.id,{authorize:()=>{},audit:()=>{throw new Error('QA audit rollback')}})).rejects.toThrow('QA audit rollback')
    expect(f.state()).toEqual(before)
  })
  it('captura e auditoria também revertem juntas',async()=>{
    const f=await fixture(),before=f.db.select().from(channelProjectSnapshots).all()
    await expect(saveChannelProject(f.db,'a','Falha',{authorize:()=>{},audit:()=>{throw new Error('QA capture audit')}})).rejects.toThrow('QA capture audit')
    expect(f.db.select().from(channelProjectSnapshots).all()).toEqual(before)
  })
  it('reconfere autorização na transação antes de ler/gravar o projeto',async()=>{
    const f=await fixture(),before=f.state()
    await expect(restoreChannelProject(f.db,'a',f.project.id,{authorize:()=>{throw new Error('QA revoked')},audit:()=>{throw new Error('não deve chegar')}})).rejects.toThrow('QA revoked')
    expect(f.state()).toEqual(before)
  })
})

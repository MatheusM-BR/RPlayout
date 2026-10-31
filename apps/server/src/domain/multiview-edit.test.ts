import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {multiviewETag} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {channels,multiviewConfigs,operatorDecisions} from '../db/schema.js'
import {multiviewRevision} from '../db/multiview-revisions.js'
import {editMultiview,readMultiviewReview,type MultiviewHooks} from './multiview-edit.js'
import {saveChannelProject} from './channel-projects.js'
let database:ReturnType<typeof openDatabase>,hooks:MultiviewHooks
const cell={id:'cell',name:'Studio çãó',sourceUrl:'srt://127.0.0.1:9000?passphrase=PRIVATE_MV_FIXTURE',tally:'ON_AIR' as const,audioPeakDb:[-12,-13] as [number,number],syncState:'LOCKED' as const}
beforeEach(()=>{
  database=openDatabase(':memory:')
  for(const id of ['a','b','default'])database.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  hooks={authorize:vi.fn(),audit:(tx,details)=>{tx.insert(operatorDecisions).values({id:String(Math.random()),rundownId:'@security',kind:'MULTIVIEW_EDITED',payload:details,createdAt:'now'}).run()}}
})
afterEach(()=>{database.sqlite.close();vi.restoreAllMocks()})
const review=(id:string|null='a')=>readMultiviewReview(database.db,id,hooks.authorize)
const header=(id:string|null='a')=>multiviewETag(id,review(id).revision)
const state=()=>({rows:database.sqlite.prepare('SELECT * FROM multiview_configs ORDER BY id').all(),versions:database.sqlite.prepare('SELECT * FROM multiview_versions ORDER BY scope').all(),projects:database.sqlite.prepare('SELECT * FROM channel_project_versions ORDER BY channel_id').all(),audit:database.sqlite.prepare('SELECT * FROM operator_decisions').all()})
describe('multiview só altera configuração explicitamente conferida',()=>{
  it('padrão é leitura estável, sem timestamp fabricado nem escrita',()=>{
    const before=state(),first=review();expect(review()).toEqual(first);expect(state()).toEqual(before)
    expect(first).toMatchObject({id:null,updatedAt:null,cells:[],layout:'GRID_2X2',storedTelemetryIsHistorical:true,automaticTake:false,physicalSignalValidated:false})
  })
  it('global e canal default não colidem, preservando ID e dados legados',()=>{
    database.db.insert(multiviewConfigs).values({id:'mv-default',channelId:'default',layout:'GRID_1_PLUS_3',cells:[cell],updatedAt:'original'}).run()
    const owned=review('default');expect(review(null).id).toBeNull()
    const global=editMultiview(database.db,{layout:'COMPACT_LIST'},header(null),hooks)
    expect(global.id).not.toBe('mv-default');expect(review('default')).toEqual(owned)
    editMultiview(database.db,{channelId:'default',layout:'COMPACT_LIST'},header('default'),hooks)
    expect(review('default').id).toBe('mv-default');expect(review(null)).toMatchObject({id:global.id,revision:global.revision,layout:'COMPACT_LIST'})
  })
  it.each([undefined,'junk','"multiview:C%3Ab:1"','"multiview:G:1"','"multiview:C%3Aa:9007199254740992"',[]])('recusa prova ausente/malformada/alvo errado %j',proof=>{
    const before=state();expect(()=>editMultiview(database.db,{channelId:'a',layout:'COMPACT_LIST'},proof,hooks)).toThrow();expect(state()).toEqual(before)
  })
  it('ABA, mesmo valor, alterações de fontes e mudanças do canal invalidam conferência',()=>{
    const saved=editMultiview(database.db,{channelId:'a',layout:'GRID_2X2',cells:[cell]},header(),hooks)
    const old=multiviewETag('a',saved.revision)
    database.sqlite.prepare('UPDATE multiview_configs SET layout=? WHERE id=?').run('COMPACT_LIST',saved.id)
    database.sqlite.prepare('UPDATE multiview_configs SET layout=? WHERE id=?').run('GRID_2X2',saved.id)
    const before=state();expect(()=>editMultiview(database.db,{channelId:'a',layout:'GRID_1_PLUS_3'},old,hooks)).toThrow();expect(state()).toEqual(before)
    const fresh=header();database.sqlite.prepare("UPDATE channels SET name=name WHERE id='a'").run()
    expect(()=>editMultiview(database.db,{channelId:'a',layout:'COMPACT_LIST'},fresh,hooks)).toThrow()
  })
  it('falha de auditoria reverte configuração, contadores e sucesso',()=>{
    const old=header(),before=state();hooks.audit=()=>{throw new Error('audit unavailable')}
    expect(()=>editMultiview(database.db,{channelId:'a',layout:'COMPACT_LIST',cells:[cell]},old,hooks)).toThrow('audit unavailable')
    expect(state()).toEqual(before)
    hooks.audit=(tx)=>{tx.insert(operatorDecisions).values({id:'audit',rundownId:'@security',kind:'MULTIVIEW_EDITED',payload:{},createdAt:'now'}).run()}
    const saved=editMultiview(database.db,{channelId:'a',layout:'COMPACT_LIST',cells:[cell]},old,hooks)
    const proof=header(),updated=state();hooks.audit=()=>{throw new Error('audit unavailable')}
    expect(()=>editMultiview(database.db,{channelId:'a',layout:'GRID_2X2'},proof,hooks)).toThrow()
    expect(state()).toEqual(updated);expect(review().id).toBe(saved.id)
  })
  it('layout-only preserva conexão privada/células, retorno e auditoria não vazam URI',()=>{
    editMultiview(database.db,{channelId:'a',layout:'GRID_2X2',cells:[cell]},header(),hooks)
    const saved=editMultiview(database.db,{channelId:'a',layout:'COMPACT_LIST'},header(),hooks)
    expect(database.db.select().from(multiviewConfigs).get()?.cells?.[0]?.sourceUrl).toBe(cell.sourceUrl)
    expect(saved.cells[0]?.sourceUrl).toMatch(/^srt:protected:v1:/)
    expect(JSON.stringify(saved)).not.toContain('PRIVATE_MV_FIXTURE')
    expect(JSON.stringify(database.db.select().from(operatorDecisions).all())).not.toContain('PRIVATE_MV_FIXTURE')
  })
  it.each([{layout:'fake'},{layout:'GRID_2X2',extra:true},{layout:'GRID_2X2',cells:[cell,cell]},{layout:'GRID_2X2',cells:[{...cell,audioPeakDb:[NaN,0]}]},{layout:'GRID_2X2',cells:[{...cell,srtTelemetry:{secret:'x'}}]},{layout:'GRID_2X2',cells:Array.from({length:65},(_,i)=>({...cell,id:String(i)}))}])('recusa schema sem gravar %j',body=>{
    const before=state();expect(()=>editMultiview(database.db,{channelId:'a',...body},header(),hooks)).toThrow();expect(state()).toEqual(before)
  })
  it('dono ausente/arquivado é recusado, global não requer canal fictício',()=>{
    expect(()=>readMultiviewReview(database.db,'missing',hooks.authorize)).toThrow()
    database.sqlite.prepare("UPDATE channels SET archived_at='now' WHERE id='a'").run()
    const before=state();expect(()=>editMultiview(database.db,{channelId:'a',layout:'COMPACT_LIST'},multiviewETag('a',multiviewRevision(database.db,'a')),hooks)).toThrow();expect(state()).toEqual(before)
    expect(editMultiview(database.db,{layout:'GRID_2X2'},header(null),hooks).channelId).toBeNull()
  })
  it('duplicata legada é conflito explícito e não passa para snapshot restaurável',async()=>{
    for(const id of ['legacy1','legacy2'])database.db.insert(multiviewConfigs).values({id,channelId:'a',layout:'GRID_2X2',cells:[],updatedAt:'now'}).run()
    const before=state();expect(()=>review()).toThrow();expect(()=>editMultiview(database.db,{channelId:'a',layout:'COMPACT_LIST'},multiviewETag('a',multiviewRevision(database.db,'a')),hooks)).toThrow();expect(state()).toEqual(before)
    await expect(saveChannelProject(database.db,'a','duplicate')).rejects.toMatchObject({status:400})
  })
})

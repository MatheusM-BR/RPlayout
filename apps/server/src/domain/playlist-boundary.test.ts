import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../db/client.js'
import { channels, rundowns, rundownItems, mediaAssets, operationalPlaylistRevisions, operatorDecisions, users, qcDecisions } from '../db/schema.js'
import { getChannel } from '../db/repo.js'
import { publishOperationalPlaylist } from './operational-playlist.js'
import { inspectBoundary, PlaylistBoundaryLedger, requireBoundaryReview, boundaryProcessesGone } from './playlist-boundary.js'

vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),DEFAULT_ROLE:'ADMIN',AUTH_USER:'',AUTH_PASSWORD:''}))
let database:ReturnType<typeof openDatabase>,source:string,target:string
const owner={userId:null,username:null}
beforeEach(async()=>{
  database=openDatabase(':memory:');const stamp=new Date().toISOString()
  database.db.insert(channels).values({id:'ch',name:'Canal',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:stamp}).run()
  database.db.insert(mediaAssets).values({id:'asset',title:'VT',path:'C:/AÇÃO.mp4',contentHash:'a'.repeat(64),kind:'VIDEO',durationFrames:250,rateNum:25,rateDen:1,qcStatus:'APPROVED',createdAt:stamp}).run()
  for(const id of ['source','target']){
    database.db.insert(rundowns).values({id,channelId:'ch',name:id,date:'2026-10-02',plannedStart:0,loop:false,createdAt:stamp,updatedAt:stamp}).run()
    database.db.insert(rundownItems).values({id:'vt-'+id,rundownId:id,sortOrder:0,title:id,type:'VT',mediaId:'asset',durationOverride:250,minDuration:0,anchor:{kind:'FLOW'},onOverrun:'PUSH',autoNext:true,loop:false,locked:false}).run()
  }
  const ch=(await getChannel(database.db,'ch'))!
  source=(await publishOperationalPlaylist(database.db,ch,'source',null)).id
  target=(await publishOperationalPlaylist(database.db,ch,'target',null)).id
})
afterEach(()=>{database.sqlite.close();vi.restoreAllMocks()})
const inspect=()=>inspectBoundary(database.db,'ch',source,target,owner)
const ledger=()=>new PlaylistBoundaryLedger(database.db,'ch')
describe('passagem de playlist publicada é revisão + intenção durável de um EOS',()=>{
  it('consulta é estável e editorial posterior não altera destino/revisão/hora aprovados',()=>{
    const before=database.db.select().from(operatorDecisions).all(),plan=inspect();expect(inspect()).toEqual(plan)
    database.db.update(rundowns).set({name:'RASCUNHO',date:'2026-10-04'}).where(eq(rundowns.id,'target')).run()
    database.db.update(rundownItems).set({title:'MUDOU',durationOverride:500}).where(eq(rundownItems.id,'vt-target')).run()
    expect(inspect()).toEqual(plan)
    expect(database.db.select().from(operatorDecisions).all()).toEqual(before)
  })
  it('QC/canal/republicação invalidam prova; não há fallback para primeiro VT diferente',async()=>{
    const plan=inspect();expect(()=>requireBoundaryReview(plan)).toThrow('Confira')
    database.db.update(channels).set({targetLufs:-24}).where(eq(channels.id,'ch')).run()
    expect(()=>requireBoundaryReview(inspect(),plan.token)).toThrow('mudou')
    database.db.insert(qcDecisions).values({id:'blocked',assetId:'asset',contentHash:'a'.repeat(64),channelId:'ch',status:'REJECTED',notes:'QC',checks:{playable:false,errors:['QC'],warnings:[]},actor:'qa',createdAt:new Date().toISOString()}).run()
    expect(inspect).toThrow('primeiro item')
  })
  it('loop de origem/hold/live aberto e datas inválidas não são chamados fim automático',()=>{
    const row=database.db.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.id,source)).get()!
    const original=row.payload
    for(const changed of [
      {...original,rundown:{...(original.rundown as object),loop:true}},
      {...original,items:[{...(original.items as any[])[0],autoNext:false}]},
      {...original,items:[{...(original.items as any[])[0],type:'LIVE',liveAutoFollowOnEnd:false}]},
      {...original,rundown:{...(original.rundown as object),date:'2026-02-30'}},
    ]) {database.db.update(operationalPlaylistRevisions).set({payload:changed}).where(eq(operationalPlaylistRevisions.id,source)).run();expect(inspect).toThrow()}
  })
  it('mesmo ID não repete intenção; há uma só pendência por canal e cancelamento permite outra',()=>{
    const plan=inspect(),first=ledger().enqueue('first',plan)
    expect(ledger().enqueue('first',plan)).toEqual(first)
    expect(()=>ledger().enqueue('second',plan)).toThrow('pendente')
    ledger().phase('first',['QUEUED'],'CANCELLED',()=>true)
    expect(ledger().enqueue('second',plan).state).toBe('QUEUED')
    expect(database.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind,'PLAYLIST_BOUNDARY')).all()).toHaveLength(2)
  })
  it('a intenção mais nova vence mesmo com relógio retrocedendo ou IDs em ordem inversa',()=>{
    ledger().enqueue('zzz-old',inspect());ledger().phase('zzz-old',['QUEUED'],'CANCELLED',()=>true)
    vi.useFakeTimers({toFake:['Date']})
    try {
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'))
      ledger().enqueue('aaa-new',inspect())
      expect(ledger().list().map(run=>run.id)).toEqual(['aaa-new','zzz-old'])
    } finally {vi.useRealTimers()}
  })
  it('claim único, cancelamento durante preparo e guarda antes de SWITCHING impedem TAKE',()=>{
    ledger().enqueue('id',inspect())
    ledger().phase('id',['QUEUED'],'PREPARING',()=>true,{processOwner:'node-a'})
    expect(()=>ledger().phase('id',['QUEUED'],'PREPARING',()=>true,{processOwner:'node-b'})).toThrow('mudou')
    expect(()=>ledger().phase('id',['PREPARING'],'SWITCHING',()=>false)).toThrow('mudou')
    ledger().phase('id',['PREPARING'],'CANCELLED',()=>true)
    expect(()=>ledger().phase('id',['PREPARING'],'SWITCHING',()=>true)).toThrow('mudou')
    expect(ledger().read('id')?.state).toBe('CANCELLED')
  })
  it('falta de confirmação fica incerta e bloqueia reenvio/new ID até conferência',()=>{
    ledger().enqueue('id',inspect());ledger().phase('id',['QUEUED'],'PREPARING',()=>true)
    ledger().phase('id',['PREPARING'],'SWITCHING',()=>true)
    ledger().phase('id',['SWITCHING'],'UNCERTAIN',()=>true,{message:'sem confirmação'})
    expect(()=>ledger().enqueue('new-id',inspect())).toThrow('incerta')
    expect(ledger().enqueue('id',inspect()).state).toBe('UNCERTAIN')
  })
  it('falha da auditoria de fase reverte estado e claim; nenhuma marca de troca parcial',()=>{
    ledger().enqueue('id',inspect())
    database.sqlite.exec("CREATE TRIGGER fail_phase BEFORE INSERT ON operator_decisions WHEN NEW.kind='PLAYLIST_BOUNDARY_PHASE' BEGIN SELECT RAISE(ABORT,'audit falhou'); END")
    expect(()=>ledger().phase('id',['QUEUED'],'PREPARING',()=>true)).toThrow('audit falhou')
    expect(ledger().read('id')?.state).toBe('QUEUED')
  })
  it('prova é vinculada ao dono/canal; desabilitar a conta invalida automação durável',()=>{
    database.db.insert(users).values({id:'owner',username:'owner',passwordHash:'unused',role:'PROGRAMMER',enabled:true,createdAt:new Date().toISOString()}).run()
    const actor={userId:'owner',username:'owner'},plan=inspectBoundary(database.db,'ch',source,target,actor)
    ledger().enqueue('id',plan)
    database.db.update(users).set({enabled:false}).where(eq(users.id,'owner')).run()
    expect(()=>inspectBoundary(database.db,'ch',source,target,actor)).toThrow('conta')
    expect(()=>ledger().enqueue('id',{...plan,owner:{userId:'other',username:'other'}})).toThrow('outro pedido')
    expect(()=>inspectBoundary(database.db,'other',source,target,actor)).toThrow('Canal')
  })
  it('owner remoto/desconhecido ou PID vivo nunca é considerado encerrado',()=>{
    const run=ledger().enqueue('id',inspect())
    expect(boundaryProcessesGone({...run,processOwner:'invalid'})).toBe(false)
    expect(boundaryProcessesGone({...run,processOwner:JSON.stringify({host:'NOT_THIS_HOST',pid:1,enginePid:2})})).toBe(false)
    expect(database.sqlite.prepare("SELECT payload FROM operator_decisions WHERE id='playlist-boundary:id'").get()).not.toEqual(expect.objectContaining({payload:expect.stringContaining('AÇÃO')}))
  })
})

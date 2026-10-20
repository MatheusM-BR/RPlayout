import {randomUUID,createHash} from 'node:crypto'
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises'
import {tmpdir,hostname} from 'node:os'
import {join} from 'node:path'
import Database from 'better-sqlite3'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {channels,rundowns,rundownItems,mediaAssets,operationalPlaylistRevisions,qcDecisions} from '../db/schema.js'
import {HaReplication,type HaOptions,type HaSnapshot} from './ha-replication.js'
import {HaRecovery} from './ha-recovery.js'
import {captureHaSnapshot} from './ha-snapshot.js'
import {createApp,type App,runtimeFor} from '../app.js'
import {inspectOperationalPlaylist,persistRevision} from './operational-playlist.js'
import {Checkpoints} from './checkpoints.js'
import {DEFAULT_QC_PROFILE} from '@rplayout/protocol'
import {installationVault} from './secret-vault.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:'',RELAY_BINARY:'',AUTH_USER:'',AUTH_PASSWORD:'',DEFAULT_ROLE:'ADMIN'}))
let directory:string,app:App,primary:HaReplication,reserve:HaReplication,path:string,source:HaSnapshot,revisionId:string
const data=Buffer.from('SOMENTE ENSAIO ORIGINAL ÇÃO'),hash=createHash('sha256').update(data).digest('hex'),key='ec'.repeat(32)
const config=(role:'PRIMARY'|'STANDBY'):HaOptions=>({role,clusterId:'restore',nodeId:role==='PRIMARY'?'a':'b',peerNodeId:role==='PRIMARY'?'b':'a',key,file:join(directory,role+'.db'),peerUrl:role==='PRIMARY'?'http://peer.invalid':null,mediaRoot:join(directory,role+'-media'),mediaMbit:1000})
const request=(sequence=reserve.status().sequence)=>({requestId:randomUUID(),channelId:'ch',sequence})
const copy=async()=>{for(let i=0;i<3;i++){await primary.mediaTick(async()=>path);await new Promise(resolve=>setTimeout(resolve,5))}}
const workspace=async()=>join(directory,'rehearsals',(await readdir(join(directory,'rehearsals')))[0]!,'operational.db')
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'RPlayout-ha-recovery-'));path=join(directory,'AÇÃO.mp4');await writeFile(path,data)
  app=await createApp(':memory:');const now=new Date().toISOString()
  app.db.insert(channels).values({id:'ch',name:'Canal ÇÃO',rateNum:25,rateDen:1,width:320,height:180,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,programSdiDeviceId:'foreign-board',createdAt:now}).run()
  app.db.insert(rundowns).values({id:'rd',channelId:'ch',name:'Grade congelada',plannedStart:0,loop:false,date:now.slice(0,10),createdAt:now,updatedAt:now}).run()
  app.db.insert(mediaAssets).values({id:'asset',contentHash:hash,path,title:'Original ÇÃO',kind:'VIDEO',durationFrames:500,createdAt:now}).run()
  app.db.insert(rundownItems).values({id:'vt',rundownId:'rd',sortOrder:0,title:'Publicado ÇÃO',type:'VT',mediaId:'asset',anchor:{kind:'FLOW'},minDuration:0,onOverrun:'PUSH',autoNext:false,loop:false,locked:false}).run()
  const revision=persistRevision(app.db,'rd',inspectOperationalPlaylist(app.db,'rd').payload,'tester');revisionId=revision.id
  new Checkpoints(app.sqlite).write({version:1,channelId:'ch',rundownId:'rd',revisionId,itemId:'vt',elapsed:73,playing:true,realEngine:true,rate:{num:25,den:1},audioChannels:2,executionId:'running'})
  app.db.insert(qcDecisions).values({id:'qc-global',assetId:'asset',contentHash:hash,channelId:'@all',status:'APPROVED',notes:'Verificado',checks:{playable:true,errors:[],warnings:[]},actor:'approver',createdAt:now}).run()
  source=captureHaSnapshot(app);source.channels[0]!.configuration.executionRevisionId=revision.id
  reserve=new HaReplication(config('STANDBY'),()=>{throw new Error('Não captura banco local')})
  primary=new HaReplication(config('PRIMARY'),()=>source,async(url,init)=>{const body=JSON.parse(String(init!.body)),headers=init!.headers as Record<string,string>;return new Response(JSON.stringify(String(url).endsWith('/media')?await reserve.receiveMedia(body,headers):reserve.receive(body,headers)))})
  await primary.tick()
})
afterEach(async()=>{primary.close();reserve.close();await Promise.all([primary.settled(),reserve.settled()]);app.close();vi.restoreAllMocks()})
describe('ensaio de restauração HA real em banco isolado e sem execução',()=>{
  // NOT_RUN: native cursor/crop regression added to the consolidated review.
  it('prepara cursor com corte/posse nativos em quarentena e conserva a intenção exata cifrada',async()=>{
    const original=(source.channels[0]!.checkpoint as any).value
    original.programTrim={in:10,out:400,contentHash:hash};original.ownerRunId='11111111-1111-4111-8111-111111111111';original.graphicReceiptId='foreign-graphic'
    await primary.tick();await copy();const asked=request(),report=await reserve.rehearse(asked)
    expect(report).toMatchObject({phase:'RESTORED',checkpointRestored:true,promotionReady:false,automaticTake:false})
    const restored=openDatabase(await workspace())
    try{
      const stopped=new Checkpoints(restored.sqlite).read('ch')!
      expect(stopped).toMatchObject({elapsed:73,playing:false,realEngine:false});expect(stopped.programTrim).toBeUndefined();expect(stopped.ownerRunId).toBeUndefined();expect(stopped.graphicReceiptId).toBeUndefined()
      const row=restored.sqlite.prepare('SELECT payload FROM ha_recovery_cursor WHERE id=1').get() as {payload:string}
      const saved=JSON.parse(installationVault(false).decrypt(row.payload,`ha-recovery:v1:restore:b:${asked.requestId}:cursor`))
      expect(saved).toMatchObject({version:1,request:asked,intent:{checkpoint:{elapsed:73,programTrim:{in:10,out:400,contentHash:hash},playing:true,realEngine:true},foreignOwnerRunId:original.ownerRunId,foreignGraphicReceiptId:'foreign-graphic',promotionReady:false}})
      expect(saved.intent.checkpoint.ownerRunId).toBeUndefined();expect(saved.intent.checkpoint.graphicReceiptId).toBeUndefined()
    }finally{restored.sqlite.close()}
    expect(original).toMatchObject({programTrim:{in:10,out:400,contentHash:hash},ownerRunId:'11111111-1111-4111-8111-111111111111',playing:true})
  })
  it('restaura publicação/cursor/QC em DB íntegro, arquivado e sem abrir canais ou saídas',async()=>{
    await copy();const report=await reserve.rehearse(request())
    expect(report).toMatchObject({phase:'RESTORED',restoredRevisions:1,verifiedMedia:1,qcBlocked:0,checkpointRestored:true,promotionReady:false,automaticTake:false,localProbeRequired:true})
    const restored=openDatabase(await workspace())
    try{
      expect(restored.sqlite.pragma('integrity_check',{simple:true})).toBe('ok')
      expect(restored.sqlite.pragma('foreign_key_check')).toEqual([])
      const channel=restored.db.select().from(channels).get()!
      expect(channel).toMatchObject({id:'ch',name:'Canal ÇÃO',programSdiDeviceId:null,slateTemplateId:null});expect(channel.archivedAt).toBeTruthy()
      expect(restored.db.select().from(operationalPlaylistRevisions).get()!.payload).toEqual(source.channels[0]!.revisions[0]!.payload)
      expect(new Checkpoints(restored.sqlite).read('ch')).toMatchObject({revisionId,itemId:'vt',elapsed:73,playing:false,realEngine:false,executionId:'running'})
      const asset=restored.db.select().from(mediaAssets).get()!
      expect(asset.path).toBe(join(directory,'STANDBY-media',hash+'.media'));expect(await readFile(asset.path)).toEqual(data)
      expect(asset).toMatchObject({qcStatus:'APPROVED',probeError:expect.stringContaining('sonda local')})
      for(const table of ['users','sessions','output_profiles','live_sources','operator_decisions','secondary_event_runs','as_run'])expect(restored.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0})
      const origin=restored.sqlite.prepare('SELECT payload FROM ha_recovery_origin').get() as {payload:string}
      expect(origin.payload).not.toContain('foreign-board');expect(origin.payload).not.toContain('Publicado ÇÃO')
      expect(JSON.parse(installationVault(false).decrypt(origin.payload,`ha-recovery:v1:restore:b:${report.requestId}:origin`)).channel.checkpoint.value.playing).toBe(true)
    }finally{restored.sqlite.close()}
    expect(app.db.select().from(channels).get()!.programSdiDeviceId).toBe('foreign-board')
    expect(new Checkpoints(app.sqlite).read('ch')!.playing).toBe(true)
    const restoredApp=await createApp(await workspace())
    try{
      expect(await runtimeFor(restoredApp,'ch')).toBeNull();expect(restoredApp.runtimes.size).toBe(0)
      restoredApp.sqlite.prepare("UPDATE channels SET archived_at=NULL WHERE id='ch'").run()
      expect(await runtimeFor(restoredApp,'ch')).toBeNull();expect(restoredApp.runtimes.size).toBe(0)
    }finally{restoredApp.close()}
  })
  it('pedido repetido depois de resposta perdida apenas consulta e sobrevive ao reinício',async()=>{
    await copy();const asked=request(),report=await reserve.rehearse(asked),file=await workspace()
    expect(await reserve.rehearse(asked)).toEqual(report)
    expect(await readdir(join(directory,'rehearsals'))).toHaveLength(1)
    reserve.close();await reserve.settled();reserve=new HaReplication(config('STANDBY'),()=>source)
    expect(reserve.recoveryStatus().reports).toEqual([report]);expect(await reserve.rehearse(asked)).toEqual(report)
    await expect(reserve.rehearse({...asked,channelId:'other'})).rejects.toThrow('outra edição/canal')
    expect(await workspace()).toBe(file)
  })
  it('não aprova por padrão quando só há APPROVED legado e nenhuma decisão por hash',async()=>{
    source.channels[0]!.configuration.qc=[];await primary.tick();await copy()
    expect(await reserve.rehearse(request())).toMatchObject({phase:'RESTORED',qcBlocked:1,promotionReady:false})
    const restored=openDatabase(await workspace())
    try{expect(restored.db.select().from(mediaAssets).get()).toMatchObject({qcStatus:'PENDING',ignored:true})}finally{restored.sqlite.close()}
  })
  it('recusa mídia ausente sem criar parcial de cópia ou usar o caminho primário',async()=>{
    expect(await reserve.rehearse(request())).toMatchObject({phase:'REFUSED',verifiedMedia:0})
    expect(await readdir(directory)).not.toContain('rehearsals')
    expect(reserve.status().media).toMatchObject({verified:0,bytesReserved:0})
    expect(await readFile(path)).toEqual(data)
  })
  it('revalida SHA após recebimento, preservando arquivo local adulterado',async()=>{
    await copy();const local=join(directory,'STANDBY-media',hash+'.media');await writeFile(local,Buffer.alloc(data.length,65))
    expect(await reserve.rehearse(request())).toMatchObject({phase:'REFUSED'})
    expect(await readFile(local)).toEqual(Buffer.alloc(data.length,65))
    expect(await readFile(path)).toEqual(data)
  })
  it.each(['wrong-channel','wrong-item','wrong-revision','duplicate-revision','missing-media','invalid-sha','invalid-playing-cursor','missing-loop'])('recusa %s sem gerar workspace de execução',async fault=>{
    if(fault==='wrong-channel')(source.channels[0]!.configuration.channel as any).id='other'
    if(fault==='wrong-item')(source.channels[0]!.checkpoint as any).value.itemId='missing'
    if(fault==='wrong-revision')source.channels[0]!.configuration.executionRevisionId='missing'
    if(fault==='duplicate-revision')source.channels[0]!.revisions.push(source.channels[0]!.revisions[0]!)
    if(fault==='missing-media')(source.channels[0]!.revisions[0]!.payload as any).items[0].mediaId='absent'
    if(fault==='invalid-sha')(source.channels[0]!.revisions[0]!.payload as any).assets[0].contentHash='legacy'
    if(fault==='invalid-playing-cursor'){const cursor=(source.channels[0]!.checkpoint as any).value;cursor.itemId=null;cursor.rundownId=null}
    if(fault==='missing-loop')(source.channels[0]!.checkpoint as any).value.contingency={loopRevisionId:'absent',loopRundownId:'missing',rundownId:'rd',revisionId,itemId:'vt',elapsed:5,activatedAt:new Date().toISOString()}
    await primary.tick();await copy()
    expect(await reserve.rehearse(request())).toMatchObject({phase:'REFUSED'})
    expect(await readdir(directory)).not.toContain('rehearsals')
  })
  it('não restaura edição passada nem cria segundo banco ao consultar recusa',async()=>{
    await copy();await primary.tick();const asked=request(1),report=await reserve.rehearse(asked)
    expect(report.phase).toBe('REFUSED');expect(await reserve.rehearse(asked)).toEqual(report)
    expect(await readdir(directory)).not.toContain('rehearsals')
  })
  it('conserva edição histórica legada sem usá-la como mídia de execução',async()=>{
    const old=structuredClone(source.channels[0]!.revisions[0]!)
    old.id='old-publication';old.revision=2;old.active=false;old.state='SUPERSEDED'
    ;(old.payload as any).assets[0].contentHash='historical-legacy'
    source.channels[0]!.revisions.push(old);await primary.tick();await copy()
    const report=await reserve.rehearse(request())
    expect(report).toMatchObject({phase:'RESTORED',restoredRevisions:2,verifiedMedia:1})
    const db=openDatabase(await workspace())
    try{expect(db.db.select().from(operationalPlaylistRevisions).all().find(row=>row.id==='old-publication')!.payload).toEqual(old.payload)}finally{db.sqlite.close()}
  })
  it('preserva política de QC e zonas congeladas sem importar vínculo físico estrangeiro',async()=>{
    // Extended preservation fixture NOT_RUN in this implementation batch.
    const profile={...DEFAULT_QC_PROFILE,codecs:['h264'],requireLoudness:true,requireProbe:true,liveSignalPolicy:{arrivalWarningEnabled:true,warningFrameIntervals:5,minimumReceivedFrames:50},renderedBusPairs:[{outputPair:1,loudness:{minLufs:-25,maxLufs:-21},maxTruePeakDbtp:-1}]}
    ;(source.channels[0]!.configuration.channel as any).qcProfile=profile
    const zones=[{id:'zone',label:'Rede ÇÃO',from:100,to:200,priority:5}]
    ;(source.channels[0]!.revisions[0]!.payload as any).rundown.protectedZones=zones
    await primary.tick();await copy();expect((await reserve.rehearse(request())).phase).toBe('RESTORED')
    const restored=openDatabase(await workspace())
    try{
      expect(restored.db.select().from(channels).get()).toMatchObject({qcProfile:profile,programSdiDeviceId:null})
      expect(restored.db.select().from(rundowns).get()!.protectedZones).toEqual(zones)
    }finally{restored.sqlite.close()}
  })
  it.each(['passed','pending','policy','no-buffers','invalid','throws'])('sonda isolada %s preserva publicação/QC e registra resultado por SHA sem liberar PGM',async mode=>{
    await copy()
    if(mode==='pending')source.channels[0]!.configuration.qc=[]
    if(mode==='policy')(source.channels[0]!.configuration.channel as any).qcProfile={...DEFAULT_QC_PROFILE,requireAudio:true}
    const ledger=new Database(':memory:'),root=join(directory,'probe-rehearsals'),binary=join(directory,'test-runtime.exe')
    await writeFile(binary,'SYNTHETIC_TEST_RUNTIME')
    const proof={ok:true,durationNs:20e9,decodedVideoBuffers:mode==='no-buffers'?0:500,decodedAudioBuffers:0,videoCodec:'video/x-h264',video:{width:320,height:180,rateNum:25,rateDen:1,interlaceMode:'progressive'}}
    const run=vi.fn(async(_path:string,_signal:AbortSignal)=>{if(mode==='throws')throw new Error('PRIVATE_PATH');return mode==='invalid'?{ok:true}:proof})
    const local=join(directory,'STANDBY-media',hash+'.media')
    const recovery=new HaRecovery(ledger,root,()=>({sequence:1,snapshot:source}),async()=>local,'probe',{binary,run})
    try{
      const asked=request(1),report=await recovery.rehearse(asked),badDecode=['no-buffers','invalid','throws'].includes(mode)
      expect(report).toMatchObject({phase:'RESTORED',promotionReady:false,automaticTake:false,localProbeRequired:badDecode,qcBlocked:mode==='passed'?0:1,localValidation:{state:['passed','pending'].includes(mode)?'PASSED':'FAILED',required:1,decoded:badDecode?0:1,technicalBlocked:['passed','pending'].includes(mode)?0:1}})
      expect(report).not.toHaveProperty('workspace');expect(JSON.stringify(report)).not.toContain('PRIVATE_PATH')
      expect(run).toHaveBeenCalledTimes(1);expect(run.mock.calls[0]![0]).toBe(local)
      expect(await recovery.rehearse(asked)).toEqual(report);expect(run).toHaveBeenCalledTimes(1)
      const file=(ledger.prepare('SELECT workspace FROM ha_recovery').get() as {workspace:string}).workspace,restored=openDatabase(file)
      try{
        expect(restored.db.select().from(operationalPlaylistRevisions).get()!.payload).toEqual(source.channels[0]!.revisions[0]!.payload)
        expect(restored.db.select().from(mediaAssets).get()).toMatchObject({qcStatus:mode==='pending'?'PENDING':'APPROVED',ignored:mode!=='passed',probeError:badDecode?expect.any(String):null})
        const row=restored.sqlite.prepare('SELECT payload FROM ha_recovery_media WHERE content_hash=?').get(hash) as {payload:string}
        expect(row.payload).not.toContain('video/x-h264')
        const evidence=JSON.parse(installationVault(false).decrypt(row.payload,`ha-recovery:v1:probe:${asked.requestId}:media:${hash}`))
        expect(evidence).toMatchObject({request:asked,decoded:!badDecode,runtimeHash:createHash('sha256').update('SYNTHETIC_TEST_RUNTIME').digest('hex')})
        expect(new Checkpoints(restored.sqlite).read('ch')!.playing).toBe(false)
      }finally{restored.sqlite.close()}
    }finally{recovery.close();await recovery.settled();ledger.close()}
  })
  it.each(['media','sequence','runtime','closing','restored-sha','restored-runtime'])('recusa alteração de %s durante sonda sem preparar workspace para PGM',async fault=>{
    await copy();const ledger=new Database(':memory:'),root=join(directory,'changed-probe'),binary=join(directory,'test-runtime.exe')
    await writeFile(binary,'OLD_TEST_RUNTIME');let sequence=1,lookups=0
    const recovery=new HaRecovery(ledger,root,()=>({sequence,snapshot:source}),async()=>fault==='media'&&++lookups>1?null:join(directory,'STANDBY-media',hash+'.media'),'probe',{binary,run:async(selectedPath,signal)=>{
      if(fault==='sequence')sequence=2
      if(fault==='runtime')await writeFile(binary,'CHANGED_TEST_RUNTIME')
      if(fault==='restored-sha'){await writeFile(selectedPath,'changed');await writeFile(selectedPath,data)}
      if(fault==='restored-runtime'){await writeFile(binary,'changed');await writeFile(binary,'OLD_TEST_RUNTIME')}
      if(fault==='closing'){recovery.close();expect(signal.aborted).toBe(true)}
      return {ok:true}
    }})
    try{expect((await recovery.rehearse(request(1))).phase).toBe('REFUSED');expect(await readdir(directory)).not.toContain('changed-probe')}
    finally{recovery.close();await recovery.settled();ledger.close()}
  })
  it('reconcilia somente criador local morto, conserva parcial e permite ensaio com novo UUID',async()=>{
    const ledger=new Database(':memory:'),root=join(directory,'orphan'),recovery=new HaRecovery(ledger,root,()=>({sequence:1,snapshot:source}),async()=>null,'test')
    const asked=request(1),partial=join(directory,'partial-do-not-remove.db');await writeFile(partial,'PRESERVAR')
    const report={...asked,phase:'CHECKING',createdAt:new Date().toISOString(),restoredRevisions:0,verifiedMedia:0,qcBlocked:0,checkpointRestored:false,automaticTake:false,promotionReady:false,localProbeRequired:true,reason:'interrupted'}
    ledger.prepare('INSERT INTO ha_recovery VALUES(?,?,?,?,?)').run(asked.requestId,JSON.stringify(asked),installationVault().encrypt(JSON.stringify(report),`ha-recovery:v1:test:${asked.requestId}`),partial,JSON.stringify({host:hostname(),pid:123456,boot:randomUUID()}))
    const original=process.kill;vi.spyOn(process,'kill').mockImplementation((pid,signal)=>{if(pid===123456)throw Object.assign(new Error('gone'),{code:'ESRCH'});return original(pid,signal)})
    try{
      const result=recovery.reconcile(asked,'Admin')
      expect(result).toMatchObject({phase:'REFUSED',reconciled:{actor:'Admin'},automaticTake:false,promotionReady:false})
      expect(recovery.reconcile(asked,'Other')).toEqual(result)
      expect(await recovery.rehearse(asked)).toEqual(result)
      expect(await readFile(partial,'utf8')).toBe('PRESERVAR')
      expect(()=>recovery.reconcile({...asked,channelId:'other'},'Admin')).toThrow('não confere')
      expect((await recovery.rehearse({...asked,requestId:randomUUID()})).phase).toBe('REFUSED')
    }finally{recovery.close();await recovery.settled();ledger.close()}
  })
  it.each(['alive','foreign','unknown','permission','legacy'])('não libera criador %s nem altera relatório/parcial',async mode=>{
    const ledger=new Database(':memory:'),root=join(directory,'blocked'),recovery=new HaRecovery(ledger,root,()=>({sequence:1,snapshot:source}),async()=>null,'test')
    const asked=request(1),report={...asked,phase:'CHECKING',createdAt:new Date().toISOString(),restoredRevisions:0,verifiedMedia:0,qcBlocked:0,checkpointRestored:false,automaticTake:false,promotionReady:false,localProbeRequired:true,reason:'interrupted'}
    const owner=mode==='legacy'?null:mode==='unknown'?'invalid':JSON.stringify({host:mode==='foreign'?'other-host':hostname(),pid:mode==='alive'?process.pid:123456,boot:randomUUID()})
    const cipher=installationVault().encrypt(JSON.stringify(report),`ha-recovery:v1:test:${asked.requestId}`)
    ledger.prepare('INSERT INTO ha_recovery VALUES(?,?,?,?,?)').run(asked.requestId,JSON.stringify(asked),cipher,null,owner)
    if(mode==='permission')vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('unknown'),{code:'EPERM'})})
    try{
      expect(()=>recovery.reconcile(asked,'Admin')).toThrow('não será liberado')
      expect(ledger.prepare('SELECT report FROM ha_recovery').get()).toEqual({report:cipher})
      expect(await recovery.rehearse(asked)).toEqual(report)
      await expect(recovery.rehearse({...asked,requestId:randomUUID()})).rejects.toThrow('Outro ensaio')
    }finally{recovery.close();await recovery.settled();ledger.close()}
  })
  it('migra ledger anterior sem inventar dono nem reexecutar CHECKING',async()=>{
    const ledger=new Database(':memory:'),asked=request(1),report={...asked,phase:'CHECKING',createdAt:new Date().toISOString(),restoredRevisions:0,verifiedMedia:0,qcBlocked:0,checkpointRestored:false,automaticTake:false,promotionReady:false,localProbeRequired:true,reason:'old'}
    ledger.exec('CREATE TABLE ha_recovery(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,report TEXT NOT NULL,workspace TEXT)')
    ledger.prepare('INSERT INTO ha_recovery VALUES(?,?,?,NULL)').run(asked.requestId,JSON.stringify(asked),installationVault().encrypt(JSON.stringify(report),`ha-recovery:v1:test:${asked.requestId}`))
    const recovery=new HaRecovery(ledger,join(directory,'legacy'),()=>({sequence:1,snapshot:source}),async()=>null,'test')
    try{expect(await recovery.rehearse(asked)).toEqual(report);expect(()=>recovery.reconcile(asked,null)).toThrow('desconhecido');expect(ledger.prepare('SELECT owner FROM ha_recovery').get()).toEqual({owner:null})}finally{recovery.close();await recovery.settled();ledger.close()}
  })
  it('encerra ensaio em andamento antes de fechar DB e não repete CHECKING após crash',async()=>{
    const ledger=new Database(':memory:'),root=join(directory,'isolated')
    let release!:(value:string|null)=>void
    const recovery=new HaRecovery(ledger,root,()=>({sequence:1,snapshot:source}),()=>new Promise(resolve=>{release=resolve}),'test')
    const asked={...request(1),requestId:randomUUID()},work=recovery.rehearse(asked)
    expect((await recovery.rehearse(asked)).phase).toBe('CHECKING')
    await expect(recovery.rehearse({...asked,requestId:randomUUID()})).rejects.toThrow('Outro ensaio')
    recovery.close();release(null);await recovery.settled();expect((await work).phase).toBe('REFUSED')
    ledger.close()
  })
})

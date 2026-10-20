import {afterEach,beforeEach,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {captureIncidentContext} from './incident-context.js'
import {PgmProbe} from './pgm-probe.js'
import {persistPgmSignalIncidents} from './pgm-signal-incidents.js'
import type {MetricRuntime} from './operational-metrics.js'
import {healthEvents} from '../db/schema.js'
import {validateIncidentContexts} from '../db/incident-context.js'
import {readHealthIncidentPage} from './health-incidents.js'
let value:ReturnType<typeof openDatabase>
const endpoint='srt://user:PRIVATE_PASSWORD@host:9999?passphrase=PRIVATE_SECRET'
function runtime():MetricRuntime{return {channel:{id:'a'},telemetryIdentity:()=>({revisionId:'edition-one',executionId:'execution-one'}),transport:{state:()=>({mode:'NATIVE',channelId:'a',rundownId:'rd',onAir:{itemId:'item-one',elapsed:50,startedAt:0},playing:true,standby:false,preview:null,previewPosition:null,preparedItemId:null,preparingItemId:null,liveSources:[{source:endpoint,itemId:'item-one',state:'ON_PGM',message:null,changedAt:new Date().toISOString(),busItemIds:{pgm:'item-one'},nativeCatalogBindings:{pgm:'PRIVATE_CATALOG'},busSignals:{pgm:{status:'SIGNAL_OK',videoRecent:true,audioRecent:true,sampleAgeMs:0}}}]}),health:()=>({ready:true,restarts:0,deaths:0,stalls:0,error:null,lastAckAt:null}),processId:()=>123,publishers:()=>[{outputId:'PRIVATE_OUTPUT',url:'rtmp://host/PRIVATE_KEY',health:'failed',attempts:1,delivered:0,error:'PRIVATE_PASSWORD'}]}}}
function context(){return captureIncidentContext(runtime(),{items:new Map([['item-one','Jornal São José']]),sources:new Map([[endpoint,'Câmera Óptica']]),outputs:new Map(),sourceItems:new Map([['item-one',{configuredId:'PRIVATE_CATALOG',endpoint,name:'Estúdio Çãó'}]]),outputProfiles:new Map([['PRIVATE_OUTPUT',{target:'rtmp://host/PRIVATE_KEY',name:'Saída principal'}]])})}
beforeEach(()=>{value=openDatabase(':memory:')});afterEach(()=>value.sqlite.close())
it('captura correlação sem endpoints/segredos e sem confundir cadastro com sinal físico',()=>{
  const snapshot=context();expect(snapshot).toMatchObject({channelId:'a',itemId:'item-one',itemName:'Jornal São José',revisionId:'edition-one',executionId:'execution-one',sources:[{name:'Câmera Óptica',pgmSelection:{name:'Estúdio Çãó',basis:'NATIVE_DECODER'}}],outputs:[{name:'Saída principal',state:'failed',hasError:true}],physicalSignalValidated:false})
  for(const text of ['PRIVATE_PASSWORD','PRIVATE_SECRET','PRIVATE_KEY','PRIVATE_CATALOG','PRIVATE_OUTPUT',endpoint])expect(JSON.stringify(snapshot)).not.toContain(text)
})
it('contexto é congelado na detecção e permanece mesmo após falha de gravação/novo item',()=>{
  let snapshot=context();const probe=new PgmProbe();probe.onContext(()=>snapshot)
  probe.feedMetrics({isBlack:true,deltaMs:2100})
  snapshot={...snapshot,itemId:'item-two',itemName:'Outro VT',executionId:'execution-two'}
  const copied=probe.pendingTransitions();copied[0]!.context!.sources[0]!.name='Mutação externa'
  value.sqlite.exec("CREATE TRIGGER deny_context BEFORE INSERT ON health_events BEGIN SELECT RAISE(ABORT,'own fixture write failure'); END")
  expect(()=>persistPgmSignalIncidents(value.db,'a',probe)).toThrow();value.sqlite.exec('DROP TRIGGER deny_context')
  persistPgmSignalIncidents(value.db,'a',probe)
  const active=value.db.select().from(healthEvents).get()!
  expect(active.context).toMatchObject({itemId:'item-one',executionId:'execution-one',sources:[{name:'Câmera Óptica'}]})
  probe.feedMetrics({isBlack:false});persistPgmSignalIncidents(value.db,'a',probe)
  expect(value.db.select().from(healthEvents).all().find(row=>row.state==='black_recovered')?.context?.itemId).toBe('item-two')
  expect(value.db.select().from(healthEvents).all().find(row=>row.state==='black')?.context?.itemId).toBe('item-one')
})
it('contexto protegido no SQLite, validado em48 e lido somente no canal autorizado',()=>{
  value.db.insert(healthEvents).values({id:'context',channelId:'a',component:'SIGNAL',state:'black',occurredAt:new Date().toISOString(),context:context()}).run()
  const stored=value.sqlite.prepare('SELECT context FROM health_events').get() as {context:string}
  const raw=String(stored.context)
  expect(raw).not.toContain('Jornal');expect(()=>validateIncidentContexts(value.sqlite)).not.toThrow()
  expect(readHealthIncidentPage(value.db,['b'],{}).events).toEqual([])
  expect(readHealthIncidentPage(value.db,['a'],{}).events[0]?.context?.itemName).toBe('Jornal São José')
  value.sqlite.exec("UPDATE health_events SET channel_id='b'");expect(()=>validateIncidentContexts(value.sqlite)).toThrow('outro canal')
  expect(()=>readHealthIncidentPage(value.db,['b'],{})).toThrow('não confiável')
})
it('falha ao coletar contexto não suprime alarme e contexto de outro canal é descartado',()=>{
  const probe=new PgmProbe();probe.onContext(()=>{throw new Error('context unavailable')});probe.feedMetrics({isBlack:true,deltaMs:2100});persistPgmSignalIncidents(value.db,'a',probe)
  expect(value.db.select().from(healthEvents).get()?.context).toBeNull()
  const another=new PgmProbe();another.onContext(()=>({...context(),channelId:'b'}));another.feedMetrics({isBlack:true,deltaMs:2100});persistPgmSignalIncidents(value.db,'a',another)
  expect(value.db.select().from(healthEvents).all().every(row=>row.context===null)).toBe(true)
})
it('painel histórico inclui reconhecidos sem recuperação e separa fim de observação',()=>{
  const now=new Date().toISOString()
  for(const row of [{id:'pgm-signal:a:active',acknowledgedAt:now},{id:'pgm-signal:b:active',observationEndedAt:now},{id:'pgm-signal:c:active',resolvedAt:now}])value.db.insert(healthEvents).values({channelId:'a',component:'SIGNAL',state:'black',occurredAt:now,...row}).run()
  expect(readHealthIncidentPage(value.db,['a'],{acknowledgement:'PENDING',limit:1}).risk).toEqual({observedUnresolved:1,observationEndedUnresolved:1,withoutContext:2})
})

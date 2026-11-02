import {afterEach,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {captureOperationalMetrics,scopedOperationalSample,type MetricRuntime} from './operational-metrics.js'
import {ProcessMetrics} from './process-metrics.js'
import {HostMetrics} from './host-metrics.js'
import {tmpdir} from 'node:os'
const databases:ReturnType<typeof openDatabase>[]=[]
afterEach(()=>{for(const db of databases.splice(0))db.sqlite.close()})
const setup=()=>{const db=openDatabase(':memory:');databases.push(db);return db}
it('mantém atribuições cadastrais distintas por bus sem expor IDs ou endpoints brutos',async()=>{
  setup();const value=runtime('ch'),state=value.transport.state(),source=state.liveSources[0]!
  value.transport.state=()=>({...state,liveSources:[{...source,busItemIds:{pgm:'live',pvw:'next'}}]})
  const labels={items:new Map<string,string>(),sources:new Map<string,string>(),outputs:new Map<string,string>(),sourceItems:new Map([
    ['live',{configuredId:'PRIVATE_CATALOG_ONE',endpoint:source.source,name:'Estúdio São José'}],
    ['next',{configuredId:'PRIVATE_CATALOG_TWO',endpoint:source.source,name:'Estúdio Óscar'}],
  ])}
  const collect=()=>captureOperationalMetrics(new Map([['ch',value]]),new ProcessMetrics(async()=>new Map()),()=>labels)
  const frame=await collect(),catalog=frame.channels[0]!.sources[0]!.busCatalog!
  expect(catalog.pgm).toMatchObject({sourceName:'Estúdio São José',identityBasis:'PUBLISHED_ITEM'})
  expect(catalog.pvw).toMatchObject({sourceName:'Estúdio Óscar',identityBasis:'PUBLISHED_ITEM'})
  expect(catalog.pgm?.configuredSourceId).not.toBe(catalog.pvw?.configuredSourceId)
  value.transport.state=()=>({...state,liveSources:[{...source,busItemIds:{pgm:'live',pvw:'next'},nativeCatalogBindings:{pgm:'PRIVATE_CATALOG_ONE',pvw:'OTHER'}}]})
  const native=(await collect()).channels[0]!.sources[0]!.busCatalog!
  expect(native.pgm?.identityBasis).toBe('NATIVE_DECODER')
  expect(native.pvw?.identityBasis).toBe('PUBLISHED_ITEM')
  const encoded=JSON.stringify(frame)
  for(const privateValue of ['PRIVATE_CATALOG_ONE','PRIVATE_CATALOG_TWO',source.source])expect(encoded).not.toContain(privateValue)
  labels.sourceItems.set('next',{configuredId:'PRIVATE_CATALOG_TWO',endpoint:'ndi:CHANGED',name:'Não atribuir'})
  expect((await collect()).channels[0]!.sources[0]!.busCatalog?.pvw).toBeUndefined()
  expect(catalog.pvw?.sourceName).toBe('Estúdio Óscar')
})
function runtime(id:string):MetricRuntime{
  return {channel:{id},telemetryIdentity:()=>({revisionId:'revision',executionId:'execution'}),transport:{processId:()=>123,state:()=>({mode:'NATIVE',channelId:id,rundownId:'rd',onAir:{itemId:'live',elapsed:50,startedAt:0},playing:true,standby:false,preview:null,previewPosition:null,preparedItemId:null,preparingItemId:null,liveSources:[{source:'srt://user:PRIVATE_PASSWORD@host:9999?passphrase=PRIVATE_SECRET',itemId:'live',state:'ON_PGM',message:null,changedAt:new Date().toISOString(),busItemIds:{pgm:'live'},busSignals:{pgm:{status:'SIGNAL_OK',videoRecent:true,audioRecent:true,sampleAgeMs:0}}}]}),health:()=>({ready:true,restarts:1,deaths:0,stalls:0,error:null}),publishers:()=>[{url:'rtmp://host/app/PRIVATE_KEY',health:'onAir',attempts:0,delivered:10,error:'PRIVATE_DIAGNOSTIC'}]}}
}
it('correlaciona item/revisão/execução e processos sem armazenar endpoints ou erros privados',async()=>{
  setup();const frame=await captureOperationalMetrics(new Map([['ch',runtime('ch')]]),new ProcessMetrics(async()=>new Map([[123,{cpuTimeMs:500,memoryBytes:1000}]])))
  expect(frame.channels[0]).toMatchObject({channelId:'ch',itemId:'live',revisionId:'revision',executionId:'execution',engine:{cpuTimeMs:500,memoryBytes:1000},outputs:[{state:'onAir',delivered:10,hasError:true}]})
  const encoded=JSON.stringify(frame);for(const secret of ['PRIVATE_PASSWORD','PRIVATE_SECRET','PRIVATE_KEY','PRIVATE_DIAGNOSTIC','srt://','rtmp://'])expect(encoded).not.toContain(secret)
})
it('congela nomes por identidade exata e não substitui amostras anteriores após renomear',async()=>{
  setup();const row=runtime('ch'),state=row.transport.state(),output=row.transport.publishers()[0]!
  const labels={items:new Map([['live','Jornal ao vivo']]),sources:new Map([[state.liveSources[0]!.source,'Estúdio São José']]),outputs:new Map([[output.url,'Saída principal']])}
  const collect=()=>captureOperationalMetrics(new Map([['ch',row]]),new ProcessMetrics(async()=>new Map()),()=>labels)
  const first=await collect();labels.sources.set(state.liveSources[0]!.source,'Câmera renomeada')
  const second=await collect()
  expect(first.channels[0]).toMatchObject({itemName:'Jornal ao vivo',sources:[{sourceName:'Estúdio São José'}],outputs:[{outputName:'Saída principal'}]})
  expect(second.channels[0]?.sources[0]?.sourceName).toBe('Câmera renomeada')
  labels.outputs.set(output.url,output.url);expect((await collect()).channels[0]?.outputs[0]?.outputName).toBeNull()
  for(const secret of ['PRIVATE_PASSWORD','PRIVATE_SECRET','PRIVATE_KEY'])expect(JSON.stringify(first)).not.toContain(secret)
})
it('falha na consulta de nomes não apaga estado e não inventa nome',async()=>{
  setup();const frame=await captureOperationalMetrics(new Map([['ch',runtime('ch')]]),new ProcessMetrics(async()=>new Map()),()=>{throw new Error('lookup unavailable')})
  expect(frame.channels[0]).toMatchObject({itemId:'live',itemName:null,engine:{ready:true},sources:[{sourceName:null}],outputs:[{outputName:null}]})
})
it('perfis no mesmo endereço conservam IDs distintos e estáveis após troca de alvo',async()=>{
  setup();const row=runtime('ch'),url='rtmp://host/PRIVATE_KEY',sources=new Map<string,string>()
  let outputs=[{outputId:'one',url,health:'onAir' as const,attempts:0,delivered:1},{outputId:'two',url,health:'onAir' as const,attempts:0,delivered:2}]
  row.transport.publishers=()=>outputs
  const labels={items:new Map<string,string>(),sources,outputs:new Map<string,string>(),outputProfiles:new Map([['one',{target:url,name:'Principal'}],['two',{target:url,name:'Reserva'}]]),ambiguousOutputs:new Set([url])}
  const collect=()=>captureOperationalMetrics(new Map([['ch',row]]),new ProcessMetrics(async()=>new Map()),()=>labels)
  const first=(await collect()).channels[0]!.outputs
  expect(first.map(output=>output.outputName)).toEqual(['Principal','Reserva']);expect(first[0]!.outputId).not.toBe(first[1]!.outputId)
  outputs=[{...outputs[0]!,url:'rtmp://host/NEW_PRIVATE_KEY'},outputs[1]!]
  const next=(await collect()).channels[0]!.outputs
  expect(next[0]!.outputId).toBe(first[0]!.outputId);expect(next[0]!.outputName).toBeNull()
  expect(JSON.stringify(next)).not.toContain('PRIVATE_KEY')
})
it('endereço sem ID e cadastro duplicado não herdam um nome arbitrário',async()=>{
  setup();const row=runtime('ch'),source=row.transport.state().liveSources[0]!.source,url=row.transport.publishers()[0]!.url
  const frame=await captureOperationalMetrics(new Map([['ch',row]]),new ProcessMetrics(async()=>new Map()),()=>({items:new Map(),sources:new Map(),outputs:new Map(),ambiguousSources:new Set([source]),ambiguousOutputs:new Set([url])}))
  expect(frame.channels[0]).toMatchObject({sources:[{sourceName:null,nameAmbiguous:true}],outputs:[{outputName:null,nameAmbiguous:true,identityType:'ENDPOINT'}]})
})
it('processo trocado durante consulta não herda contadores de PID anterior',async()=>{
  setup();const row=runtime('ch');let pid=123;row.transport.processId=()=>pid
  const frame=await captureOperationalMetrics(new Map([['ch',row]]),new ProcessMetrics(async()=>{pid=456;return new Map([[123,{cpuTimeMs:500,memoryBytes:1000}]])}))
  expect(frame.channels[0]?.engine).toMatchObject({pid:456,cpuTimeMs:null,memoryBytes:null})
})
it('QC direto também oculta URI embutida no item e nas ligações do barramento',async()=>{
  setup();const row=runtime('ch'),original=row.transport.state()
  row.transport.state=()=>({...original,liveSources:original.liveSources.map(source=>({...source,itemId:'source:'+source.source,busItemIds:{pvw:'source:'+source.source}}))})
  const frame=await captureOperationalMetrics(new Map([['ch',row]]),new ProcessMetrics(async()=>new Map()))
  for(const secret of ['PRIVATE_PASSWORD','PRIVATE_SECRET','srt://'])expect(JSON.stringify(frame)).not.toContain(secret)
})
it('falha de contador fica null e filtro não modifica histórico compartilhado',async()=>{
  setup();const frame=await captureOperationalMetrics(new Map([['one',runtime('one')],['two',runtime('two')]]),new ProcessMetrics(async()=>{throw new Error('unavailable')}))
  expect(frame.channels[0]?.engine.cpuTimeMs).toBeNull()
  expect(scopedOperationalSample({operations:frame},id=>id==='one').operations.channels.map(row=>row.channelId)).toEqual(['one'])
  expect(frame.channels).toHaveLength(2)
})
it('captura persiste junto do host, sem precisar de navegador e sem criar runtime',async()=>{
  const db=setup(),metrics=new HostMetrics(db.sqlite,tmpdir()),rows=new Map<string,MetricRuntime>()
  metrics.onCapture=()=>captureOperationalMetrics(rows,new ProcessMetrics())
  try{const sample=await metrics.latest();expect(sample.operations).toMatchObject({version:1,available:true,channels:[]});expect(metrics.history('2000-01-01')[0]?.operations).toEqual(sample.operations);expect(rows.size).toBe(0)}finally{metrics.close()}
})

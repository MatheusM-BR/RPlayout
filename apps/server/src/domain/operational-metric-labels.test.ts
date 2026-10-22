import {afterEach,expect,it} from 'vitest'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {channels,liveSources,outputProfiles} from '../db/schema.js'
import {operationalMetricLabels,safeMetricLabel} from './operational-metric-labels.js'
import {MediaMtx} from './mediamtx.js'
import type {RundownView} from './plan.js'
const opened:ReturnType<typeof openDatabase>[]=[]
it('atribui nomes por seleção explícita e conexão congelada, sem escolher pelo endereço duplicado',()=>{
  const f=openDatabase(':memory:');opened.push(f)
  for(const id of ['a','b'])f.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  for(const [id,channelId,name]of [['one','a','Estúdio São José'],['two','a','Estúdio Óscar'],['foreign','b','PRIVATE_OTHER_CHANNEL']])f.db.insert(liveSources).values({id:id!,channelId:channelId!,name:name!,kind:'NDI',targetUrl:'CAM',createdAt:'now'}).run()
  const view={items:[
    {item:{id:'pgm',title:'Jornal',configuredSourceId:'one',sourceRef:'ndi:CAM'}},
    {item:{id:'pvw',title:'Entrevista',configuredSourceId:'two',sourceRef:'ndi:CAM'}},
    {item:{id:'changed',title:'Mudou',configuredSourceId:'one',sourceRef:'ndi:OTHER'}},
    {item:{id:'foreign',title:'Outro',configuredSourceId:'foreign',sourceRef:'ndi:CAM'}},
    {item:{id:'legacy',title:'Legado',sourceRef:'ndi:CAM'}},
  ]} as unknown as RundownView
  const labels=operationalMetricLabels(f.db,'a',undefined,view)
  expect(labels.ambiguousSources?.has('ndi:CAM')).toBe(true)
  expect(labels.sourceItems?.get('pgm')).toMatchObject({configuredId:'one',name:'Estúdio São José'})
  expect(labels.sourceItems?.get('pvw')).toMatchObject({configuredId:'two',name:'Estúdio Óscar'})
  for(const id of ['changed','foreign','legacy'])expect(labels.sourceItems?.has(id)).toBe(false)
})
afterEach(()=>{for(const entry of opened.splice(0))entry.sqlite.close()})
it('rótulos preservam acentos mas nunca usam URL, caminho ou credenciais',()=>{
  expect(safeMetricLabel(' Estúdio São José ')).toBe('Estúdio São José')
  expect(safeMetricLabel('A'.repeat(200))).toHaveLength(160)
  for(const unsafe of ['srt://user:secret@host','ndi:Fonte','C:\\Acervo','/media/clip','passphrase=secret','token=private','name\nprivate',''])expect(safeMetricLabel(unsafe)).toBeNull()
})
it('consulta nomes somente do canal e resolve a identidade exata das entradas e saídas gerenciadas',()=>{
  const f=openDatabase(':memory:');opened.push(f)
  for(const id of ['a','b'])f.db.insert(channels).values({id,name:id,width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:'now'}).run()
  for(const id of ['a','b'])f.db.insert(liveSources).values({id,channelId:id,name:id==='a'?'Câmera São José':'PRIVATE_OTHER_CHANNEL',kind:'NDI',targetUrl:'Studio',createdAt:'now'}).run()
  f.db.insert(outputProfiles).values({id:'pgm',channelId:'a',name:'Programa principal',kind:'RTMP',role:'PROGRAM',target:'',createdAt:'now'}).run()
  const path={channelId:'a',program:'a/pgm',preview:'a/pvw',monitor:'a/mon',clean:'a/clean'}
  const old=operationalMetricLabels(f.db,'a',path,null)
  expect(old.sources.get('ndi:Studio')).toBe('Câmera São José');expect(old.sources.has('Studio')).toBe(false)
  expect(old.outputs.get(MediaMtx.loopback(path.program))).toBe('Programa principal')
  expect([...old.sources.values()]).not.toContain('PRIVATE_OTHER_CHANNEL')
  f.db.update(liveSources).set({name:'Novo nome'}).where(eq(liveSources.id,'a')).run()
  expect(old.sources.get('ndi:Studio')).toBe('Câmera São José')
  expect(operationalMetricLabels(f.db,'a',path,null).sources.get('ndi:Studio')).toBe('Novo nome')
  f.db.insert(liveSources).values({id:'dup',channelId:'a',name:'Outra câmera',kind:'NDI',targetUrl:'ndi:Studio',createdAt:'now'}).run()
  f.db.insert(outputProfiles).values({id:'pgm2',channelId:'a',name:'Outro perfil',kind:'RTMP',role:'PROGRAM',target:'',createdAt:'now'}).run()
  const ambiguous=operationalMetricLabels(f.db,'a',path,null)
  expect(ambiguous.sources.has('ndi:Studio')).toBe(false);expect(ambiguous.ambiguousSources?.has('ndi:Studio')).toBe(true)
  expect(ambiguous.outputs.has(MediaMtx.loopback(path.program))).toBe(false)
  expect(ambiguous.outputProfiles?.get('pgm')).toMatchObject({name:'Programa principal'})
  expect(ambiguous.outputProfiles?.get('pgm2')).toMatchObject({name:'Outro perfil'})
})

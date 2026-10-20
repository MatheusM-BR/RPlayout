import {afterEach,beforeEach,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {healthEvents} from '../db/schema.js'
import {readHealthIncidentPage} from './health-incidents.js'
let value:ReturnType<typeof openDatabase>
const until='2026-10-10T06:00:00.000Z'
beforeEach(()=>{
  value=openDatabase(':memory:')
  for(let i=0;i<85;i++)value.db.insert(healthEvents).values({id:`event-${String(i).padStart(3,'0')}`,channelId:'a',component:'SIGNAL',state:'freeze',severity:i===0?'CRITICAL':'INFO',occurredAt:'2026-10-10T05:00:00.000Z',acknowledgedAt:i%2?until:null}).run()
  value.db.insert(healthEvents).values({id:'other',channelId:'b',component:'SIGNAL',state:'FAILED',severity:'CRITICAL',occurredAt:until}).run()
  value.db.insert(healthEvents).values({id:'global',channelId:null,component:'HOST',state:'FAILED',severity:'CRITICAL',occurredAt:until}).run()
})
afterEach(()=>value.sqlite.close())
it('percorre todas as páginas com horários iguais, sem duplicar nem perder IDs',()=>{
  const seen:string[]=[];let before:{beforeAt:string;beforeId:string}|undefined
  do{
    const page=readHealthIncidentPage(value.db,['a'],{channelId:'a',limit:30,until,...before})
    expect(page.page.totalMatching).toBe(85);expect(page.pending).toEqual({critical:1,warn:0})
    seen.push(...page.events.map(row=>row.id))
    before=page.page.nextBefore?{beforeAt:page.page.nextBefore.occurredAt,beforeId:page.page.nextBefore.id}:undefined
  }while(before)
  expect(seen).toHaveLength(85);expect(new Set(seen).size).toBe(85)
  expect(seen[0]).toBe('event-084');expect(seen.at(-1)).toBe('event-000')
})
it('novos eventos não deslocam a janela histórica e contagem de pendentes não se limita à página',()=>{
  const first=readHealthIncidentPage(value.db,['a'],{limit:1,until})
  value.db.insert(healthEvents).values({id:'new',channelId:'a',component:'SIGNAL',state:'black',severity:'CRITICAL',occurredAt:'2026-10-10T07:00:00.000Z'}).run()
  const next=readHealthIncidentPage(value.db,['a'],{limit:1,until,beforeAt:first.page.nextBefore!.occurredAt,beforeId:first.page.nextBefore!.id})
  expect(next.events.map(row=>row.id)).toEqual(['event-083']);expect(next.page.totalMatching).toBe(85);expect(next.pending.critical).toBe(2)
})
it('filtra severidade e reconhecimento no banco, inclusive além dos primeiros 200 eventos',()=>{
  for(let i=0;i<240;i++)value.db.insert(healthEvents).values({id:`recent-${i}`,channelId:'a',component:'VIDEO',state:'running',occurredAt:until}).run()
  const critical=readHealthIncidentPage(value.db,['a'],{until,severity:'CRITICAL',acknowledgement:'PENDING',limit:30})
  expect(critical.events.map(row=>row.id)).toEqual(['event-000']);expect(critical.page.totalMatching).toBe(1)
  expect(readHealthIncidentPage(value.db,['a'],{until,acknowledgement:'ACKNOWLEDGED'}).events).toHaveLength(42)
})
it('ACL é reaplicada a cada página e cursor não concede acesso a outro canal',()=>{
  expect(()=>readHealthIncidentPage(value.db,['a'],{channelId:'b',until})).toThrow('Sem acesso')
  expect(readHealthIncidentPage(value.db,[],{until})).toMatchObject({events:[],pending:{critical:0,warn:0},page:{totalMatching:0,nextBefore:null}})
  expect(readHealthIncidentPage(value.db,['a'],{until,beforeAt:until,beforeId:'other'}).events.every(row=>row.channelId==='a')).toBe(true)
  expect(readHealthIncidentPage(value.db,null,{until}).events.some(row=>row.id==='global')).toBe(true)
})
it.each([{beforeAt:until},{beforeId:'event-080'},{beforeAt:until,beforeId:'event-080'},{until:'invalid'},{until,beforeAt:'2026-10-10T07:00:00.000Z',beforeId:'x'},{until,beforeAt:until,beforeId:'x'.repeat(257)},{severity:'INVALID'},{acknowledgement:'INVALID'}])('recusa janela/cursor/filtro inválido %j',query=>{
  expect(()=>readHealthIncidentPage(value.db,['a'],query as Parameters<typeof readHealthIncidentPage>[2])).toThrow()
})

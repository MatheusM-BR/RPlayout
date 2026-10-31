import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {healthEvents,operatorDecisions} from '../db/schema.js'
import {acknowledgeHealthIncident,readHealthIncidentPage,readHealthIncidents,type IncidentAuthority} from './health-incidents.js'
let value:ReturnType<typeof openDatabase>
const authority:IncidentAuthority={actor:'Supervisor São José',channelIds:['a'],canAcknowledge:true}
beforeEach(()=>{value=openDatabase(':memory:');for(const [id,channelId]of [['a','a'],['b','b'],['global',null]] as const)value.db.insert(healthEvents).values({id,channelId,component:'ENGINE',state:'NO_VIDEO',severity:'CRITICAL',occurredAt:'2026-10-10T00:00:00.000Z'}).run()})
afterEach(()=>value.sqlite.close())
describe('incidentes persistentes e reconhecimento auditado',()=>{
  it('registra ator, canal e incidente em uma decisão; replay conserva o primeiro horário',()=>{
    const first=acknowledgeHealthIncident(value.db,'a',()=>authority)
    const second=acknowledgeHealthIncident(value.db,'a',()=>({...authority,actor:'Outro supervisor'}))
    expect(first).toMatchObject({deduplicated:false,signalRecovered:false})
    expect(second).toEqual({...first,deduplicated:true})
    const rows=value.db.select().from(operatorDecisions).all();expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({actorUsername:authority.actor,kind:'HEALTH_EVENT_ACKNOWLEDGED',payload:{eventId:'a',channelId:'a',state:'NO_VIDEO',signalRecovered:false,acknowledgedAt:first.acknowledgedAt}})
    expect(value.db.select().from(healthEvents).all().find(row=>row.id==='a')).toMatchObject({state:'NO_VIDEO',acknowledgedAt:first.acknowledgedAt})
  })
  it('falha de auditoria não reconhece o incidente',()=>{
    value.sqlite.exec("CREATE TRIGGER deny_ack BEFORE INSERT ON operator_decisions BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
    expect(()=>acknowledgeHealthIncident(value.db,'a',()=>authority)).toThrow('audit unavailable')
    expect(value.db.select().from(healthEvents).all().every(row=>row.acknowledgedAt===null)).toBe(true)
  })
  it('falha no update também desfaz a auditoria',()=>{
    value.sqlite.exec("CREATE TRIGGER deny_ack BEFORE UPDATE ON health_events BEGIN SELECT RAISE(ABORT,'update unavailable'); END")
    expect(()=>acknowledgeHealthIncident(value.db,'a',()=>authority)).toThrow('update unavailable')
    expect(value.db.select().from(operatorDecisions).all()).toHaveLength(0)
  })
  it('update ignorado não devolve reconhecimento falso nem deixa auditoria aplicada',()=>{
    value.sqlite.exec("CREATE TRIGGER ignore_ack BEFORE UPDATE ON health_events BEGIN SELECT RAISE(IGNORE); END")
    expect(()=>acknowledgeHealthIncident(value.db,'a',()=>authority)).toThrow('gravação não confirmada')
    expect(value.db.select().from(operatorDecisions).all()).toHaveLength(0)
    expect(value.db.select().from(healthEvents).all().every(row=>row.acknowledgedAt===null)).toBe(true)
  })
  it('recusa canal alheio, alerta global, papel revogado e evento inexistente',()=>{
    for(const id of ['b','global'])expect(()=>acknowledgeHealthIncident(value.db,id,()=>authority)).toThrow('Sem acesso')
    expect(()=>acknowledgeHealthIncident(value.db,'a',()=>({...authority,canAcknowledge:false}))).toThrow('Supervisor')
    expect(()=>acknowledgeHealthIncident(value.db,'missing',()=>authority)).toThrow('não encontrado')
    expect(value.db.select().from(operatorDecisions).all()).toHaveLength(0)
  })
  it('alerta já reconhecido continua sujeito à autoridade atual',()=>{
    acknowledgeHealthIncident(value.db,'a',()=>authority)
    expect(()=>acknowledgeHealthIncident(value.db,'a',()=>({...authority,channelIds:[]}))).toThrow('Sem acesso')
  })
  it('filtra canais antes do limite e conserva global somente no escopo irrestrito',()=>{
    value.db.insert(healthEvents).values({id:'new-b',channelId:'b',component:'SOURCE',state:'FAILED',occurredAt:'2026-10-10T01:00:00.000Z'}).run()
    expect(readHealthIncidents(value.db,['a'],undefined,1).map(row=>row.id)).toEqual(['a'])
    expect(readHealthIncidents(value.db,[],undefined,10)).toEqual([])
    expect(readHealthIncidents(value.db,null,undefined,10)).toHaveLength(4)
    expect(()=>readHealthIncidents(value.db,['a'],'b',10)).toThrow('Sem acesso')
    expect(readHealthIncidents(value.db,['a'],undefined,10,'2026-10-10T00:00:01.000Z')).toEqual([])
  })
})

describe('ALERTAS do cabeçalho incluem host e relógio (A5)',()=>{
  it('includeHost soma incidentes sem canal só para quem vê todos os canais',()=>{
    expect(readHealthIncidentPage(value.db,null,{channelId:'a',acknowledgement:'PENDING'}).pending).toEqual({critical:1,warn:0})
    expect(readHealthIncidentPage(value.db,null,{channelId:'a',acknowledgement:'PENDING',includeHost:'1'}).pending).toEqual({critical:2,warn:0})
    expect(readHealthIncidentPage(value.db,['a'],{channelId:'a',acknowledgement:'PENDING',includeHost:'1'}).pending).toEqual({critical:1,warn:0})
  })
})

/**
 * Item 14 (achado no ar, r88-35): grade em loop com um VT de 91 s mudo de
 * verdade ("Finaliza Gado Canal", −91 dB). Cada passagem abria um CRÍTICO
 * pendente "PGM silence" e um INFO de recuperação: 2460 críticos pendentes.
 */
import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {eq} from 'drizzle-orm'
import type {IncidentContext} from '@rplayout/protocol'
import {openDatabase} from '../db/client.js'
import {channels,healthEvents,mediaAssets,operatorDecisions} from '../db/schema.js'
import {PgmProbe} from './pgm-probe.js'
import {persistPgmSignalIncidents} from './pgm-signal-incidents.js'
import {readHealthIncidentPage,acknowledgeHealthIncident} from './health-incidents.js'
import {isIntentionalSilence,probeAudioDbfs,setIntentionalSilence,INTENTIONAL_SILENCE_DECISION} from './intentional-silence.js'

let value:ReturnType<typeof openDatabase>
beforeEach(()=>{value=openDatabase(':memory:');value.db.insert(channels).values({id:'a',name:'Canal A',rateNum:25,rateDen:1,width:1920,height:1080,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()})
afterEach(()=>value.sqlite.close())

const context=(itemId:string,itemName:string):IncidentContext=>({version:1,capturedAt:new Date().toISOString(),channelId:'a',rundownId:'rd',revisionId:null,executionId:null,itemId,itemName,elapsedFrames:0,engine:{ready:true,processPresent:true},sources:[],outputs:[],sourcesTruncated:false,outputsTruncated:false,physicalSignalValidated:false})

/** Uma passagem do VT mudo: 4 s de silêncio e depois áudio de novo. */
function pass(probe:PgmProbe){probe.feedMetrics({audioDbfs:-91,deltaMs:4000});probe.feedMetrics({audioDbfs:-12,deltaMs:100});persistPgmSignalIncidents(value.db,'a',probe)}
const pending=()=>readHealthIncidentPage(value.db,null,{channelId:'a'}).pending

describe('alertas repetidos da mesma condição são agrupados', () => {
  it('10 passagens do mesmo VT mudo: 1 crítico pendente com contador e última vez; histórico detalhado preservado', () => {
    const probe=new PgmProbe();let item='finaliza-gado';probe.onContext(()=>context(item,'Finaliza Gado Canal'))
    for(let n=0;n<10;n++)pass(probe)
    expect(pending()).toEqual({critical:1,warn:0})
    const rows=value.db.select().from(healthEvents).all()
    expect(rows).toHaveLength(20)
    const parent=rows.filter(row=>row.severity==='CRITICAL')
    expect(parent).toHaveLength(1)
    expect(parent[0]!.message).toMatch(/Repetiu 10 vezes; última em /)
    expect(rows.filter(row=>row.state==='silence'&&row.severity==='INFO').every(row=>/repetição agrupada/.test(row.message??''))).toBe(true)
    // Outro item mudo é outra condição: outro pendente.
    item='outro-vt';pass(probe)
    expect(pending().critical).toBe(2)
  })

  it('reconhecido o pendente, a próxima ocorrência abre outro; recuperação nunca deixa pendência', () => {
    const probe=new PgmProbe();probe.onContext(()=>context('finaliza-gado','Finaliza Gado Canal'))
    pass(probe);pass(probe)
    const parent=value.db.select().from(healthEvents).where(eq(healthEvents.severity,'CRITICAL')).get()!
    acknowledgeHealthIncident(value.db,parent.id,()=>({actor:'supervisor',channelIds:null,canAcknowledge:true}))
    expect(pending().critical).toBe(0)
    pass(probe)
    expect(pending()).toEqual({critical:1,warn:0})
  })

  it('repetição agrupada que perde a observação (engine parou) não vira aviso pendente', () => {
    const probe=new PgmProbe();probe.onContext(()=>context('finaliza-gado','Finaliza Gado Canal'))
    pass(probe)
    probe.feedMetrics({audioDbfs:-91,deltaMs:4000});probe.idle();persistPgmSignalIncidents(value.db,'a',probe)
    expect(pending()).toEqual({critical:1,warn:0})
  })
})

describe('silêncio intencional marcado no QC', () => {
  const asset={id:'vt-mudo',contentHash:'hash-1'}
  beforeEach(()=>{value.db.insert(mediaAssets).values({id:asset.id,contentHash:asset.contentHash,path:'/m/vt.mxf',title:'Finaliza Gado Canal',kind:'VIDEO',durationFrames:2275,hasAudio:false,createdAt:new Date().toISOString()} as never).run()})

  it('com a marca a sonda não decide silêncio nesse arquivo; sem a marca (ou outra versão) continua alertando', () => {
    expect(probeAudioDbfs(value.db,[-91,-91],asset)).toBe(-91)
    setIntentionalSilence(value.db,asset,true,'qc','a')
    expect(isIntentionalSilence(value.db,asset)).toBe(true)
    expect(probeAudioDbfs(value.db,[-91,-91],asset)).toBeUndefined()
    expect(probeAudioDbfs(value.db,[-91],{...asset,contentHash:'hash-2'})).toBe(-91)
    const probe=new PgmProbe();probe.feedMetrics({audioDbfs:probeAudioDbfs(value.db,[-91],asset),deltaMs:10_000})
    expect(probe.getStatus().activeAlerts).toEqual([])
    // Auditada como decisão do operador; desmarcar volta a alertar.
    expect(value.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind,INTENTIONAL_SILENCE_DECISION)).all()).toHaveLength(1)
    setIntentionalSilence(value.db,asset,false,'qc','a')
    expect(probeAudioDbfs(value.db,[-91],asset)).toBe(-91)
  })
})

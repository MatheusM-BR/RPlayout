/** Item 15 (achado no ar): "OUTPUT · Nome indisponível · estado reportado idle" e "PGM · Nome indisponível · UNMONITORED". */
import {randomUUID} from 'node:crypto'
import {afterEach,beforeEach,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {healthEvents} from '../db/schema.js'
import {ExecutionOwnership} from './execution-ownership.js'
import {observationLabel,persistRuntimeSignalIncidents,runtimeObservationSnapshot} from './runtime-signal-incidents.js'
import type {MetricRuntime} from './operational-metrics.js'
import type {MetricLabels} from './operational-metric-labels.js'

let value:ReturnType<typeof openDatabase>
beforeEach(()=>{value=openDatabase(':memory:');value.sqlite.prepare('INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,25,1,320,180,-23,-1,5,?)').run('a','a','now')})
afterEach(()=>value.sqlite.close())

function runtime(publishers:object[],sources:object[]=[]):MetricRuntime{
  const state={channelId:'a',mode:'NATIVE',rundownId:null,onAir:null,liveSources:sources}
  return {channel:{id:'a'},transport:{state:()=>state,health:()=>({ready:true}),processId:()=>123,publishers:()=>publishers},telemetryIdentity:()=>({revisionId:null,executionId:null})} as unknown as MetricRuntime
}
const labels=(over:Partial<MetricLabels>={}):MetricLabels=>({items:new Map(),sources:new Map(),outputs:new Map(),...over})

it('saída sem nome confirmado usa o perfil pelo id, o monitor ou o id — nunca "Nome indisponível" nem URL', () => {
  const s=runtimeObservationSnapshot(runtime([
    {outputId:'out-1',url:'srt://destino-novo:9000?passphrase=segredo',health:'idle',delivered:0},
    {outputId:'perfil-x',url:'rtmp://127.0.0.1/a/pgm',health:'idle',delivered:0},
    {url:'srt://127.0.0.1:8890?streamid=publish:a/mon',health:'idle',delivered:0},
  ]),labels({outputProfiles:new Map([['out-1',{target:'srt://destino-antigo:9000',name:'Contribuição SP'}]])}))
  const names=s.observations.map(observationLabel)
  expect(names).toEqual(['Contribuição SP (id out-1)','saída id perfil-x','Monitor do PGM'])
  expect(JSON.stringify(names)).not.toMatch(/srt:|rtmp:|segredo/)
})

it('fonte no PGM sem nome no catálogo: o item no barramento; a mensagem gravada não diz "Nome indisponível"', () => {
  const source={source:'ndi://CAM 1',itemId:'item-1',state:'ON_PGM',busStates:{pgm:'ON_PGM'},busSignals:{pgm:{status:'UNMONITORED',videoRecent:false,audioRecent:false,sampleAgeMs:null}}}
  const s=runtimeObservationSnapshot(runtime([{outputId:'out-1',url:'srt://x:1',health:'failed',delivered:0}],[source]),labels({items:new Map([['item-1','Jornal da Manhã']])}))
  expect(observationLabel(s.observations[0]!)).toBe('item Jornal da Manhã')
  const lease=new ExecutionOwnership(value.db,{host:'fixture',pid:100,boot:randomUUID()},()=>false).claim('a')
  persistRuntimeSignalIncidents(value.db,lease,s)
  const messages=value.db.select().from(healthEvents).all().map(row=>row.message??'')
  expect(messages.length).toBeGreaterThan(0)
  expect(messages.join('\n')).not.toContain('Nome indisponível')
  expect(messages.join('\n')).toMatch(/PGM · item Jornal da Manhã · estado reportado ON_PGM/)
  expect(messages.join('\n')).toMatch(/OUTPUT · saída id out-1|OUTPUT · .*out-1/)
})

import {describe,expect,it} from 'vitest'
import {runtimeObservationKey} from './runtime-signal-incidents.js'
import type {MetricRuntime} from './operational-metrics.js'
const signal=(status:string,sampleAgeMs:number)=>({status,sampleAgeMs,videoRecent:true,audioRecent:true})
function runtime(options:{status?:string;age?:number;lifecycle?:string;delivered?:number;health?:string;error?:string|null}={}):MetricRuntime{
  const state={mode:'NATIVE',liveSources:[{source:'ndi:CAM',busStates:{pgm:options.lifecycle??'ON_PGM'},busSignals:{pgm:signal(options.status??'SIGNAL_OK',options.age??200)}}]}
  const publishers=[{outputId:'out',url:'ndi://SAIDA',generation:1,health:options.health??'onAir',delivered:options.delivered??10,error:options.error??null}]
  return {channel:{id:'a'},transport:{state:()=>state,health:()=>({ready:true}),processId:()=>1,publishers:()=>publishers}} as unknown as MetricRuntime
}
describe('chave de observação nativa',()=>{
  it('telemetria repetida com o mesmo significado gera a mesma chave',()=>{
    expect(runtimeObservationKey(runtime({age:100,delivered:10}))).toBe(runtimeObservationKey(runtime({age:900,delivered:5000})))
  })
  it('mudança que o histórico registra muda a chave',()=>{
    const base=runtimeObservationKey(runtime())
    for(const changed of [runtime({status:'NO_AUDIO'}),runtime({age:2000}),runtime({lifecycle:'LOST'}),runtime({health:'retrying'}),runtime({error:'falha'})])
      expect(runtimeObservationKey(changed)).not.toBe(base)
  })
  it('sem engine nativo pronto não há observação',()=>{
    const value=runtime() as any;value.transport.health=()=>({ready:false})
    expect(runtimeObservationKey(value)).toBe('not-observing')
  })
})

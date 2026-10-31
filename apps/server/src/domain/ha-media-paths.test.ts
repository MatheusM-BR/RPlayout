// NOT_RUN: planejamento puro, sem abertura de mídia nem entrega física.
import {it,expect} from 'vitest'
import {haLocalMediaPaths} from './ha-media-paths.js'
const encode=(kind:string,target:string,role?:string)=>JSON.stringify({kind,target,...(role?{role}:{})})
it('declara somente caminhos locais explicitamente revisados — NOT_RUN',()=>{
  const plan=haLocalMediaPaths({program:[encode('rtmp','rtmp://127.0.0.1:1935/reserva/pgm'),encode('srt','srt://127.0.0.1:8890?streamid=publish:reserva/mon','mon')],preview:encode('srt','srt://127.0.0.1:8890?streamid=publish:reserva/pvw')})
  expect(plan).toEqual({paths:['reserva/pgm','reserva/mon','reserva/pvw'],preview:'reserva/pvw',monitor:'reserva/mon',webrtcPort:8889,programDependent:true})
})
it('não converte destino remoto em loopback ou endereço do browser — NOT_RUN',()=>{
  expect(haLocalMediaPaths({program:[encode('rtmp','rtmp://PRIMARY/live/secret')],preview:null}).paths).toEqual([])
})
it('falha de mídia apenas de monitor não implica dependência PGM — NOT_RUN',()=>{
  expect(haLocalMediaPaths({program:['sdi:2',encode('srt','srt://127.0.0.1:8890?streamid=publish:r/mon','mon')],preview:encode('srt','srt://127.0.0.1:8890?streamid=publish:r/pvw')}).programDependent).toBe(false)
})
it('recusa porta divergente, credenciais, reader, path inválido e publishers duplicados — NOT_RUN',()=>{
  for(const target of ['srt://127.0.0.1:9999?streamid=publish:r/pvw','srt://127.0.0.1:8890?streamid=read:r/pvw','srt://127.0.0.1:8890?streamid=publish:../pvw','srt://127.0.0.1:8890?streamid=publish:r/pvw&passphrase=secret'])expect(()=>haLocalMediaPaths({program:[],preview:encode('srt',target)})).toThrow()
  const output=encode('srt','srt://127.0.0.1:8890?streamid=publish:r/pvw')
  expect(()=>haLocalMediaPaths({program:[output],preview:output})).toThrow('mesmo caminho')
})

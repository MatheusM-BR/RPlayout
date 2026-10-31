import {describe,it,expect} from 'vitest'
import {validateAuxiliaryPairs,knownInputAudioChannels} from './media.js'
describe('pares auxiliares numerados',()=>{
  it('aceita silêncio e seleção explícita independente do master',()=>{
    expect(validateAuxiliaryPairs([],2)).toBeNull()
    expect(validateAuxiliaryPairs([{outputPair:2,inputPair:1,gainDb:-6},{outputPair:8,inputPair:32,gainDb:12}],16,64)).toBeNull()
  })
  it('recusa master, destino ausente, colisão, entrada ausente e ganho inválido',()=>{
    for(const pairs of [[{outputPair:1,inputPair:1}],[{outputPair:5,inputPair:1}],[{outputPair:2,inputPair:1},{outputPair:2,inputPair:2}],[{outputPair:2,inputPair:3}],[{outputPair:2,inputPair:0}],[{outputPair:2,inputPair:1,gainDb:NaN}],[{outputPair:2,inputPair:1,gainDb:-61}]])expect(validateAuxiliaryPairs(pairs,8,4)).not.toBeNull()
    expect(validateAuxiliaryPairs([],4)).not.toBeNull()
    expect(validateAuxiliaryPairs([{outputPair:2,inputPair:1}],2)).not.toBeNull()
  })
  it('preserva canais/trilhas declarados sem inventar ausência ou geometria',()=>{
    expect(knownInputAudioChannels({probe:null,audioMetadata:{hasAudio:null,channels:null,tracks:null}})).toBeUndefined()
    expect(knownInputAudioChannels({probe:null,audioMetadata:{hasAudio:false,channels:null,tracks:null}})).toBe(0)
    expect(knownInputAudioChannels({probe:null,audioMetadata:{hasAudio:true,channels:4,tracks:[{index:1,channels:2,rate:48000}]}},1)).toBe(2)
    expect(knownInputAudioChannels({probe:null,audioMetadata:{hasAudio:true,channels:0,tracks:null}})).toBeUndefined()
  })
})

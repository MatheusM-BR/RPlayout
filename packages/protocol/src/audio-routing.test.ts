import {describe,it,expect} from 'vitest'
import {resolvedAudioRouting,validateAudioRouting} from './media.js'
describe('contrato da matriz de entrada estéreo',()=>{
  it('sem campo mantém mix anterior, pares legados são explicitamente resolvidos',()=>{
    expect(resolvedAudioRouting({mode:'OFF',gainDb:0,measured:null})).toEqual({mode:'DEFAULT'})
    expect(resolvedAudioRouting({mode:'OFF',gainDb:0,measured:null,channelMap:[0,2]})).toEqual({mode:'PAIR_MIX',pairs:[0,2]})
  })
  it('não seleciona outro par quando os canais pedidos não existem',()=>{
    expect(validateAudioRouting({mode:'STEREO_3_4'},2)).toContain('exige 4')
    expect(validateAudioRouting({mode:'LEFT_ONLY'},1)).toBeNull()
    expect(validateAudioRouting({mode:'RIGHT_ONLY'},1)).toContain('exige 2')
    expect(validateAudioRouting({mode:'PAIR_MIX',pairs:[0,2]},4)).toContain('exige 6')
  })
  it('matriz tem duas linhas, valores finitos e contagem exata; não expande em silêncio',()=>{
    for(const matrix of [[],[[],[]],[[1],[0,1]],[[NaN],[0]],[[Infinity],[0]],[[1.1],[0]],[[1],[0],[0]]])expect(validateAudioRouting({mode:'MATRIX',matrix})).not.toBeNull()
    expect(validateAudioRouting({mode:'MATRIX',matrix:[[0,-1],[1,0]]},2)).toBeNull()
    expect(validateAudioRouting({mode:'MATRIX',matrix:[[0,-1],[1,0]]},4)).toContain('não corresponde')
    expect(validateAudioRouting({mode:'PAIR_MIX',pairs:[0,0]})).not.toBeNull()
    expect(validateAudioRouting({mode:'DEFAULT',matrix:[[1],[1]]})).not.toBeNull()
  })
})

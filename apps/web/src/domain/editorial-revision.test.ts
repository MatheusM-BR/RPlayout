import {describe,expect,it} from 'vitest'
import {editorialHeaders} from './editorial-revision.js'
describe('revisão editorial enviada pelo cliente',()=>{
  it('preserva a revisão capturada no formulário e valores legados grandes seguros',()=>{
    expect(editorialHeaders(12)).toEqual({'If-Match':'w/"12"'})
    expect(editorialHeaders(2**45)).toEqual({'If-Match':`w/"${2**45}"`})
  })
  it.each([undefined,0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])('não inventa nem consulta revisão para valor inválido %s',revision=>{
    expect(()=>editorialHeaders(revision)).toThrow('Atualize a grade')
  })
})

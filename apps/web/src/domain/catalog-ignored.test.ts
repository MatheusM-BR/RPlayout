import {describe,expect,it} from 'vitest'
import {catalogIgnored} from './catalog-ignored.js'
const own={ignored:false,reviewedRevision:10,contentHash:'HASH'}
describe('feedback local do QC não sobrepõe catálogo novo',()=>{
  it('mostra decisão própria somente sobre a conferência original do mesmo hash',()=>expect(catalogIgnored({ignored:true,qcRevision:10,contentHash:'HASH'},own)).toBe(false))
  it.each([11,9,undefined])('revisão %s prevalece sobre override',qcRevision=>expect(catalogIgnored({ignored:true,qcRevision,contentHash:'HASH'},own)).toBe(true))
  it('mudança de conteúdo prevalece mesmo com contador repetido inválido',()=>expect(catalogIgnored({ignored:true,qcRevision:10,contentHash:'NEW'},own)).toBe(true))
  it('sem override usa catálogo e não fabrica aprovação',()=>expect(catalogIgnored({ignored:true,qcRevision:10,contentHash:'HASH'},undefined)).toBe(true))
  it.each([0,NaN,1.5])('não aplica revisão inválida %s',reviewedRevision=>expect(catalogIgnored({ignored:true,qcRevision:reviewedRevision,contentHash:'HASH'},{...own,reviewedRevision})).toBe(true))
})

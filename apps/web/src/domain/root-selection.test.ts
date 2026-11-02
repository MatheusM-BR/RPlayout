import {describe,it,expect} from 'vitest'
import type {RootAddReview} from '@rplayout/protocol'
import {rootSelectionReady,rootListingMatches} from './root-selection.js'
const review={revision:1,canEdit:true,roots:[],candidate:{path:'C:\\Acervo São José Çãó',realPath:'C:\\Acervo São José Çãó',fingerprint:'own'}} satisfies RootAddReview
describe('pasta visível e conferência correspondem',()=>{
  it('não apresenta subpastas de outro caminho digitado',()=>{
    expect(rootListingMatches(review.candidate.path,review.candidate.path)).toBe(true)
    expect(rootListingMatches(review.candidate.path,review.candidate.path+'\\Região Óptica')).toBe(false)
  })
  it('aceita o caminho Unicode conferido, sem transliterar ou remover acentos',()=>{
    expect(rootSelectionReady(review,review.candidate.path)).toBe(true)
  })
  it('não reutiliza a revisão depois de mudar o caminho',()=>{
    expect(rootSelectionReady(review,'C:\\Acervo Sao Jose Cao')).toBe(false)
    expect(rootSelectionReady(null,review.candidate.path)).toBe(false)
    expect(rootSelectionReady({...review,canEdit:false},review.candidate.path)).toBe(false)
  })
})

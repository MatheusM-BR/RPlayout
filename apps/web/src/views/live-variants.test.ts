import { describe, expect, it } from 'vitest'
import { groupLiveVariants } from './MasterControlView.js'

describe('lives duplicadas por protocolo', () => {
  it('agrupa pelo nome e mantém a ordem; arquivos ficam separados', () => {
    const rows = [
      { id: 'a', title: 'Vinheta' },
      { id: 'b', title: 'DESKTOP (vMix - Output 1)', isLiveSource: true },
      { id: 'c', title: 'DESKTOP (vMix - Output 1)', isLiveSource: true },
      { id: 'd', title: 'Vinheta' },
      { id: 'e', title: 'Estúdio 2', isLiveSource: true },
    ]
    const groups = groupLiveVariants(rows)
    expect(groups.map(group => group.variants.map(variant => variant.id))).toEqual([['a'], ['b', 'c'], ['d'], ['e']])
  })
})

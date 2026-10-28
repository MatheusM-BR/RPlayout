import { describe, expect, it } from 'vitest'
import { groupProblems } from './group-problems.js'

describe('agrupar problemas da sessão', () => {
  it('junta o mesmo motivo e guarda os objetos', () => {
    const groups = groupProblems([
      { id: '1', origem: 'ARQUIVO', texto: 'Vinheta: o arquivo não está mais na pasta', quando: '10:00' },
      { id: '2', origem: 'SAÍDA', texto: 'RTMP caiu', quando: '10:01' },
      { id: '3', origem: 'ARQUIVO', texto: 'Promo: o arquivo não está mais na pasta', quando: '10:02' },
    ])
    expect(groups.map(group => [group.origem, group.motivo, group.itens.length, group.sujeitos])).toEqual([
      ['ARQUIVO', 'o arquivo não está mais na pasta', 2, ['Vinheta', 'Promo']],
      ['SAÍDA', 'RTMP caiu', 1, []],
    ])
  })
})

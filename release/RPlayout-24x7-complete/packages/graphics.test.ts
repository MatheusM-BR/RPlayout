import { describe, expect, it } from 'vitest'
import { escapeXml, fieldsUsedIn, renderTemplate } from './graphics.js'

const template = {
  svg: '<text>{{nome}}</text><text>{{cargo}}</text>',
  fields: [
    { key: 'nome', label: 'Nome', defaultValue: 'sem nome' },
    { key: 'cargo', label: 'Cargo', defaultValue: 'sem cargo' },
  ],
}

describe('grafismo', () => {
  it('preenche os campos que recebe', () => {
    expect(renderTemplate(template, { nome: 'Maria', cargo: 'Repórter' })).toBe(
      '<text>Maria</text><text>Repórter</text>',
    )
  })

  it('cai no padrão do campo quando o valor vem vazio', () => {
    expect(renderTemplate(template, { nome: '' })).toBe(
      '<text>sem nome</text><text>sem cargo</text>',
    )
  })

  it('não deixa `{{chave}}` desconhecida ir ao ar', () => {
    expect(renderTemplate({ svg: '<text>{{fantasma}}</text>', fields: [] }, {})).toBe(
      '<text></text>',
    )
  })

  it('escapa o que quebraria o SVG', () => {
    // Sem isto, um `&` num nome próprio deixa o grafismo inteiro sem aparecer.
    expect(renderTemplate(template, { nome: 'Alves & Cia', cargo: '<b>' })).toBe(
      '<text>Alves &amp; Cia</text><text>&lt;b&gt;</text>',
    )
  })

  it('escapa aspas, que estragam atributo', () => {
    expect(escapeXml('a "b" c')).toBe('a &quot;b&quot; c')
  })

  it('lista os campos que o SVG usa, sem repetir', () => {
    expect(fieldsUsedIn('<a>{{um}}</a><b>{{dois}}</b><c>{{um}}</c>')).toEqual(['um', 'dois'])
  })
})

import { describe, expect, it } from 'vitest'
import { defaultProfileFor, navWorkspaces, profileShowsSettings } from './profiles.js'

describe('perfis de navegação', () => {
  it('operador começa em Operação; demais em Completo', () => {
    expect(defaultProfileFor('Operador')).toBe('OPERACAO')
    expect(defaultProfileFor('Supervisor')).toBe('COMPLETO')
    expect(defaultProfileFor(null)).toBe('COMPLETO')
  })
  it('menu do perfil, com a tela aberta incluída se estiver fora', () => {
    expect(navWorkspaces('OPERACAO', 'master')).toEqual(['master', 'playlist', 'docs'])
    expect(navWorkspaces('OPERACAO', 'aired')).toEqual(['master', 'playlist', 'docs', 'aired'])
    expect(navWorkspaces('COMPLETO', 'settings')).not.toContain('settings')
  })
  it('engrenagem só em Engenharia e Completo', () => {
    expect(profileShowsSettings('OPERACAO')).toBe(false)
    expect(profileShowsSettings('ENGENHARIA')).toBe(true)
  })
})

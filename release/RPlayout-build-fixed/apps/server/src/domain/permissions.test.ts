import { describe, expect, it } from 'vitest'
import { can, parseRole, roleLabel } from './permissions.js'

describe('permissões operacionais', () => {
  it('mantém operador sem publicar ou controlar saídas', () => {
    expect(can('OPERATOR', 'PLAYLIST_EDIT')).toBe(true)
    expect(can('OPERATOR', 'PLAYLIST_PUBLISH')).toBe(false)
    expect(can('OPERATOR', 'OUTPUT_CONTROL')).toBe(false)
  })

  it('supervisor controla operação sem administrar usuários', () => {
    expect(can('SUPERVISOR', 'OUTPUT_CONTROL')).toBe(true)
    expect(can('SUPERVISOR', 'CHANNEL_STOP')).toBe(true)
    expect(can('SUPERVISOR', 'USER_MANAGE')).toBe(false)
  })

  it('entrada desconhecida cai no papel menos privilegiado', () => {
    expect(parseRole('root')).toBe('OPERATOR')
    expect(roleLabel('ADMIN')).toBe('Administrador')
  })
})

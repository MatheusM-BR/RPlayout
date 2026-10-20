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

  it('entrada desconhecida não recebe os privilégios de edição do operador', () => {
    expect(parseRole('root')).toBe('DENIED')
    expect(roleLabel('ADMIN')).toBe('Administrador')
    expect(roleLabel('DENIED')).toBe('Acesso não autorizado')
  })

  it.each(['VIEWER','operator',' ADMIN','ADMIN ',undefined,null,{},['ADMIN'],'constructor','__proto__',''])('papel inválido %j é recusado para toda ação',value=>{
    const role=parseRole(value)
    expect(role).toBe('DENIED')
    for(const action of ['TRANSPORT','PLAYLIST_EDIT','PLAYLIST_PUBLISH','OUTPUT_CONTROL','CHANNEL_STOP','USER_MANAGE','REPORT_EXPORT'] as const)expect(can(role,action)).toBe(false)
  })

  it.each(['OPERATOR','PROGRAMMER','SUPERVISOR','ADMIN'] as const)('mantém contrato do papel válido %s',role=>{
    expect(parseRole(role)).toBe(role);expect(can(role,'TRANSPORT')).toBe(true)
  })
})

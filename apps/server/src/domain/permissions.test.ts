import { describe, expect, it } from 'vitest'
import { can, canManageRole, canShareAcrossChannels, parseRole, roleLabel } from './permissions.js'

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

  it('gestor tem tudo do supervisor e gere só contas abaixo dele; USER_MANAGE segue só do admin', () => {
    for (const action of ['TRANSPORT', 'PLAYLIST_EDIT', 'PLAYLIST_PUBLISH', 'OUTPUT_CONTROL', 'CHANNEL_STOP', 'REPORT_EXPORT'] as const) expect(can('GESTOR', action)).toBe(can('SUPERVISOR', action))
    expect(can('GESTOR', 'USER_MANAGE_LOWER')).toBe(true)
    expect(can('GESTOR', 'USER_MANAGE')).toBe(false)
    expect(can('SUPERVISOR', 'USER_MANAGE_LOWER')).toBe(false)
    expect(can('ADMIN', 'USER_MANAGE')).toBe(true)
    expect(can('ADMIN', 'USER_MANAGE_LOWER')).toBe(true)
    expect(parseRole('GESTOR')).toBe('GESTOR')
    expect(roleLabel('GESTOR')).toBe('Gestor')
    expect(canShareAcrossChannels('GESTOR')).toBe(true)
    expect(canShareAcrossChannels('PROGRAMMER')).toBe(false)
  })

  it('canManageRole: gestor só gere papéis abaixo de gestor; admin gere todos', () => {
    for (const target of ['OPERATOR', 'PROGRAMMER', 'SUPERVISOR'] as const) expect(canManageRole('GESTOR', target)).toBe(true)
    for (const target of ['GESTOR', 'ADMIN', 'DENIED'] as const) expect(canManageRole('GESTOR', target)).toBe(false)
    for (const actor of ['OPERATOR', 'PROGRAMMER', 'SUPERVISOR', 'DENIED'] as const) expect(canManageRole(actor, 'OPERATOR')).toBe(false)
    for (const target of ['OPERATOR', 'SUPERVISOR', 'GESTOR', 'ADMIN'] as const) expect(canManageRole('ADMIN', target)).toBe(true)
  })

  it('entrada desconhecida não recebe os privilégios de edição do operador', () => {
    expect(parseRole('root')).toBe('DENIED')
    expect(roleLabel('ADMIN')).toBe('Administrador')
    expect(roleLabel('DENIED')).toBe('Acesso não autorizado')
  })

  it.each(['VIEWER','operator',' ADMIN','ADMIN ',undefined,null,{},['ADMIN'],'constructor','__proto__',''])('papel inválido %j é recusado para toda ação',value=>{
    const role=parseRole(value)
    expect(role).toBe('DENIED')
    for(const action of ['TRANSPORT','PLAYLIST_EDIT','PLAYLIST_PUBLISH','OUTPUT_CONTROL','CHANNEL_STOP','USER_MANAGE','USER_MANAGE_LOWER','REPORT_EXPORT'] as const)expect(can(role,action)).toBe(false)
  })

  it.each(['OPERATOR','PROGRAMMER','SUPERVISOR','GESTOR','ADMIN'] as const)('mantém contrato do papel válido %s',role=>{
    expect(parseRole(role)).toBe(role);expect(can(role,'TRANSPORT')).toBe(true)
  })
})

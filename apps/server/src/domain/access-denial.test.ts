import { describe, expect, it } from 'vitest'
import { accessDenial } from './access-denial.js'

const probe = (o: { required?: boolean; identity?: unknown; role?: any; channel?: boolean }) => ({
  required: () => o.required ?? true, identity: () => o.identity ?? null, role: () => o.role ?? 'DENIED', channelAllowed: () => o.channel ?? true,
})
describe('B12: 403 diz o motivo real', () => {
  it('papel que nunca teve a permissão não lê "mudou"', () => {
    const text = accessDenial(probe({ identity: { id: 'u' }, role: 'OPERATOR' }), {}, 'PLAYLIST_PUBLISH', 'c', 'publicar a grade')
    expect(text).toBe('Seu papel (Operador) não permite publicar a grade. Nada foi alterado.')
    expect(text).not.toContain('mudou')
  })
  it('sessão ausente, canal fora do acesso e mudança no meio da operação', () => {
    expect(accessDenial(probe({}), {}, 'PLAYLIST_EDIT', 'c', 'editar a grade')).toContain('Sessão ausente ou expirada')
    expect(accessDenial(probe({ identity: { id: 'u' }, role: 'ADMIN', channel: false }), {}, 'PLAYLIST_EDIT', 'c', 'editar a grade')).toContain('não tem acesso a este canal')
    expect(accessDenial(probe({ identity: { id: 'u' }, role: 'ADMIN' }), {}, 'PLAYLIST_EDIT', 'c', 'editar a grade')).toContain('mudou durante a operação')
  })
})

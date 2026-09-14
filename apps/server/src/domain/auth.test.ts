import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './auth.js'

describe('autenticação', () => {
  it('deriva e verifica senha sem armazenar texto puro', async () => {
    const encoded = await hashPassword('senha-de-teste')
    expect(encoded).toMatch(/^scrypt\$/)
    expect(await verifyPassword('senha-de-teste', encoded)).toBe(true)
    expect(await verifyPassword('outra-senha', encoded)).toBe(false)
  })
})

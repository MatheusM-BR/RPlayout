import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './auth.js'

describe('autenticação', () => {
  it('formato adulterado e senha excessiva são recusados sem reinterpretar scrypt',async()=>{
    const encoded=await hashPassword('senha-de-teste')
    for(const hash of [encoded.replace('scrypt$','unknown$'),encoded+'00','scrypt$'+'ab'.repeat(16)+'$'+'aa'.repeat(100000),'NO_LOGIN'])expect(await verifyPassword('senha-de-teste',hash)).toBe(false)
    expect(await verifyPassword('x'.repeat(1025),encoded)).toBe(false)
  })
  it('deriva e verifica senha sem armazenar texto puro', async () => {
    const encoded = await hashPassword('senha-de-teste')
    expect(encoded).toMatch(/^scrypt\$/)
    expect(await verifyPassword('senha-de-teste', encoded)).toBe(true)
    expect(await verifyPassword('outra-senha', encoded)).toBe(false)
  })
})

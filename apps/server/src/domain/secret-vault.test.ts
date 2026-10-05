import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadInstallationVault, SecretVault, SECRET_PREFIX } from './secret-vault.js'

describe('envelopes autenticados e chave fora do banco', () => {
  it('MAC de revisão é estável no mesmo cofre, separado por contexto e das identidades de fonte',()=>{
    const key=randomBytes(32),first=new SecretVault(key),second=new SecretVault(key),other=new SecretVault(randomBytes(32))
    const value='private:password=CONFIDENCIAL'
    expect(first.reviewIdentity(value,'scope:v1')).toBe(second.reviewIdentity(value,'scope:v1'))
    expect(first.reviewIdentity(value,'scope:v1')).not.toBe(other.reviewIdentity(value,'scope:v1'))
    expect(first.reviewIdentity(value,'scope:v1')).not.toBe(first.reviewIdentity(value,'publish:v1'))
    expect(first.reviewIdentity(value,'scope:v1')).not.toBe(first.sourceIdentity(value))
    expect(first.reviewIdentity(value,'scope:v1')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
  it('preserva Unicode e valor vazio sem deixar credenciais legíveis; nonce é exclusivo', () => {
    const vault = new SecretVault(randomBytes(32))
    for (const value of ['', 'srt://host:9000?passphrase=SEGREDO-ÇÃO', 'NDI:ESTÚDIO']) {
      const first = vault.encrypt(value,'outputs.target'), second = vault.encrypt(value,'outputs.target')
      expect(first.startsWith(SECRET_PREFIX)).toBe(true)
      expect(first).not.toBe(second)
      expect(first).not.toContain('SEGREDO')
      expect(vault.decrypt(first,'outputs.target')).toBe(value)
    }
  })
  it('recusa alteração, chave errada, campo errado e ciphertext truncado sem vazar o segredo', () => {
    const vault = new SecretVault(randomBytes(32)), other = new SecretVault(randomBytes(32))
    const value = vault.encrypt('password=CONFIDENCIAL', 'live.srt')
    expect(() => other.decrypt(value,'live.srt')).toThrow('chave')
    expect(() => vault.decrypt(value,'outputs.target')).toThrow('chave')
    expect(() => vault.decrypt(value.slice(0,-8),'live.srt')).toThrow('chave')
    expect(() => vault.decrypt(SECRET_PREFIX+'AAAA','live.srt')).toThrow('chave')
    expect(() => vault.decrypt('legacy-clear','live.srt')).toThrow('migração')
    expect(vault.decrypt('legacy-clear','live.srt',true)).toBe('legacy-clear')
  })
  it('não cria chave quando uma instalação protegida precisa recuperar a existente', () => {
    const path = join(mkdtempSync(join(tmpdir(),'RPlayout-vault-')), 'key.json')
    expect(() => loadInstallationVault(path, false)).toThrow('ausente')
  })
  it('cria chave durável sem substituir o arquivo e reabre seus envelopes (DPAPI no Windows)', () => {
    const path = join(mkdtempSync(join(tmpdir(),'RPlayout-vault-')), 'key.json')
    const first = loadInstallationVault(path, true), stored = readFileSync(path,'utf8')
    const encrypted = first.encrypt('TESTE SOMENTE', 'test')
    const second = loadInstallationVault(path, false)
    expect(second.decrypt(encrypted,'test')).toBe('TESTE SOMENTE')
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(readFileSync(path,'utf8')).toBe(stored)
    if (process.platform === 'win32') expect(JSON.parse(stored).protection).toBe('WINDOWS_CURRENT_USER')
  })
})

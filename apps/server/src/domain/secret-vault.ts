import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export const SECRET_PREFIX = 'rplayout-secret:v1:'

/** Authenticated envelopes bound to a field context, not reusable ciphertext
 * credentials across tables. Keys are never included in the database envelope. */
export class SecretVault {
  private readonly key: Buffer
  readonly fingerprint: string
  constructor(key: Uint8Array) {
    if (key.length !== 32) throw new Error('A chave do cofre deve ter 32 bytes.')
    this.key = Buffer.from(key)
    this.fingerprint = createHash('sha256').update('rplayout-vault-key-v1').update(this.key).digest('hex')
  }
  encrypt(value: string, context: string): string {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce, { authTagLength: 16 })
    cipher.setAAD(Buffer.from(`rplayout:${context}`, 'utf8'))
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return SECRET_PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64')
  }
  decrypt(value: string, context: string, allowLegacyPlaintext = false): string {
    if (!value.startsWith(SECRET_PREFIX)) {
      if (allowLegacyPlaintext) return value
      throw new Error('Valor não protegido; migração do cofre necessária.')
    }
    try {
      const encoded = value.slice(SECRET_PREFIX.length)
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error('Envelope inválido')
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.length < 28) throw new Error('Envelope truncado')
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0,12), { authTagLength: 16 })
      decipher.setAAD(Buffer.from(`rplayout:${context}`, 'utf8'))
      decipher.setAuthTag(bytes.subarray(12,28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    } catch {
      // Do not reveal ciphertext, supplied values, keys or crypto internals.
      throw new Error('Não foi possível abrir o segredo. Confira a chave da instalação; valor alterado ou chave incompatível.')
    }
  }
  /** Stable, non-reversible source identity. A separate derived HMAC key
   * identifies a URI across randomized envelopes without deterministic AES
   * nonces, plaintext hashes or exposing the installation key. */
  sourceIdentity(value: string): string {
    const derived = createHmac('sha256', this.key).update('rplayout:source-identity-key:v1').digest()
    try { return createHmac('sha256', derived).update(value, 'utf8').digest('base64url') }
    finally { derived.fill(0) }
  }
  /** Separate MAC domain: review tokens cannot be repurposed as source IDs,
   * nor used as offline hashes of private fields included in the review. */
  reviewIdentity(value:string,context:string):string{
    const derived=createHmac('sha256',this.key).update('rplayout:review-key:v1').digest()
    try{return createHmac('sha256',derived).update(context).update('\0').update(value,'utf8').digest('base64url')}
    finally{derived.fill(0)}
  }
}

interface WrappedKey { version: 1; protection: 'WINDOWS_CURRENT_USER' | 'OWNER_FILE'; data: string }
function windowsProtect(data: Buffer, decrypt: boolean): Buffer {
  // The secret is delivered through stdin, never through process arguments.
  // CurrentUser avoids granting decryption to every account on the machine.
  const method = decrypt ? 'Unprotect' : 'Protect'
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; " +
    '$value=[Convert]::FromBase64String([Console]::In.ReadToEnd()); ' +
    `$result=[Security.Cryptography.ProtectedData]::${method}($value,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
    '[Console]::Out.Write([Convert]::ToBase64String($result))'
  try {
    const value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: data.toString('base64'), encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['pipe','pipe','pipe'] })
    return Buffer.from(value.trim(), 'base64')
  } catch {
    throw new Error('Cofre indisponível: o Windows não conseguiu proteger/abrir a chave para este usuário. Não troque nem apague a chave existente.')
  }
}

/** File creation uses exclusive open so concurrent startup never replaces a key.
 * A missing key with existing ciphertext must fail closed, not generate a new
 * incompatible key. Backups moved to another Windows account require an
 * explicitly preserved shared key; a SQLite copy alone cannot recover secrets. */
export function loadInstallationVault(path: string, allowCreate: boolean): SecretVault {
  if (!existsSync(path)) {
    if (!allowCreate) throw new Error('Chave do cofre ausente. Restaure a chave da instalação antes de abrir o banco protegido.')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const key = randomBytes(32)
    const wrapped: WrappedKey = { version: 1, protection: process.platform === 'win32' ? 'WINDOWS_CURRENT_USER' : 'OWNER_FILE', data: (process.platform === 'win32' ? windowsProtect(key, false) : key).toString('base64') }
    try { writeFileSync(path, JSON.stringify(wrapped), { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    finally { key.fill(0) }
  }
  try {
    const permissions = lstatSync(path)
    if (!permissions.isFile() || permissions.isSymbolicLink()) throw new Error('Arquivo de chave inválido')
    if (process.platform !== 'win32' && ((permissions.mode & 0o077) !== 0 || (process.getuid && permissions.uid !== process.getuid()))) throw new Error('A chave deve pertencer ao usuário do servidor e ter permissão 0600')
    const wrapped = JSON.parse(readFileSync(path, 'utf8')) as WrappedKey
    if (wrapped.version !== 1 || typeof wrapped.data !== 'string') throw new Error('Formato inválido')
    const bytes = Buffer.from(wrapped.data, 'base64')
    if (wrapped.protection === 'WINDOWS_CURRENT_USER' && process.platform !== 'win32') throw new Error('Chave pertence ao Windows')
    if (!['WINDOWS_CURRENT_USER','OWNER_FILE'].includes(wrapped.protection)) throw new Error('Proteção inválida')
    if (process.platform === 'win32' && wrapped.protection !== 'WINDOWS_CURRENT_USER') throw new Error('Chave não protegida pelo Windows')
    const key = wrapped.protection === 'WINDOWS_CURRENT_USER' ? windowsProtect(bytes, true) : bytes
    try { return new SecretVault(key) } finally { key.fill(0) }
  } catch {
    throw new Error('Chave do cofre inválida ou pertencente a outro usuário/sistema. Restaure a chave correta; ela não será substituída automaticamente.')
  }
}

let installation: SecretVault | null = null
export function installationVault(allowCreate = true): SecretVault {
  if (installation) return installation
  const explicit = process.env.RPLAYOUT_VAULT_KEY
  if (explicit) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(explicit)) throw new Error('RPLAYOUT_VAULT_KEY inválida: use base64 de exatamente 32 bytes.')
    const key = Buffer.from(explicit, 'base64')
    try { installation = new SecretVault(key) } finally { key.fill(0) }
  } else if (process.env.VITEST) {
    // Isolated workers never read/create the operator's installation key.
    installation = new SecretVault(randomBytes(32))
  } else {
    const file = process.env.RPLAYOUT_VAULT_FILE ?? resolve(process.env.LOCALAPPDATA ?? process.cwd(), 'RPlayout', 'security', 'vault.json')
    installation = loadInstallationVault(file, allowCreate)
  }
  return installation
}

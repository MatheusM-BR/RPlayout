import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, stat, utimes, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileVersionVerifier, isMediaSha } from './file-version.js'

const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex')
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'rplayout-file-version-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('identidade real do arquivo publicado', () => {
  it('confere SHA em caminho Unicode, aceita maiúsculas e não aceita identificador legado como prova', async () => {
    const path = join(directory, 'APROVAÇÃO-ÇÃÓ.mkv'), check = new FileVersionVerifier()
    await writeFile(path, 'original')
    expect(await check.matches(path, sha('original').toUpperCase())).toBe(true)
    expect(await check.matches(path, sha('original'))).toBe(true)
    expect(await check.matches(path, 'legacy')).toBe(false)
    expect(isMediaSha(undefined)).toBe(false)
  })
  it('recusa bytes trocados mesmo com mesmo tamanho e mtime restaurado', async () => {
    const path = join(directory, 'copia.mkv'), check = new FileVersionVerifier()
    await writeFile(path, 'original')
    const original = await stat(path)
    expect(await check.matches(path, sha('original'))).toBe(true)
    await writeFile(path, 'alterado'); await utimes(path, original.atime, original.mtime)
    expect((await stat(path)).size).toBe(original.size)
    expect(await check.matches(path, sha('original'))).toBe(false)
    expect(await check.matches(path, sha('alterado'))).toBe(true)
  })
  it('não reutiliza resultado inválido após restauração nem resultado de outro SHA', async () => {
    const path = join(directory, 'restore.mkv'), check = new FileVersionVerifier()
    await writeFile(path, 'alterado')
    expect(await check.matches(path, sha('original'))).toBe(false)
    await writeFile(path, 'original')
    expect(await check.matches(path, sha('original'))).toBe(true)
    expect(await check.matches(path, sha('alterado'))).toBe(false)
  })
  it('revalida troca de inode no mesmo caminho e aceita evidência sem cache', async () => {
    const path = join(directory, 'selected.mkv'), replacement = join(directory, 'replacement.mkv')
    const check = new FileVersionVerifier(0)
    await writeFile(path, 'original'); expect(await check.matches(path, sha('original'))).toBe(true)
    await writeFile(replacement, 'alterado'); await rename(replacement, path)
    expect(await check.matches(path, sha('original'))).toBe(false)
    expect(await check.matches(directory, sha('original'))).toBe(false)
    await expect(check.matches(join(directory, 'ausente.mkv'), sha('original'))).rejects.toThrow()
  })
})

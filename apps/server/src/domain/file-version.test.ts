import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, stat, utimes, rename,open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it,vi } from 'vitest'
vi.mock('node:fs/promises',async original=>{const actual=await original<typeof import('node:fs/promises')>();return {...actual,open:vi.fn(actual.open)}})
import { FileVersionVerifier, isMediaSha } from './file-version.js'

const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex')
let directory: string
beforeEach(async () => { vi.mocked(open).mockClear();directory = await mkdtemp(join(tmpdir(), 'rplayout-file-version-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('identidade real do arquivo publicado', () => {
  it('shares one initial hash across simultaneous preview readers',async()=>{
    const path=join(directory,'shared.mkv'),content='preview'.repeat(200000),check=new FileVersionVerifier(0)
    await writeFile(path,content)
    expect(await Promise.all(Array.from({length:20},()=>check.matches(path,sha(content))))).toEqual(Array(20).fill(true))
    expect(vi.mocked(open)).toHaveBeenCalledTimes(1)
    expect(await check.matches(path,sha(content))).toBe(true)
    expect(vi.mocked(open)).toHaveBeenCalledTimes(2) // no in-flight result retained
  })
  it('does not share evidence between distinct expected hashes',async()=>{
    const path=join(directory,'hashes.mkv'),check=new FileVersionVerifier(0)
    await writeFile(path,'original')
    expect(await Promise.all([check.matches(path,sha('original')),check.matches(path,sha('alterado'))])).toEqual([true,false])
    expect(vi.mocked(open)).toHaveBeenCalledTimes(2)
  })
  it('failed shared read is released so a later request can verify again',async()=>{
    const path=join(directory,'retry.mkv'),check=new FileVersionVerifier(0)
    await writeFile(path,'original')
    let fail!:(error:Error)=>void
    vi.mocked(open).mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject}))
    const waiting=Promise.allSettled([check.matches(path,sha('original')),check.matches(path,sha('original'))])
    await new Promise(resolve=>setTimeout(resolve,50))
    expect(vi.mocked(open)).toHaveBeenCalledTimes(1)
    fail(new Error('Temporary read failure'))
    const outcomes=await waiting
    expect(outcomes.map(outcome=>outcome.status)).toEqual(['rejected','rejected'])
    expect(vi.mocked(open)).toHaveBeenCalledTimes(1)
    expect(await check.matches(path,sha('original'))).toBe(true)
    expect(vi.mocked(open)).toHaveBeenCalledTimes(2)
  })
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

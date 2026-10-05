import { execFile } from 'node:child_process'
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writePrivateConfig } from './private-config-file.js'
import { MediaMtx } from './mediamtx.js'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'RPlayout-private-config-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('configuração gerada com chave de ingest', () => {
  it('publica arquivo completo e verifica permissões reais do Windows/Unix', async () => {
    const path = join(directory, 'CONFIGURAÇÃO — ação.yml')
    await writePrivateConfig(path, 'paths:\n  guest/PRIVATE_TEST_KEY:\n')
    expect(await readFile(path, 'utf8')).toBe('paths:\n  guest/PRIVATE_TEST_KEY:\n')
    expect(await readdir(directory)).toEqual(['CONFIGURAÇÃO — ação.yml'])
    if (process.platform === 'win32') {
      const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$acl=[IO.File]::GetAccessControl('${path.replaceAll("'", "''")}'); $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [Console]::Out.Write((@{protected=$acl.AreAccessRulesProtected; owner=$owner; rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { @{sid=$_.IdentityReference.Value; inherited=$_.IsInherited} })}|ConvertTo-Json -Compress))`], { windowsHide: true, timeout: 5000, encoding: 'utf8' })
      const acl = JSON.parse(result.stdout)
      expect(acl.protected).toBe(true); expect(acl.rules).toHaveLength(acl.owner === 'S-1-5-18' ? 1 : 2)
      expect(acl.rules.every((rule: {sid: string; inherited: boolean}) => [acl.owner, 'S-1-5-18'].includes(rule.sid) && !rule.inherited)).toBe(true)
    } else expect((await lstat(path)).mode & 0o777).toBe(0o600)
  }, 15_000)
  it('substitui apenas configuração sem modificar arquivo original ligado por hardlink', async () => {
    const original = join(directory, 'foreign.txt'), target = join(directory, 'mediamtx.yml')
    await writeFile(original, 'ORIGINAL_BYTES'); await link(original, target)
    await writePrivateConfig(target, 'NEW_PRIVATE_CONFIG')
    expect(await readFile(original, 'utf8')).toBe('ORIGINAL_BYTES')
    expect(await readFile(target, 'utf8')).toBe('NEW_PRIVATE_CONFIG')
  }, 10_000)
  it('recusa diretório sem alterar destino ou deixar chave temporária', async () => {
    const target = join(directory, 'directory.yml'); await mkdir(target)
    await expect(writePrivateConfig(target, 'PRIVATE_TEST_KEY')).rejects.toThrow('arquivo regular')
    expect(await readdir(directory)).toEqual(['directory.yml'])
  })
  it('configurações concorrentes são publicadas na ordem e a última revoga a chave', async () => {
    const configPath = join(directory, 'mediamtx.yml')
    const media = new MediaMtx({ binary: '', configPath, bind: '127.0.0.1', logLevel: 'warn' })
    await Promise.all([media.apply([], [{ label: 'Test', streamKey: 'PRIVATE_TEST_KEY' }]), media.apply([], [])])
    const final = await readFile(configPath, 'utf8')
    expect(final).not.toContain('PRIVATE_TEST_KEY'); expect(final).toContain('apiAddress: 127.0.0.1:9997')
    expect(await readdir(directory)).toEqual(['mediamtx.yml'])
  }, 15_000)
  it('MediaMTX em execução espera a janela do watcher antes de uma segunda revogação', async () => {
    const media = new MediaMtx({ binary: '', configPath: join(directory, 'mediamtx.yml'), bind: '127.0.0.1', logLevel: 'warn' })
    const running = vi.spyOn(media, 'running', 'get').mockReturnValue(true)
    const timer = vi.spyOn(globalThis, 'setTimeout')
    try {
      await media.apply([], [{ label: 'Test', streamKey: 'PRIVATE_TEST_KEY' }])
      await media.apply([], [])
      expect(timer.mock.calls.some(call => typeof call[1] === 'number' && call[1] > 0 && call[1] <= 1100)).toBe(true)
      expect(await readFile(join(directory, 'mediamtx.yml'), 'utf8')).not.toContain('PRIVATE_TEST_KEY')
    } finally { timer.mockRestore(); running.mockRestore() }
  }, 15_000)
})

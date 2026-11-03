/** Item 13 (achado no ar): no Windows instalado, a versão saía "desconhecida" e o build nulo. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dirs: string[] = []
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function installation(receipt: object | null, manifest: object | null): { root: string; server: string } {
  const root = mkdtempSync(join(tmpdir(), 'rplayout-instalado-')); dirs.push(root)
  // Recibo gravado pelo install-rplayout-partial.ps1 (UTF-8 sem BOM) e
  // manifesto do pacote (Set-Content -Encoding UTF8 do PowerShell 5.1 põe BOM).
  if (receipt) writeFileSync(join(root, 'installation-receipt.json'), JSON.stringify(receipt))
  if (manifest) writeFileSync(join(root, 'package-manifest.json'), `﻿${JSON.stringify(manifest)}`)
  const server = join(root, 'apps', 'server', 'dist'); mkdirSync(server, { recursive: true })
  return { root, server }
}

describe('versão da instalação empacotada', () => {
  it('lê a edição do recibo e o commit do manifesto, subindo a partir do servidor', async () => {
    const { installedEdition } = await import('./software-version.js')
    const { root, server } = installation(
      { version: 1, edition: 'RPlayout-1.1-parcial-20261020-r88-35', installedAt: '2026-11-01T10:00:00Z', integrity: 'VERIFIED' },
      { version: 1, builtAt: '2026-10-31T22:00:00Z', commit: 'ddd7b8b', files: [] },
    )
    expect(installedEdition([server])).toEqual({ edition: 'RPlayout-1.1-parcial-20261020-r88-35', commit: 'ddd7b8b', root })
  })

  it('pacote antigo sem commit no manifesto: edição do recibo, commit nulo; nada instalado: nulo', async () => {
    const { installedEdition } = await import('./software-version.js')
    const { server } = installation({ version: 1, edition: 'RPlayout-1.1-parcial-20261020-r88-35' }, { version: 1, files: [] })
    expect(installedEdition([server])).toMatchObject({ edition: 'RPlayout-1.1-parcial-20261020-r88-35', commit: null })
    const empty = mkdtempSync(join(tmpdir(), 'rplayout-vazio-')); dirs.push(empty)
    expect(installedEdition([empty])?.edition ?? null).toBeNull()
  })

  it('GET /api/engineering/status mostra a edição completa e o commit (softwareVersion)', async () => {
    const { root } = installation({ version: 1, edition: 'RPlayout-1.1-parcial-20261101-r88-36' }, { version: 1, commit: 'b2c2229', files: [] })
    vi.stubEnv('RPLAYOUT_INSTALL_ROOT', root)
    vi.stubEnv('RPLAYOUT_BUILD', '')
    vi.resetModules()
    const { softwareVersion } = await import('./software-version.js')
    expect(softwareVersion()).toMatchObject({ rplayout: 'RPlayout-1.1-parcial-20261101-r88-36', build: 'b2c2229' })
  })
})

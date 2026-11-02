import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, type App } from '../app.js'
import { registerRoutes } from '../routes.js'

let app: App, server: ReturnType<typeof Fastify>, dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rplayout-file-target-'))
  app = await createApp(':memory:')
  server = Fastify(); registerRoutes(app, server, () => {}); await server.ready()
})
afterEach(async () => { await server?.close(); app?.close(); await rm(dir, { recursive: true, force: true }) })

describe('escolha de gravação somente na página remota', () => {
  it('desativa os dois seletores nativos', async () => {
    for (const url of ['/api/files/pick', '/api/library/roots/pick']) {
      const response = await server.inject({ method: 'POST', url })
      expect(response.statusCode).toBe(410)
      expect(response.json().error).toContain('desativado')
    }
  })
  it('resolve caminho acentuado sem gravar nem cadastrar saída', async () => {
    const folder = join(dir, 'Programação — Ação'); await mkdir(folder)
    const before = (await server.inject({ url: '/api/processes' })).json().processes
    const response = await server.inject({ method: 'POST', url: '/api/files/target', payload: { folder, filename: 'Ópera.mkv' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ path: join(folder, 'Ópera.mkv') })
    expect(existsSync(join(folder, 'Ópera.mkv'))).toBe(false)
    expect((await server.inject({ url: '/api/processes' })).json().processes).toEqual(before)
  })
  it('recusa conflito sem sobrescrever e rejeita traversal ou corpo incompleto', async () => {
    const original = join(dir, 'Original.mkv'); await writeFile(original, 'MANTER')
    const conflict = await server.inject({ method: 'POST', url: '/api/files/target', payload: { folder: dir, filename: 'Original.mkv' } })
    expect(conflict.statusCode).toBe(409)
    expect(await readFile(original, 'utf8')).toBe('MANTER')
    for (const payload of [{ folder: dir, filename: '../fora.mkv' }, { folder: dir }, { folder: dir, filename: 'falso.mp4' }]) {
      expect((await server.inject({ method: 'POST', url: '/api/files/target', payload })).statusCode).toBe(400)
    }
  })
})

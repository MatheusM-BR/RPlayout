/**
 * Achado 5 da revisão da r88-36 (HA e volta de versão): o banco e os projetos
 * exportados pela r88-36 têm de continuar válidos para a r88-35, que recusa
 * monitor (PREVIEW/MONITOR) com perfil em branco em `validateOutputProfile`,
 * `prepareHaLocalOutputs` e `assertProjectContract`.
 *
 * O validador da r88-35 abaixo é cópia literal de
 * `git show ddd7b8b:apps/server/src/domain/outputs.ts`. Com `r8835.on`, o
 * `validateOutputProfile` que o contrato de projeto e a preparação HA usam é
 * o antigo: é a r88-35 lendo o que a r88-36 gravou.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const r8835 = vi.hoisted(() => ({ on: false }))
vi.mock('./outputs.js', async (original) => {
  const real = await original<typeof import('./outputs.js')>()
  const { monitorSize } = await import('@rplayout/protocol')
  // ---- r88-35 (ddd7b8b), literal ----
  function lowBandwidthMonitor(channel: { width: number; height: number }) {
    const [width, height] = monitorSize(channel.width, channel.height)
    return { width, height, rateNum: 15, rateDen: 1, scan: 'PROGRESSIVE', bitrateKbps: 450 }
  }
  function validateOutputProfile(row: import('./outputs.js').OutputProfileRow, channel?: { width: number; height: number }): void {
    if (row.role === 'EXTRA') {
      if (row.kind === 'RTMP' || row.kind === 'SRT') {
        let url: URL
        try { url = new URL(row.target) } catch { throw new Error('Informe um endereço completo para o protocolo selecionado.') }
        if (!url.hostname || !(row.kind === 'RTMP' ? ['rtmp:', 'rtmps:'] : ['srt:']).includes(url.protocol)) throw new Error('O endereço não corresponde ao protocolo selecionado.')
      }
      if (row.kind === 'SDI' && !/^\d+$/.test(row.target)) throw new Error('Na SDI o destino é o número do conector: 0, 1, 2…')
      if (row.kind === 'FILE' && /^[a-z][a-z0-9+.-]*:\/\//i.test(row.target)) throw new Error('Gravação usa caminho de arquivo no servidor, não URL de streaming.')
    }
    if ((row.rateNum === null) !== (row.rateDen === null)) throw new Error('Informe numerador e denominador da cadência juntos, ou ambos automáticos.')
    if (row.role === 'PREVIEW' || row.role === 'MONITOR') {
      const limits = lowBandwidthMonitor(channel ?? { width: 1920, height: 1080 })
      if (row.width === null || row.height === null || row.width > limits.width! || row.height > limits.height! || row.rateNum === null || row.rateDen === null || row.rateNum / row.rateDen > 15 || row.scan !== 'PROGRESSIVE' || row.bitrateKbps === null || row.bitrateKbps > 450) throw new Error('Preview/monitor devem permanecer leves: tamanho reduzido, até 15 fps, progressivo e de 50 a 450 kbps, sem herdar o PGM.')
    }
  }
  // ---- fim da cópia ----
  return { ...real, validateOutputProfile: (row: import('./outputs.js').OutputProfileRow, channel?: { width: number; height: number }) => r8835.on ? validateOutputProfile(row, channel) : real.validateOutputProfile(row, channel) }
})

import { openDatabase } from '../db/client.js'
import { channels, channelProjectSnapshots, outputProfiles } from '../db/schema.js'
import { ensureManagedOutputs, listOutputs, monitorProfilePatch, toEngineProfile, validateOutputProfile, type OutputProfileRow } from './outputs.js'
import { assertProjectContract } from './project-contract.js'
import { saveChannelProject } from './channel-projects.js'
import { prepareHaLocalOutputs } from './ha-local-outputs.js'
import type { ChannelPaths } from './mediamtx.js'

const databases: ReturnType<typeof openDatabase>[] = []
afterEach(() => { r8835.on = false; for (const value of databases.splice(0)) value.sqlite.close() })

const channel = { id: 'c', name: 'Canal', rateNum: 25, rateDen: 1, width: 1920, height: 1080, targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt: '2026-11-01T00:00:00.000Z' }
const path: ChannelPaths = { channelId: 'c', program: 'c/pgm', clean: 'c/clean', preview: 'c/pvw', monitor: 'c/mon' } as ChannelPaths

async function fixture() {
  const value = openDatabase(':memory:'); databases.push(value)
  value.db.insert(channels).values(channel).run()
  const domainChannel = { ...channel, rate: { num: 25, den: 1 }, scan: 'PROGRESSIVE' as const }
  await ensureManagedOutputs(value.db, domainChannel as never, path)
  return { ...value, domainChannel }
}

describe('monitores da r88-36 continuam válidos para a r88-35', () => {
  it('canal novo grava o perfil leve legado (compatível) e o tempo de execução o lê como automático', async () => {
    const { db } = await fixture()
    const rows = await listOutputs(db, 'c')
    const monitors = rows.filter((row) => row.role === 'PREVIEW' || row.role === 'MONITOR')
    expect(monitors).toHaveLength(2)
    r8835.on = true
    for (const row of monitors) {
      expect(row).toMatchObject({ width: 428, height: 240, rateNum: 15, rateDen: 1, scan: 'PROGRESSIVE', bitrateKbps: 450 })
      expect(() => validateOutputProfile(row, channel)).not.toThrow()
    }
    r8835.on = false
    for (const row of monitors) {
      const engine = toEngineProfile(row, path) as unknown as Record<string, unknown>
      // Automático: o engine recebe o monitor sem teto (níveis REF/PADRÃO/LEVE).
      expect(engine).not.toHaveProperty('width')
      expect(engine).not.toHaveProperty('rateNum')
      expect(engine).not.toHaveProperty('bitrateKbps')
    }
  })

  it('não reescreve o banco: o legado fica; em branco (dev da r88-36) volta ao legado; o teto do operador fica', async () => {
    const { db, domainChannel } = await fixture()
    const monitor = (await listOutputs(db, 'c')).find((row) => row.role === 'MONITOR')!
    expect(monitorProfilePatch(monitor, domainChannel)).toEqual({})
    const blank: OutputProfileRow = { ...monitor, width: null, height: null, rateNum: null, rateDen: null, scan: null, bitrateKbps: null }
    expect(monitorProfilePatch(blank, domainChannel)).toEqual({ width: 428, height: 240, rateNum: 15, rateDen: 1, scan: 'PROGRESSIVE', bitrateKbps: 450 })
    db.update(outputProfiles).set({ width: null, height: null, rateNum: null, rateDen: null, scan: null, bitrateKbps: null }).where(eq(outputProfiles.id, monitor.id)).run()
    await ensureManagedOutputs(db, domainChannel as never, path)
    expect((await listOutputs(db, 'c')).find((row) => row.id === monitor.id)).toMatchObject({ width: 428, bitrateKbps: 450 })
    // Teto do operador de propósito: fica (e é o único caso que a r88-35 recusa).
    const ceiling: OutputProfileRow = { ...monitor, width: 1280, height: 720, rateNum: 25, rateDen: 1, bitrateKbps: 3000 }
    expect(monitorProfilePatch(ceiling, domainChannel)).toEqual({})
    expect((toEngineProfile(ceiling, path) as unknown as Record<string, unknown>).bitrateKbps).toBe(3000)
  })

  it('projeto exportado da r88-36 passa no assertProjectContract da r88-35', async () => {
    const { db } = await fixture()
    const project = await saveChannelProject(db, 'c', 'Exportado na r88-36')
    const payload = structuredClone(db.select().from(channelProjectSnapshots).where(eq(channelProjectSnapshots.id, project.id)).get()!.payload) as unknown as Record<string, unknown>
    r8835.on = true
    expect(() => assertProjectContract(db, payload)).not.toThrow()
    // Prova de que o teste enxerga a regra antiga: o perfil em branco que a
    // r88-36 gravava antes desta correção não restaurava na r88-35.
    const blank = structuredClone(payload) as { outputs: Record<string, unknown>[] }
    for (const row of blank.outputs) if (row.role === 'MONITOR') Object.assign(row, { width: null, height: null, rateNum: null, rateDen: null, scan: null, bitrateKbps: null })
    expect(() => assertProjectContract(db, blank)).toThrow(/outputs/)
  })

  it('HA: a preparação local da r88-35 aceita o que a r88-36 gravou; a da r88-36 sai automática', async () => {
    const { db } = await fixture()
    const rows = (await listOutputs(db, 'c')).filter((row) => row.role === 'PREVIEW' || row.role === 'MONITOR')
    const plan = { outputs: rows.map((row) => ({ outputId: row.id, kind: 'SRT', target: 'srt://127.0.0.1:8890?streamid=publish:c/x', reason: null })) } as never
    r8835.on = true
    expect(() => prepareHaLocalOutputs({ id: 'c', width: 1920, height: 1080 }, rows, plan)).not.toThrow()
    r8835.on = false
    const prepared = prepareHaLocalOutputs({ id: 'c', width: 1920, height: 1080 }, rows, plan)
    for (const encoded of [...prepared.program, prepared.preview!]) expect(JSON.parse(encoded)).not.toHaveProperty('bitrateKbps')
  })
})

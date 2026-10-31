import { expect, it } from 'vitest'
import { engineTag, formatFreeGb, headerHealthTags } from './HeaderHealth.js'

const sample = (outputs: Array<{ state: string; hasError: boolean }>, engine = { ready: true, hasError: false, restarts: 0, stalls: 0 }, percentUsed: number | null = 42) => ({
  generatedAt: '', sampleIntervalSeconds: 10, cpu: { percent: 10, cores: 8 }, memory: { totalBytes: 1, usedBytes: 1, freeBytes: 0, percent: 50 }, process: { rssBytes: 1, heapUsedBytes: 1 },
  gpu: { utilizationPercent: null, memoryUsedMiB: null, memoryTotalMiB: null, temperatureC: null, name: null, error: null },
  disk: { path: 'D:\\', totalBytes: 1000e9, freeBytes: 575e9, percentUsed, error: null },
  network: { receivedBytesPerSecond: null, sentBytesPerSecond: null, source: null, error: null },
  operations: { version: 1 as const, capturedAt: '', available: true, channelsTruncated: false, channels: [{ channelId: 'ch', rundownId: null, revisionId: null, executionId: null, itemId: null, elapsedFrames: null, mode: null, engine: { pid: 1, cpuTimeMs: null, memoryBytes: null, deaths: 0, ...engine }, sources: [], outputs: outputs.map((output, i) => ({ outputId: String(i), attempts: 0, delivered: 1, ...output })), sourcesTruncated: false, outputsTruncated: false }] },
}) as never

it('saúde real: engine, saídas, disco e alertas', () => {
  const ok = headerHealthTags(sample([{ state: 'onAir', hasError: false }, { state: 'onAir', hasError: true }]), 'ch', { critical: 0, warn: 0 })
  expect(ok.map(tag => `${tag.label}=${tag.value}:${tag.level}`)).toEqual(['ENGINE=OK:ok', 'SAÍDAS=2/2:ok', 'DISCO=42% · 575G:ok', 'ALERTAS=0:ok'])
  const bad = headerHealthTags(sample([{ state: 'retrying', hasError: true }, { state: 'onAir', hasError: false }], { ready: false, hasError: true, restarts: 2, stalls: 0 }, 93), 'ch', { critical: 1, warn: 2 })
  expect(bad.map(tag => `${tag.label}=${tag.value}:${tag.level}`)).toEqual(['ENGINE=PARADO:bad', 'SAÍDAS=1/2:bad', 'DISCO=93% · 575G:bad', 'ALERTAS=3:bad'])
  expect(headerHealthTags(null, 'ch', null).every(tag => tag.level === 'unknown')).toBe(true)
})

it('estado do engine coerente: recusa não é ERRO, reinício não é PARADO (A4)', () => {
  const base = { pid: 1, cpuTimeMs: null, memoryBytes: null, deaths: 1, restarts: 1, stalls: 0 }
  expect(engineTag({ ...base, ready: true, hasError: false, state: 'OK' })).toMatchObject({ value: 'OK · 1↻', level: 'warn' })
  expect(engineTag({ ...base, ready: false, hasError: true, state: 'RESTARTING' })).toMatchObject({ value: 'REINICIANDO', level: 'warn' })
  expect(engineTag({ ...base, ready: false, hasError: true, state: 'FAILED' })).toMatchObject({ value: 'FALHA', level: 'bad' })
  expect(engineTag({ ...base, ready: true, hasError: true, state: 'ALERT' })).toMatchObject({ value: 'ALERTA', level: 'warn' })
  // Servidor antigo sem `state`: erro com engine pronto é ALERTA, não ERRO.
  expect(engineTag({ ...base, ready: true, hasError: true })).toMatchObject({ value: 'ALERTA', level: 'warn' })
})
it('disco mostra GB livres além de % (B1)', () => {
  expect(formatFreeGb(19e9)).toBe('19 GB')
  expect(formatFreeGb(7.5e9)).toBe('7,5 GB')
  expect(formatFreeGb(575e9)).toBe('575 GB')
})

import { expect, it } from 'vitest'
import { headerHealthTags } from './HeaderHealth.js'

const sample = (outputs: Array<{ state: string; hasError: boolean }>, engine = { ready: true, hasError: false, restarts: 0, stalls: 0 }, percentUsed: number | null = 42) => ({
  generatedAt: '', sampleIntervalSeconds: 10, cpu: { percent: 10, cores: 8 }, memory: { totalBytes: 1, usedBytes: 1, freeBytes: 0, percent: 50 }, process: { rssBytes: 1, heapUsedBytes: 1 },
  gpu: { utilizationPercent: null, memoryUsedMiB: null, memoryTotalMiB: null, temperatureC: null, name: null, error: null },
  disk: { path: 'D:\\', totalBytes: 1000e9, freeBytes: 575e9, percentUsed, error: null },
  network: { receivedBytesPerSecond: null, sentBytesPerSecond: null, source: null, error: null },
  operations: { version: 1 as const, capturedAt: '', available: true, channelsTruncated: false, channels: [{ channelId: 'ch', rundownId: null, revisionId: null, executionId: null, itemId: null, elapsedFrames: null, mode: null, engine: { pid: 1, cpuTimeMs: null, memoryBytes: null, deaths: 0, ...engine }, sources: [], outputs: outputs.map((output, i) => ({ outputId: String(i), attempts: 0, delivered: 1, ...output })), sourcesTruncated: false, outputsTruncated: false }] },
}) as never

it('saúde real: engine, saídas, disco e alertas', () => {
  const ok = headerHealthTags(sample([{ state: 'onAir', hasError: false }, { state: 'onAir', hasError: true }]), 'ch', { critical: 0, warn: 0 })
  expect(ok.map(tag => `${tag.label}=${tag.value}:${tag.level}`)).toEqual(['ENGINE=OK:ok', 'SAÍDAS=2/2:ok', 'DISCO=42%:ok', 'ALERTAS=0:ok'])
  const bad = headerHealthTags(sample([{ state: 'retrying', hasError: true }, { state: 'onAir', hasError: false }], { ready: false, hasError: true, restarts: 2, stalls: 0 }, 93), 'ch', { critical: 1, warn: 2 })
  expect(bad.map(tag => `${tag.label}=${tag.value}:${tag.level}`)).toEqual(['ENGINE=PARADO:bad', 'SAÍDAS=1/2:bad', 'DISCO=93%:bad', 'ALERTAS=3:bad'])
  expect(headerHealthTags(null, 'ch', null).every(tag => tag.level === 'unknown')).toBe(true)
})

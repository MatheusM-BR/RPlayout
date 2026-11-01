import { expect, it } from 'vitest'
import { applyTopics, backoffDelay, latestProbe, topicsConnected, topicsDisconnected } from './live-topics.js'
import { notePreviewFailure, notePreviewLoaded, previewBlocked } from './media-preview.js'

it('backoff dobra e para no teto, com folga para abas não baterem juntas', () => {
  const plain = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt)
  for (let attempt = 0; attempt < 12; attempt++) {
    const value = backoffDelay(attempt)
    expect(value).toBeGreaterThanOrEqual(plain(attempt) * 0.8 - 1)
    expect(value).toBeLessThanOrEqual(plain(attempt) * 1.2 + 1)
  }
  expect(backoffDelay(50)).toBeLessThanOrEqual(36_000)
})

it('mensagem de tópicos marca conexão e guarda a leitura viva da sonda', () => {
  topicsDisconnected()
  expect(topicsConnected()).toBe(false)
  applyTopics({ type: 'topics', channelId: 'ch', revs: { probe: 3 }, probe: { lastSampleAt: 'x', metrics: { blackDurationMs: 0, freezeDurationMs: 0, silenceDurationMs: 0, audioDbfs: -20 } } })
  expect(topicsConnected()).toBe(true)
  expect(latestProbe('ch')?.metrics.audioDbfs).toBe(-20)
  topicsDisconnected()
  expect(topicsConnected()).toBe(false)
})

it('proxy leve que falhou (425) não é pedido de novo antes da espera, que dobra', () => {
  const asset = { id: 'a', contentHash: 'h' }
  expect(previewBlocked(asset, 0)).toBe(false)
  expect(notePreviewFailure(asset, 0)).toBe(10_000)
  expect(previewBlocked(asset, 9_999)).toBe(true)
  expect(previewBlocked(asset, 10_000)).toBe(false)
  expect(notePreviewFailure(asset, 10_000)).toBe(20_000)
  for (let i = 0; i < 10; i++) notePreviewFailure(asset, 0)
  expect(notePreviewFailure(asset, 0)).toBe(300_000)
  notePreviewLoaded(asset)
  expect(previewBlocked(asset, 1)).toBe(false)
  expect(previewBlocked({ id: 'a', contentHash: 'outro' }, 1)).toBe(false)
})

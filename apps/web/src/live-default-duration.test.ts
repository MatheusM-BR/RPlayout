import { describe, expect, it } from 'vitest'
import { liveDefaultFrames, LIVE_DEFAULT_MINUTES } from './liveSource.js'
import { dur } from './format.js'

describe('duração padrão de live', () => {
  it('é a mesma no Master e na Playlist e não mostra 59:59 em 29,97', () => {
    const rate = { num: 30000, den: 1001 }
    expect(LIVE_DEFAULT_MINUTES).toBe(60)
    expect(dur(liveDefaultFrames(rate), rate)).toMatch(/^0?1:00:00/)
    expect(liveDefaultFrames({ num: 25, den: 1 })).toBe(90000)
  })
})

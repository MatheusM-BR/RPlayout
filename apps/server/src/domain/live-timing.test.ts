import { describe, expect, it } from 'vitest'
import type { RundownItem } from '@rplayout/protocol'
import { liveDurationLimit } from './live-timing.js'
describe('duração operacional de live', () => {
  it('estimativa manual não encerra o live; automático respeita o máximo', () => {
    const item = { liveEstimatedDuration: 7500, liveMaxDuration: 9000, liveAutoFollowOnEnd: false } as RundownItem
    expect(liveDurationLimit(item, 7500)).toBeNull()
    expect(liveDurationLimit({ ...item, liveAutoFollowOnEnd: true }, 7500)).toBe(7500)
    expect(liveDurationLimit({ ...item, liveAutoFollowOnEnd: true, liveMaxDuration: 7000 }, 7500)).toBe(7000)
  })
  it('alteração de duração é dinâmica; zero significa sem limite conhecido', () => {
    const item = { liveAutoFollowOnEnd: true, durationOverride: 500 } as RundownItem
    expect(liveDurationLimit(item, 500)).toBe(500)
    expect(liveDurationLimit({ ...item, durationOverride: 2000 }, 500)).toBe(2000)
    expect(liveDurationLimit({ ...item, durationOverride: 0 }, 0)).toBeNull()
  })
})

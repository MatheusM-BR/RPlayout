import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {accumulateRgbaJs} from './cpu-js.js'
import {CHANNEL_BIT, DEFAULT_SCOPE_CONFIG, ScopesWasm, type ScopeConfig} from './wasm.js'

/** Quadro RGBA determinístico com tudo: rampas, primários, cinzas e ruído. */
function frame(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  let seed = 12345
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    seed = (seed * 1103515245 + 12345) >>> 0
    const band = Math.floor(y * 4 / height)
    const v = Math.floor(x * 255 / (width - 1))
    const rgb = band === 0 ? [v, v, v] : band === 1 ? [v, 255 - v, (v * 3) & 255] : band === 2 ? [(seed >>> 8) & 255, (seed >>> 16) & 255, (seed >>> 24) & 255] : [x % 2 ? 255 : 0, y % 3 ? 191 : 16, v]
    out.set([...rgb, 255], i)
  }
  return out
}

describe('fallback JS (último recurso)', () => {
  it('bate exatamente com o WASM no caminho RGBA', async () => {
    const wasm = await ScopesWasm.load(readFileSync(join(__dirname, 'rplayout_scopes.wasm')))
    const width = 320, height = 180, rgba = frame(width, height)
    const configs: ScopeConfig[] = [DEFAULT_SCOPE_CONFIG, {...DEFAULT_SCOPE_CONFIG, waveColumns: 200, waveRows: 97, levelMin: 40, levelMax: 104, vectorScale: 0.5, roi: [0.1, 0.25, 0.8, 0.9], channels: CHANNEL_BIT.Y | CHANNEL_BIT.Cr | CHANNEL_BIT.G}]
    for (const config of configs) {
      const expected = wasm.runRgba(rgba, width, height, config)
      const actual = accumulateRgbaJs(rgba, width, height, config)
      expect(Array.from(actual.wave)).toEqual(Array.from(expected.wave))
      expect(Array.from(actual.hist)).toEqual(Array.from(expected.hist))
      expect(Array.from(actual.vector)).toEqual(Array.from(expected.vector))
      expect(Array.from(actual.diamond)).toEqual(Array.from(expected.diamond))
      const {lumaAvg: avgA, ...a} = actual.stats, {lumaAvg: avgB, ...b} = expected.stats
      expect(a).toEqual(b)
      expect(avgA).toBeCloseTo(avgB, 6)
    }
  })
})

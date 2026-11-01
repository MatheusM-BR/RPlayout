import {createHash} from 'node:crypto'
import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {CHANNEL_BIT, DEFAULT_SCOPE_CONFIG, ScopesWasm, checkYccHeader, type ScopeConfig, type ScopeResult} from './wasm.js'

/**
 * Paridade Rust nativo × WASM.
 *
 * `apps/engine/scopes/fixtures/golden.txt` é escrito e cobrado pelo `cargo
 * test` do crate (nativo). Aqui o MESMO .wasm que a interface carrega roda os
 * mesmos quadros e configurações e tem de produzir as mesmas linhas, bit a
 * bit: hashes FNV-1a dos buffers de densidade e as estatísticas em f64.
 */

const root = join(__dirname, '../../../..')
const crate = join(root, 'apps/engine/scopes')

function rleDecode(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  expect(String.fromCharCode(...data.subarray(0, 4))).toBe('RLE1')
  const out = new Uint8Array(view.getUint32(4, true))
  let i = 8, o = 0
  while (i < data.length) {
    const value = data[i++]!
    let count = 0, shift = 0, byte
    do { byte = data[i++]!; count |= (byte & 0x7f) << shift; shift += 7 } while (byte & 0x80)
    out.fill(value, o, o + count); o += count
  }
  expect(o).toBe(out.length)
  return out
}

function fnv1a(values: Uint32Array): string {
  let hash = 0xcbf29ce484222325n
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
  for (const byte of bytes) { hash ^= BigInt(byte); hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn }
  return hash.toString(16).padStart(16, '0')
}

/** `format!("{v}")` de f64 do Rust == `String(v)` do JS para os valores usados (sem expoente). */
function rustF64(v: number): string {
  const text = String(v)
  if (/e/i.test(text)) throw new Error(`valor com expoente na paridade: ${text}`)
  return text
}

function goldenLine(name: string, r: ScopeResult): string {
  const s = r.stats
  const stats = [s.count, s.lumaMin, s.lumaMax, s.lumaAvg, s.belowBlack, s.aboveWhite, s.lumaR103, s.rgbMin, s.rgbMax, s.gamutR103, s.gamutStrict, s.chromaMax, s.chromaIllegal, s.lumaIllegal ? 1 : 0, s.gamutIllegal ? 1 : 0, s.chromaIllegalAny ? 1 : 0].map(rustF64).join(',')
  return `${name} wave=${fnv1a(r.wave)} vector=${fnv1a(r.vector)} hist=${fnv1a(r.hist)} diamond=${fnv1a(r.diamond)} stats=${stats}`
}

/** Mesma lista de `golden_configs()` em src/tests.rs. */
const CONFIGS: Array<[string, ScopeConfig]> = [
  ['padrao', DEFAULT_SCOPE_CONFIG],
  ['zoom-roi', {waveColumns: 333, waveRows: 129, levelMin: 60, levelMax: 104, vectorSize: 181, vectorScale: 0.65, histBins: 100, diamondSize: 77, roi: [0.1, 0.2, 0.7, 0.9], channels: CHANNEL_BIT.Y | CHANNEL_BIT.R | CHANNEL_BIT.B}],
]
const FIXTURES = ['smpte-hd-75', 'ebu-75', 'ebu-100', 'ebu-75-bt2020']

let wasm: ScopesWasm
beforeAll(async () => { wasm = await ScopesWasm.load(readFileSync(join(__dirname, 'rplayout_scopes.wasm'))) })

describe('scopes WASM', () => {
  it('o .wasm versionado corresponde às fontes do crate', () => {
    const hash = createHash('sha256')
    const files = ['Cargo.toml', ...readdirSync(join(crate, 'src')).filter(f => f.endsWith('.rs') && f !== 'tests.rs').sort().map(f => `src/${f}`)]
    for (const file of files) { hash.update(file + '\0'); hash.update(readFileSync(join(crate, file), 'utf8').replace(/\r\n/g, '\n')) }
    const manifest = JSON.parse(readFileSync(join(__dirname, 'rplayout_scopes.wasm.json'), 'utf8')) as {sourceHash: string; wasmSha256: string}
    expect(manifest.sourceHash, 'rode: node scripts/build-scopes-wasm.mjs').toBe(hash.digest('hex'))
    expect(createHash('sha256').update(readFileSync(join(__dirname, 'rplayout_scopes.wasm'))).digest('hex')).toBe(manifest.wasmSha256)
  })

  it('produz exatamente o golden do Rust nativo (paridade bit a bit)', () => {
    const golden = readFileSync(join(crate, 'fixtures/golden.txt'), 'utf8').replace(/\r\n/g, '\n').trim().split('\n')
    const lines: string[] = []
    for (const name of FIXTURES) {
      const ycc = rleDecode(readFileSync(join(crate, `fixtures/${name}.ycc.rle`)))
      for (const [label, config] of CONFIGS) lines.push(goldenLine(`${name}/${label}`, wasm.runYcc(ycc, config)))
      const colors = wasm.falseColorYcc(ycc, 'exposure')
      lines.push(`${name}/falsa-cor fnv=${fnv1a(new Uint32Array(colors.rgba.buffer, colors.rgba.byteOffset, colors.rgba.byteLength / 4))}`)
    }
    expect(lines).toEqual(golden)
  })

  it('caminho RGBA (indicativo) leva barras 75% aos alvos', () => {
    const colors = [[191, 191, 0], [0, 191, 191], [0, 191, 0], [191, 0, 191], [191, 0, 0], [0, 0, 191]]
    const rgba = new Uint8Array(colors.flatMap(c => [...c, 255]))
    const r = wasm.runRgba(rgba, 6, 1)
    expect(r.stats.count).toBe(6)
    expect(r.vector.reduce((a, b) => a + b, 0)).toBe(6)
    expect(r.stats.gamutR103).toBe(0)
  })

  it('recusa .ycc inválido com mensagem', () => {
    expect(() => wasm.runYcc(new Uint8Array(20))).toThrow(/inválida/)
    expect(() => checkYccHeader(new ArrayBuffer(20))).toThrow(/inválida/)
    const ycc = rleDecode(readFileSync(join(crate, 'fixtures/ebu-75-bt2020.ycc.rle')))
    expect(checkYccHeader(ycc.buffer.slice(ycc.byteOffset, ycc.byteOffset + ycc.byteLength) as ArrayBuffer)).toEqual({width: 1920, height: 1080, matrix: 9, range: 0})
    expect(() => checkYccHeader(ycc.buffer.slice(0, 1000) as ArrayBuffer)).toThrow(/truncada/)
  })
})

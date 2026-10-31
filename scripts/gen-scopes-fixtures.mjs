#!/usr/bin/env node
// Gera os quadros de referência dos scopes (apps/engine/scopes/fixtures).
//
// As barras saem do ffmpeg, que é uma implementação independente da nossa:
//  - smpte-hd-75: `smptehdbars` (SMPTE RP 219, nativo BT.709) → yuv444p.
//  - ebu-75 / ebu-100: barras EBU 100/0/75/0 e 100/0/100/0 desenhadas em
//    R'G'B' e convertidas pelo swscale para Y'CbCr BT.709 faixa limitada.
//  - ebu-75-bt2020: as mesmas barras pela matriz BT.2020 NCL.
// Cada quadro é 1920×1080 4:4:4 no formato `.ycc` da sonda, comprimido por
// carreira (RLE) para caber no repositório: `RLE1`, u32 LE com o tamanho cru,
// e pares (byte, contagem LEB128).
//
// Uso: node scripts/gen-scopes-fixtures.mjs   (precisa de ffmpeg no PATH)
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'apps/engine/scopes/fixtures')
const W = 1920, H = 1080
const work = mkdtempSync(join(tmpdir(), 'scopes-fixtures-'))

function header(width, height, matrix, range) {
  const h = Buffer.alloc(16)
  h.write('RPYC', 0, 'latin1'); h[4] = 1; h[5] = matrix; h[6] = range; h[7] = 8
  h.writeUInt16LE(width, 8); h.writeUInt16LE(height, 10)
  return h
}

export function rleEncode(raw) {
  const parts = [Buffer.from('RLE1', 'latin1')]
  const size = Buffer.alloc(4); size.writeUInt32LE(raw.length); parts.push(size)
  const bytes = []
  for (let i = 0; i < raw.length;) {
    const value = raw[i]; let run = 1
    while (i + run < raw.length && raw[i + run] === value) run++
    bytes.push(value)
    let n = run
    do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; bytes.push(b) } while (n)
    i += run
  }
  parts.push(Buffer.from(bytes))
  return Buffer.concat(parts)
}

function ffmpegYuv444(args, matrix) {
  const file = join(work, 'frame.yuv')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, '-frames:v', '1', '-pix_fmt', 'yuv444p', '-f', 'rawvideo', file])
  const planes = readFileSync(file)
  if (planes.length !== W * H * 3) throw new Error(`ffmpeg devolveu ${planes.length} bytes`)
  return Buffer.concat([header(W, H, matrix, 0), planes])
}

/** Barras EBU: branco, amarelo, ciano, verde, magenta, vermelho, azul, preto. */
function ebuPpm(level) {
  const bars = [[1, 1, 1], [level, level, 0], [0, level, level], [0, level, 0], [level, 0, level], [level, 0, 0], [0, 0, level], [0, 0, 0]]
  const head = Buffer.from(`P6\n${W} ${H}\n255\n`, 'latin1')
  const body = Buffer.alloc(W * H * 3)
  for (let x = 0; x < W; x++) {
    const [r, g, b] = bars[Math.floor(x * 8 / W)].map(v => Math.round(v * 255))
    for (let y = 0; y < H; y++) { const i = (y * W + x) * 3; body[i] = r; body[i + 1] = g; body[i + 2] = b }
  }
  const file = join(work, `ebu-${level}.ppm`)
  writeFileSync(file, Buffer.concat([head, body]))
  return file
}

const fixtures = {
  'smpte-hd-75': ffmpegYuv444(['-f', 'lavfi', '-i', `smptehdbars=size=${W}x${H}:rate=25`], 1),
  'ebu-75': ffmpegYuv444(['-i', ebuPpm(0.75), '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=neighbor+accurate_rnd+full_chroma_int'], 1),
  'ebu-100': ffmpegYuv444(['-i', ebuPpm(1), '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=neighbor+accurate_rnd+full_chroma_int'], 1),
  'ebu-75-bt2020': ffmpegYuv444(['-i', ebuPpm(0.75), '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt2020:flags=neighbor+accurate_rnd+full_chroma_int'], 9),
}
for (const [name, raw] of Object.entries(fixtures)) {
  const encoded = rleEncode(raw)
  writeFileSync(join(out, `${name}.ycc.rle`), encoded)
  console.log(`${name}: ${raw.length} → ${encoded.length} bytes`)
}
rmSync(work, {recursive: true, force: true})

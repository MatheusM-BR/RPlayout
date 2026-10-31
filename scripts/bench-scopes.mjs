#!/usr/bin/env node
// Bancada dos scopes: paridade GPU × WASM, erro do caminho INDICATIVO com
// barras conhecidas e ms por quadro em 1080p (WebGPU, WebGL2, WASM, JS).
//
// Uso (no Windows de produção, com GPU de verdade):
//   node scripts/bench-scopes.mjs --channel msedge          (ou chrome)
// No container de CI sem GPU (SwiftShader, só valida lógica; tempos não valem):
//   node scripts/bench-scopes.mjs --swiftshader
// Opções: --codec vp9|h264 (padrão: h264 se o navegador tocar, senão vp9),
//         --iterations N, --out arquivo.json
//
// Precisa de ffmpeg no PATH e de `playwright` (require.resolve).
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {join, dirname, extname} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const channel = option('--channel')
const swiftshader = args.includes('--swiftshader')
const iterations = Number(option('--iterations', '30'))
// SwiftShader emula a GPU na CPU: 1080p lá leva minutos por quadro. Valida-se
// a lógica numa resolução menor; os tempos de 1080p são da máquina com GPU.
const [W, H] = option('--size', swiftshader ? '640x360' : '1920x1080').split('x').map(Number)
const work = mkdtempSync(join(tmpdir(), 'scopes-bench-'))
const require = createRequire(import.meta.url)
let playwright
for (const candidate of ['playwright', '/opt/node-tools/node_modules/playwright', '/opt/npm-tools/node_modules/playwright']) {
  try { playwright = require(candidate); break } catch { /* próximo */ }
}
if (!playwright) { console.error('playwright não encontrado'); process.exit(2) }

// 1. Harness empacotado.
const esbuild = await import('esbuild')
await esbuild.build({entryPoints: [join(root, 'apps/web/src/scopes/bench/harness.ts')], bundle: true, format: 'esm', outfile: join(work, 'harness.js'), target: 'es2022', logLevel: 'error'})
writeFileSync(join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><body style="background:#000"><script type="module" src="/harness.js"></script></body>')
writeFileSync(join(work, 'rplayout_scopes.wasm'), readFileSync(join(root, 'apps/web/src/scopes/rplayout_scopes.wasm')))

// 2. Mídia: barras EBU 75%/100% (8 barras) e SMPTE HD, codificadas como o PGM.
function ebuPpm(level, file) {
  const bars = [[1, 1, 1], [level, level, 0], [0, level, level], [0, level, 0], [level, 0, level], [level, 0, 0], [0, 0, level], [0, 0, 0]]
  const body = Buffer.alloc(W * H * 3)
  for (let x = 0; x < W; x++) { const [r, g, b] = bars[Math.floor(x * 8 / W)].map(v => Math.round(v * 255)); for (let y = 0; y < H; y++) body.set([r, g, b], (y * W + x) * 3) }
  writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), body]))
}
const tag = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv']
function encode(input, name, codec) {
  const out = join(work, `${name}.${codec === 'h264' ? 'mp4' : 'webm'}`)
  const enc = codec === 'h264' ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-tune', 'zerolatency'] : ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '20', '-deadline', 'realtime', '-cpu-used', '8']
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-t', '2', '-r', '25', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', ...enc, ...tag, out])
  // Quadro exato do mesmo arquivo codificado (Y'CbCr 4:4:4 BT.709 limitado).
  const raw = join(work, `${name}.yuv`)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.5', '-i', out, '-frames:v', '1', '-vf', 'scale=flags=neighbor,format=yuv444p', '-f', 'rawvideo', raw])
  const header = Buffer.alloc(16); header.write('RPYC', 0, 'latin1'); header[4] = 1; header[5] = 1; header[6] = 0; header[7] = 8; header.writeUInt16LE(W, 8); header.writeUInt16LE(H, 10)
  writeFileSync(join(work, `${name}.ycc`), Buffer.concat([header, readFileSync(raw)]))
  return `/${name}.${codec === 'h264' ? 'mp4' : 'webm'}`
}

const mime = {'.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.webm': 'video/webm', '.mp4': 'video/mp4', '.ycc': 'application/octet-stream'}
const server = createServer((request, response) => {
  try {
    const file = join(work, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html')
    const data = readFileSync(file)
    response.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream')
    response.end(data)
  } catch { response.statusCode = 404; response.end() }
}).listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const port = server.address().port

const launchArgs = swiftshader
  ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
  : ['--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist']
const browser = await playwright.chromium.launch({channel, headless: swiftshader, args: launchArgs})
const page = await browser.newPage({viewport: {width: 1280, height: 800}})
page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.error('[página]', message.text()) })
page.setDefaultTimeout(0)
await page.goto(`http://127.0.0.1:${port}/`)
await page.waitForFunction(() => 'scopesBench' in window)
const h264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'))
const codec = option('--codec', h264 ? 'h264' : 'vp9')
ebuPpm(0.75, join(work, 'ebu75.ppm')); ebuPpm(1, join(work, 'ebu100.ppm'))
const quick = args.includes('--quick')
const allMedia = [
  {name: 'ebu-75', video: encode(['-loop', '1', '-i', join(work, 'ebu75.ppm')], 'ebu-75', codec), ycc: '/ebu-75.ycc', bars: 8},
  {name: 'ebu-100', video: encode(['-loop', '1', '-i', join(work, 'ebu100.ppm')], 'ebu-100', codec), ycc: '/ebu-100.ycc', bars: 8},
  {name: 'natural-perf', video: encode(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=25`], 'natural-perf', codec)},
]
const media = quick ? allMedia.filter(m => m.name !== 'ebu-100') : allMedia
const results = await page.evaluate(([items, n]) => window.scopesBench.run(items, n), [media, iterations])
results.codec = codec
results.size = `${W}x${H}`
results.mode = swiftshader ? 'swiftshader (sem GPU; tempos só relativos)' : `navegador ${channel ?? 'chromium'} com GPU`
const text = JSON.stringify(results, null, 2)
console.log(text)
const outFile = option('--out')
if (outFile) writeFileSync(outFile, text)
await browser.close()
server.close()
rmSync(work, {recursive: true, force: true})

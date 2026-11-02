import assert from 'node:assert/strict'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// Only temporary synthetic recordings. No board, network destination or
// operational database; each process below is owned by this verifier.
const workspace = fileURLToPath(new URL('..', import.meta.url))
const packageIndex = process.argv.indexOf('--package')
const root = packageIndex >= 0 ? resolve(process.argv[packageIndex + 1]!) : workspace
const directory = await mkdtemp(join(tmpdir(), 'RPlayout-recording-safety-'))
const gstRoot = packageIndex >= 0 ? join(root, 'runtime/gstreamer') : process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ?? 'C:/Program Files/gstreamer/1.0/msvc_x86_64'
const env = { ...process.env, GST_PLUGIN_PATH: join(gstRoot, 'lib/gstreamer-1.0'), GST_PLUGIN_SYSTEM_PATH: join(gstRoot, 'lib/gstreamer-1.0'),
  GST_PLUGIN_SCANNER: join(gstRoot, 'libexec/gstreamer-1.0/gst-plugin-scanner.exe'), GST_REGISTRY: join(directory, 'registry.bin'),
  PATH: packageIndex >= 0 ? [join(gstRoot, 'bin'), join(process.env.SystemRoot!, 'System32'), process.env.SystemRoot!].join(';') : join(gstRoot, 'bin') + ';' + process.env.PATH }
const engine = join(root, 'apps/engine/target/release/rplayout-engine.exe')
const owned = new Set<ChildProcess>(), run = promisify(execFile)
const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
async function exercise(target: string, expectFailure: boolean) {
  const child = spawn(engine, ['--channel-id', 'recording-proof', '--width', '320', '--height', '180', '--fps-num', '25', '--fps-den', '1', '--bitrate', '500', '--output', 'null', '--output', JSON.stringify({ id: 'recording-proof', kind: 'file', target, bitrateKbps: 500 })],
    { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  owned.add(child)
  let buffered = '', diagnostic = '', error: Error | null = null, exited = false, exitCode: number | null = null
  const events: Array<Record<string, any>> = []
  child.on('error', failure => { error = failure })
  child.on('exit', code => { exited = true; exitCode = code })
  child.stderr.on('data', data => { diagnostic = (diagnostic + data.toString()).slice(-4000) })
  child.stdout.on('data', data => {
    buffered += data.toString()
    const lines = buffered.split('\n'); buffered = lines.pop() ?? ''
    for (const line of lines) { try { events.push(JSON.parse(line)) } catch {} }
  })
  async function wait(label: string, check: () => boolean, timeout = 20_000) {
    const deadline = performance.now() + timeout
    while (!check()) {
      if (error) throw error
      if (exited || performance.now() > deadline) throw new Error(`${label}; exit=${exitCode}; ${diagnostic}; ${JSON.stringify(events.slice(-8))}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  try {
    await wait('Publisher não confirmou o resultado', () => events.some(event => event.event === 'publisher' && event.outputId === 'recording-proof' &&
      (expectFailure ? /arquivo anterior foi preservado/.test(event.error ?? '') : event.delivered >= 1)))
    await wait('Falha da gravação interrompeu o compositor PGM', () => events.some(event => event.event === 'output' && event.frames >= 25))
    if (!expectFailure) await wait('Gravação não progrediu', () => events.some(event => event.event === 'output' && event.frames >= 75))
    const report = events.find(event => event.event === 'publisher' && event.outputId === 'recording-proof' && (expectFailure ? event.error : event.delivered >= 1))
    assert.equal(report?.health, expectFailure ? 'failed' : 'onAir')
    child.stdin.end()
    const deadline = performance.now() + 12_000
    while (!exited && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok(exited, 'Engine não finalizou o muxer após EOF'); assert.equal(exitCode, 0)
    return report
  } finally { if (!exited) child.kill(); owned.delete(child) }
}
try {
  const existing = join(directory, 'EXISTENTE — gravação.mkv'), recording = join(directory, 'NOVA — ação.mkv')
  await writeFile(existing, 'Original test recording must never be truncated')
  const originalHash = await digest(existing)
  const blocked = await exercise(existing, true)
  assert.equal(await digest(existing), originalHash)
  const created = await exercise(recording, false)
  assert.ok((await stat(recording)).size > 128)
  const completedHash = await digest(recording)
  const probeResult = await run(join(root, 'apps/engine/target/release/rplayout-probe.exe'), [recording, '--no-loudness'], { cwd: root, env, timeout: 20_000, windowsHide: true })
  const probe = JSON.parse(probeResult.stdout.trim())
  assert.equal(probe.ok, true); assert.equal(probe.video?.width, 320); assert.equal(probe.video?.height, 180)
  const restarted = await exercise(recording, true)
  assert.equal(await digest(recording), completedHash)
  console.log(JSON.stringify({ result: 'PASS', evidence: 'NATIVE_RECORDING_NO_OVERWRITE_AND_RESTART', root, directory, existingPreserved: true, newRecordingDecoded: true,
    restartPreserved: true, compositorContinued: true, originalHash, completedHash, blocked, created, restarted, physicalOutputValidated: false }))
} finally { for (const child of owned) child.kill() }

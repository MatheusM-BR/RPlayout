import assert from 'node:assert/strict'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer, type Socket } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mediaProcessEnvironment } from '../apps/server/src/domain/media-process-environment.js'
import { sanitizeDiagnostic } from '../apps/server/src/domain/sanitize-diagnostic.js'

// Own native processes and loopback endpoints only; no transmitter/hardware.
const workspace = fileURLToPath(new URL('..', import.meta.url))
const packageArgument = process.argv.indexOf('--package')
const root = packageArgument < 0 ? workspace : resolve(process.argv[packageArgument + 1]!)
const directory = await mkdtemp(join(tmpdir(), 'RPlayout-private-startup-'))
const gstRoot = packageArgument < 0 ? process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ?? 'C:/Program Files/gstreamer/1.0/msvc_x86_64' : join(root, 'runtime/gstreamer')
const sockets = new Set<Socket>()
const fixture = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
await new Promise<void>(resolvePromise => fixture.listen(0, '127.0.0.1', resolvePromise))
const port = (fixture.address() as { port: number }).port
const marker = 'QA_PRIVATE_PROCESS_ONLY', target = `srt://127.0.0.1:${port}?mode=caller&latency=120&passphrase=${marker}`
const env = { ...mediaProcessEnvironment({ ...process.env, RPLAYOUT_VAULT_KEY: marker, RPLAYOUT_CONTROL_TOKEN: marker, RPLAYOUT_ENGINE_OUTPUT: target }),
  PATH: [join(gstRoot, 'bin'), process.env.PATH ?? ''].join(';'), GST_PLUGIN_PATH: join(gstRoot, 'lib/gstreamer-1.0'), GST_PLUGIN_SYSTEM_PATH: join(gstRoot, 'lib/gstreamer-1.0'), GST_PLUGIN_SCANNER: join(gstRoot, 'libexec/gstreamer-1.0/gst-plugin-scanner.exe'), GST_REGISTRY: join(directory, 'gst-registry.bin') }
const owned: ChildProcess[] = []
function launch(binary: string, args: string[], config: object) {
  const child = spawn(join(root, 'apps/engine/target/release', binary), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env })
  owned.push(child)
  const events: any[] = []
  let pending = '', diagnostics = '', startupError = false
  child.on('error', () => { startupError = true })
  child.stdin?.on('error', () => {})
  child.stdout?.on('data', chunk => {
    pending += chunk.toString()
    for (;;) {
      const newline = pending.indexOf('\n'); if (newline < 0) break
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
      try { events.push(JSON.parse(line)); if (events.length > 2000) events.shift() } catch { startupError = true }
    }
    if (pending.length > 131_072) { pending = ''; startupError = true }
  })
  child.stderr?.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-8192) })
  child.stdin?.write(JSON.stringify(config) + '\n')
  return { child, events, failed: () => startupError, diagnostics: () => diagnostics }
}
async function wait(description: string, condition: () => boolean) {
  const end = performance.now() + 15_000
  while (performance.now() < end) { if (condition()) return; await new Promise(resolvePromise => setTimeout(resolvePromise, 100)) }
  throw new Error(description + '; confira os processos isolados em ' + directory)
}
try {
  // Populate our own registry once before concurrent engine/relay startup;
  // first-time plugin discovery is not the private-bootstrap handshake.
  await promisify(execFile)(join(gstRoot, 'bin/gst-inspect-1.0.exe'), ['--exists', 'fakesink'], { env, windowsHide: true, timeout: 60_000, maxBuffer: 16_384 })
  const engine = launch('rplayout-engine.exe', ['--channel-id', 'private-proof', '--width', '320', '--height', '180', '--fps-num', '25', '--fps-den', '1', '--bitrate', '300', '--private-outputs-stdin'], { outputs: ['null', target], preview: null })
  const relay = launch('rplayout-relay.exe', ['--private-connection-stdin'], { from: `rtsp://127.0.0.1:${port}/qa/pgm`, to: target })
  try { await wait('Engine não confirmou startup privado', () => engine.events.some(event => event.event === 'ready')) }
  catch { throw new Error('Startup privado recusado: ' + sanitizeDiagnostic(engine.diagnostics()) + '; código=' + engine.child.exitCode + '; evidência=' + directory) }
  await wait('Publisher não recebeu URI privada literal', () => engine.events.some(event => event.event === 'publisher' && event.url === target))
  await wait('Relay não recebeu URI privada literal', () => relay.events.some(event => event.event === 'connecting' && event.to === target))
  assert.equal(engine.failed(), false); assert.equal(relay.failed(), false)
  assert.ok(engine.child.pid && relay.child.pid)
  const pids = [engine.child.pid, relay.child.pid] as number[]
  const query = `Add-Type -AssemblyName System.Management; $searcher=New-Object System.Management.ManagementObjectSearcher('SELECT ProcessId, CommandLine FROM Win32_Process WHERE ProcessId=${pids[0]} OR ProcessId=${pids[1]}'); @($searcher.Get() | ForEach-Object { @{id=[int]$_.ProcessId; commandLine=[string]$_.CommandLine} }) | ConvertTo-Json -Compress`
  const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true, timeout: 10_000, encoding: 'utf8' })
  const processes = JSON.parse(result.stdout)
  assert.equal(processes.length, 2)
  assert.equal(result.stdout.includes(marker), false)
  assert.equal(result.stdout.includes('srt://'), false)
  assert.equal(result.stdout.includes('rtsp://'), false)
  assert.ok(processes.some((process: any) => process.commandLine.includes('--private-outputs-stdin')))
  assert.ok(processes.some((process: any) => process.commandLine.includes('--private-connection-stdin')))
  // A command directly following bootstrap must still reach the engine.
  engine.child.stdin?.write(JSON.stringify({ id: 730, cmd: 'stop' }) + '\n')
  await wait('Comando após bootstrap não foi confirmado', () => engine.events.some(event => event.event === 'ack' && event.id === 730 && event.ok))
  console.log(JSON.stringify({ result: 'PASS', evidence: 'NATIVE_PRIVATE_BOOTSTRAP_AND_OS_COMMAND_LINES', root, directory, processes: pids, exactEngineTargetReceived: true, exactRelayTargetReceived: true, commandLinesContainNoUrlsOrCredentials: true, subsequentCommandAcknowledged: true, physicalOutputValidated: false }))
} finally {
  for (const child of owned) child.kill()
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolvePromise => fixture.close(() => resolvePromise()))
}

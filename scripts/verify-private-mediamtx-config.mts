import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writePrivateConfig } from '../apps/server/src/domain/private-config-file.js'
import { mediaProcessEnvironment } from '../apps/server/src/domain/media-process-environment.js'

// Isolated MediaMTX API only: all signal listeners explicitly disabled.
const workspace = fileURLToPath(new URL('..', import.meta.url))
const packageArgument = process.argv.indexOf('--package')
const root = packageArgument < 0 ? workspace : resolve(process.argv[packageArgument + 1]!)
const directory = await mkdtemp(join(tmpdir(), 'RPlayout-private-mediamtx-'))
const configPath = join(directory, 'CONFIGURAÇÃO — ingest.yml')
const reservation = createServer(); await new Promise<void>(resolvePromise => reservation.listen(0, '127.0.0.1', resolvePromise))
const port = (reservation.address() as { port: number }).port
await new Promise<void>(resolvePromise => reservation.close(() => resolvePromise()))
const base = `http://127.0.0.1:${port}`, marker = 'QA_PRIVATE_INGEST_ONLY'
const config = (key: boolean) => ['logLevel: warn', 'api: yes', `apiAddress: 127.0.0.1:${port}`, 'rtsp: no', 'rtmp: no', 'srt: no', 'hls: no', 'webrtc: no', 'paths:', '  qa/program:', ...(key ? [`  guest/${marker}:`] : []), ''].join('\n')
let child: ChildProcess | null = null
let diagnostics = ''
async function paths(): Promise<string[] | null> {
  try {
    const response = await fetch(base + '/v3/config/paths/list', { signal: AbortSignal.timeout(1000) })
    if (!response.ok) return null
    return (await response.json() as { items: Array<{ name: string }> }).items.map(item => item.name)
  } catch { return null }
}
async function wait(description: string, condition: () => Promise<boolean>) {
  const end = performance.now() + 15_000
  while (performance.now() < end) { if (await condition()) return; await new Promise(resolvePromise => setTimeout(resolvePromise, 100)) }
  throw new Error(description + '; verifique a evidência isolada em ' + directory)
}
try {
  await writePrivateConfig(configPath, config(false))
  const environment = Object.fromEntries(Object.entries(mediaProcessEnvironment()).filter(([key]) => !key.toUpperCase().startsWith('MTX_')))
  child = spawn(join(root, 'mediamtx/mediamtx.exe'), [configPath], { cwd: directory, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-16_384) })
  await wait('MediaMTX não abriu API isolada', async () => (await paths())?.includes('qa/program') === true)
  const initialPid = child.pid
  await writePrivateConfig(configPath, config(true))
  await wait('Substituição atômica não ativou a chave', async () => (await paths())?.includes('guest/' + marker) === true)
  // Match the production queue's >1s interval to respect the native watcher.
  await new Promise(resolvePromise => setTimeout(resolvePromise, 1100))
  await writePrivateConfig(configPath, config(false))
  await wait('Revogação atômica não foi aplicada', async () => {
    const list = await paths(); return list !== null && list.includes('qa/program') && !list.includes('guest/' + marker)
  })
  assert.equal(child.pid, initialPid); assert.equal(child.exitCode, null)
  assert.equal((await readFile(configPath, 'utf8')).includes(marker), false)
  console.log(JSON.stringify({ result: 'PASS', evidence: 'PRIVATE_CONFIG_ATOMIC_RELOAD_AND_INGEST_REVOCATION', root, directory, process: initialPid, isolatedApiPort: port, addedKeyObservedInNativeConfig: true, revocationObservedInNativeConfig: true, processNotRestarted: true, allSignalListenersDisabled: true, physicalOutputValidated: false }))
} finally { child?.kill() }

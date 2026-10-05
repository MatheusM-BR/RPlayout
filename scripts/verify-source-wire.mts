import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

// Own isolated DB/server only. This proves the compiled HTTP/WebSocket
// credential boundary and reference recovery, NOT video reception/hardware.
const workspace = fileURLToPath(new URL('..', import.meta.url))
const packageArgument = process.argv.indexOf('--package')
const root = packageArgument < 0 ? workspace : resolve(process.argv[packageArgument + 1]!)
const directory = await mkdtemp(join(tmpdir(), 'RPlayout-source-wire-'))
const media = join(directory, 'media'); await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE = join(directory, 'vault.json')
const { openDatabase } = await import('../apps/server/src/db/client.js')
const { getLiveSource } = await import('../apps/server/src/domain/srt.js')
const { rundownItems } = await import('../apps/server/src/db/schema.js')
const database = openDatabase(join(directory, 'wire.db'))
const privateMarker = 'QA_PRIVATE_SOURCE_VALUE', raw = 'srt://127.0.0.1:9000?mode=caller&latency=120&passphrase=' + privateMarker
const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()))
const base = `http://127.0.0.1:${port}`
let child: ChildProcess | null = null, socket: WebSocket | null = null, errors = ''
const messages: any[] = []
async function wait(description: string, check: () => boolean | Promise<boolean>, timeout = 20_000) {
  const end = performance.now() + timeout
  while (performance.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(description)
}
async function api(path: string, body?: object, method = body ? 'POST' : 'GET', expected = 200) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) })
  const text = await response.text(); assert.ok(!text.includes(privateMarker), 'Credencial vazou na resposta HTTP')
  assert.equal(response.status, expected, `${method} ${path}: ${response.status}`)
  return JSON.parse(text) as any
}
function start() {
  errors = ''
  child = spawn(packageArgument < 0 ? process.execPath : join(root, 'runtime/node/node.exe'), [join(root, 'apps/server/dist/server.cjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    RPLAYOUT_DB: join(directory, 'wire.db'), RPLAYOUT_INSTALL_ROOT: root, RPLAYOUT_MEDIA: media, RPLAYOUT_THUMBS: join(directory, 'thumbs'), RPLAYOUT_MEDIA_VERSIONS: join(directory, 'versions'), RPLAYOUT_CACHE: join(directory, 'cache'), RPLAYOUT_BACKUPS: join(directory, 'backups'),
    RPLAYOUT_ENGINE: '', RPLAYOUT_MEDIAMTX: '', RPLAYOUT_DEVICES: '', RPLAYOUT_RELAY: '', RPLAYOUT_PROBE: '', RPLAYOUT_PROXY: '', RPLAYOUT_N1_PEER: '', RPLAYOUT_BACKUP_HOURS: '0', RPLAYOUT_ADMIN_USER: '', RPLAYOUT_ADMIN_PASSWORD: '', RPLAYOUT_ROLE: 'ADMIN', RPLAYOUT_CONTROL_TOKEN: '', HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'warn' } })
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { errors = (errors + String(chunk)).slice(-16_000) })
  child.on('error', error => { errors += error.message })
}
async function connect() {
  messages.length = 0
  socket = new WebSocket(base.replace('http:', 'ws:') + '/ws')
  socket.addEventListener('error', () => {})
  socket.addEventListener('message', event => {
    const text = String(event.data)
    messages.push({ value: JSON.parse(text), leak: text.includes(privateMarker) })
  })
  await wait('Snapshot WebSocket não chegou', () => messages.some(entry => entry.value.type === 'view') && messages.some(entry => entry.value.type === 'live'))
}
async function stop() {
  socket?.close(); socket = null
  const own = child; child = null
  if (!own) return
  if (own.exitCode !== null || own.signalCode !== null) return
  const exited = new Promise<void>(resolve => own.once('exit', () => resolve()))
  own.kill('SIGKILL'); await exited
}
try {
  const now = new Date().toISOString()
  database.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('wire', 'Fronteira isolada', 25, 1, 320, 180, -23, -1, 5, now)
  database.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('rd', 'wire', 'Teste', 0, now.slice(0, 10), now, now)
  await database.db.insert(rundownItems).values({ id: 'live', rundownId: 'rd', sortOrder: 0, title: 'Entrada protegida', type: 'LIVE', sourceRef: raw, liveEndpoint: raw, durationOverride: 1500, minDuration: 0, anchor: { kind: 'FLOW' }, onOverrun: 'PUSH', autoNext: false, loop: false, locked: false })
  start()
  await wait('Servidor compilado não iniciou', async () => { try { return (await api('/api/health')).ok === true } catch { return false } })
  const source = await api('/api/sources/live', { channelId: 'wire', kind: 'SRT', name: 'EXTERNA ÇÃO', targetUrl: raw }, 'POST', 201)
  assert.equal(source.credentialProtected, true); const reference = source.controlRef
  assert.match(reference, /^srt:protected:v1:/)
  await connect()
  const view = messages.find(entry => entry.value.type === 'view' && entry.value.channelId === 'wire').value.view
  assert.equal(view.items[0].item.sourceRef, reference)
  const cue = await api('/api/channels/wire/transport', { action: 'cue', sourceRef: reference, sourceTitle: 'EXTERNA ÇÃO' })
  assert.equal(cue.live.transport.preview.source, reference)
  await wait('Tick WebSocket não refletiu o CUE protegido', () => messages.some(entry => entry.value.type === 'live' && entry.value.transport?.preview?.source === reference))
  assert.ok(messages.every(entry => !entry.leak))
  await api(`/api/sources/live/${source.id}`, { name: 'APELIDO ÇÃO', targetUrl: reference }, 'PUT')
  assert.equal((await getLiveSource(database.db, source.id, true))?.targetUrl, raw)
  await api('/api/channels/wire/transport', { action: 'take' })
  await api('/api/channels/wire/transport', { action: 'stop' })
  await stop(); start()
  await wait('Servidor não reiniciou', async () => { try { return (await api('/api/health')).ok === true } catch { return false } })
  const cueAfterRestart = await api('/api/channels/wire/transport', { action: 'cue', sourceRef: reference })
  assert.equal(cueAfterRestart.live.transport.preview.kind, 'SOURCE')
  const restartedReference = cueAfterRestart.live.transport.preview.source
  assert.match(reference, /^srt:protected:v1:[A-Za-z0-9_-]{43}\./)
  assert.notEqual(restartedReference, reference, 'Envelope aleatório deve mudar no novo processo')
  assert.equal(restartedReference.split(':')[3].split('.')[0], reference.split(':')[3].split('.')[0], 'Identidade da fonte deve sobreviver ao reinício para correlacionar sinal no QC/PVW')
  // The new process may issue a fresh ciphertext; the previous authenticated
  // reference must still resolve to the exact original, never a REDACTED URI.
  await api('/api/channels/wire/transport', { action: 'take' })
  await api('/api/channels/wire/transport', { action: 'stop' })
  await api('/api/channels/wire/transport', { action: 'cue', sourceRef: 'srt:protected:v1:invalid' }, 'POST', 400)
  assert.ok(!errors.includes(privateMarker), 'Credencial vazou no diagnóstico compilado')
  console.log(JSON.stringify({ result: 'PASS', evidence: 'COMPILED_HTTP_WEBSOCKET_PROTECTED_SOURCE_REFERENCES', root, directory, httpRedacted: true, initialWebSocketRedacted: true, liveWebSocketRedacted: true, aliasPreservedPrivateUri: true, previousReferenceWorksAfterRestart: true, stableSignalIdentityAfterRestart: true, ciphertextRotated: true, malformedReferenceRejected: true, transport: 'SIMULATED', physicalOutputValidated: false }))
} finally { await stop(); database.sqlite.close() }

import assert from 'node:assert/strict'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Socket } from 'node:net'

// Own DB, native engine with null output, and loopback protocol peer only.
// Never contacts an operator's equipment or writes a physical crosspoint.
// Media generation warms the exact private registry later used by the engine;
// this is not a measurement/claim of cold-start time on an installed station.
const workspace = fileURLToPath(new URL('..', import.meta.url))
const argument = process.argv.indexOf('--package'), root = argument < 0 ? workspace : resolve(process.argv[argument + 1]!)
const directory = await mkdtemp(join(tmpdir(), 'RPlayout-device-automation-'))
const media = join(directory, 'media'); await mkdir(media)
process.env.RPLAYOUT_VAULT_FILE = join(directory, 'vault.json')
const gstRoot = argument < 0 ? process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ?? 'C:/Program Files/gstreamer/1.0/msvc_x86_64' : join(root, 'runtime/gstreamer')
const gstBin = join(gstRoot, 'bin'), file = join(media, 'AUTOMAÇÃO-ÇÃO.mp4')
await promisify(execFile)(join(gstBin, 'gst-launch-1.0.exe'), ['-q', 'videotestsrc', 'num-buffers=1500', '!', 'video/x-raw,width=320,height=180,framerate=25/1', '!', 'videoconvert', '!', 'x264enc', 'speed-preset=ultrafast', '!', 'h264parse', '!', 'mp4mux', '!', 'filesink', `location=${file.replaceAll('\\', '/')}`], { timeout: 60_000, windowsHide: true, env:{...process.env,GST_REGISTRY:join(directory,'gst-registry.bin'),GST_PLUGIN_SCANNER:join(gstRoot,'libexec/gstreamer-1.0/gst-plugin-scanner.exe'),GST_PLUGIN_PATH:join(gstRoot,'lib/gstreamer-1.0'),GST_PLUGIN_SYSTEM_PATH:join(gstRoot,'lib/gstreamer-1.0'),PATH:gstBin+';'+process.env.PATH} })
const { openDatabase } = await import('../apps/server/src/db/client.js')
const database = openDatabase(join(directory, 'automation.db'))
const sockets = new Set<Socket>(), blocks: string[] = []
let refuseAfterRoute = false
const peer = createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
  socket.setEncoding('utf8'); socket.write('PROTOCOL PREAMBLE:\nVersion: 2.3\n\nVIDEOHUB DEVICE:\nDevice present: true\nModel name: QA — LOCAL\nVideo inputs: 16\nVideo outputs: 16\n\nVIDEO OUTPUT ROUTING:\n4 9\n\n')
  let pending = ''
  socket.on('data', text => {
    pending += text; let end: number
    while ((end = pending.indexOf('\n\n')) >= 0) {
      const block = pending.slice(0, end); pending = pending.slice(end + 2); blocks.push(block)
      if (block === 'PING:') socket.write('ACK\n\n')
      else if (block === 'VIDEO OUTPUT ROUTING:\n4 2') { if (refuseAfterRoute) socket.end(); else socket.write('ACK\n\n') }
      else if (block === 'VIDEO OUTPUT ROUTING:') socket.write('ACK\n\nVIDEO OUTPUT ROUTING:\n4 2\n\n')
    }
  })
})
await new Promise<void>(resolve => peer.listen(0, '127.0.0.1', resolve))
const equipmentPort = (peer.address() as { port: number }).port
const reservation = createServer(); await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()))
const base = `http://127.0.0.1:${port}`, ownedEngines = new Set<number>()
let child: ChildProcess | null = null, diagnostics = '', startupDiagnostic = ''
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
async function wait(message: string, check: () => boolean | Promise<boolean>, timeout = 20_000) {
  const end = performance.now() + timeout
  while (performance.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(message + '; ' + diagnostics.slice(-2000) + '; ' + startupDiagnostic)
}
async function api(path: string, body?: object, status = 200, method?: string, headers:Record<string,string>={}) {
  const service = path === '/api/external/control' || path === '/api/v1/external/control'
  const reply = await fetch(base + path, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), ...(method ? { method } : {}), headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(service ? { 'x-rplayout-control-token': 'QA_LOCAL_TRANSPORT_ONLY' } : {}),...headers }, signal: AbortSignal.timeout(5000) })
  const result = await reply.json() as any
  assert.equal(reply.status, status, `${path}: ${JSON.stringify(result)}`)
  return result
}
async function configurationHeaders(){
  const {channel}=await api('/api/channels/automation/configuration')
  return {'if-match':`"channel:automation:${channel.configurationRevision}"`}
}
function start() {
  diagnostics = ''; startupDiagnostic = ''
  child = spawn(argument < 0 ? process.execPath : join(root, 'runtime/node/node.exe'), [join(root, 'apps/server/dist/server.cjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    RPLAYOUT_DB: join(directory, 'automation.db'), RPLAYOUT_INSTALL_ROOT: root, RPLAYOUT_MEDIA: media, RPLAYOUT_THUMBS: join(directory, 'thumbs'), RPLAYOUT_MEDIA_VERSIONS: join(directory, 'versions'), RPLAYOUT_CACHE: join(directory, 'cache'), RPLAYOUT_BACKUPS: join(directory, 'backups'),
    RPLAYOUT_ENGINE: join(root, 'apps/engine/target/release/rplayout-engine.exe'), RPLAYOUT_ENGINE_OUTPUT: 'null', RPLAYOUT_MEDIAMTX: '', RPLAYOUT_DEVICES: '', RPLAYOUT_RELAY: '', RPLAYOUT_PROBE: '', RPLAYOUT_PROXY: '', RPLAYOUT_N1_PEER: '', RPLAYOUT_BACKUP_HOURS: '0', RPLAYOUT_ADMIN_USER: '', RPLAYOUT_ADMIN_PASSWORD: '', RPLAYOUT_ROLE: 'ADMIN', RPLAYOUT_CONTROL_TOKEN: 'QA_LOCAL_TRANSPORT_ONLY',
    GSTREAMER_1_0_ROOT_MSVC_X86_64: gstRoot, GST_PLUGIN_PATH: join(gstRoot, 'lib/gstreamer-1.0'), GST_PLUGIN_SYSTEM_PATH: join(gstRoot, 'lib/gstreamer-1.0'), GST_PLUGIN_SCANNER: join(gstRoot, 'libexec/gstreamer-1.0/gst-plugin-scanner.exe'), GST_REGISTRY: join(directory, 'gst-registry.bin'), PATH: argument < 0 ? gstBin + ';' + process.env.PATH : [gstBin, join(process.env.SystemRoot!, 'System32'), process.env.SystemRoot!, join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0')].join(';'), PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'warn' } })
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-8000) })
  child.on('error', error => { diagnostics += error.message })
  child.on('exit', (code, signal) => { diagnostics += `\nQA server exit code=${code} signal=${signal}` })
}
const secondaryRunCount = () => (database.sqlite.prepare('SELECT count(*) n FROM secondary_event_runs').get() as { n: number }).n
async function engine() { const row = (await api('/api/processes')).processes.find((entry: any) => entry.kind === 'ENGINE' && entry.channelId === 'automation'); assert.ok(row?.pid); ownedEngines.add(row.pid); return row.pid as number }
async function awaitStableConfiguration() {
  // A PGM state can precede completion of the TAKE recovery promise. Do not
  // race another configuration or retry mutations: wait for its explicit gate.
  await wait('Recuperação não liberou reconfiguração', async () => (await api('/api/n1/state')).channels.some((row:any) => row.channelId==='automation' && row.health.ready && row.reconfiguration?.ready===true))
}
try {
  const now = new Date().toISOString(), hash = createHash('sha256').update(await readFile(file)).digest('hex')
  database.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('automation', 'Automação isolada', 25, 1, 320, 180, -23, -1, 5, now)
  database.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('rd', 'automation', 'Teste', 0, now.slice(0, 10), now, now)
  database.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('other', 'automation', 'Outra grade QA', 0, now.slice(0, 10), now, now)
  database.sqlite.prepare('INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,interlace_mode,has_audio,qc_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('asset', hash, file, 'VT QA', 'VIDEO', 1500, 60_000_000_000, 320, 180, 25, 1, 'progressive', 0, 'APPROVED', now)
  database.sqlite.prepare('INSERT INTO rundown_items (id,rundown_id,sort_order,title,type,media_id,anchor,on_overrun,min_duration,auto_next,loop,locked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('vt', 'rd', 0, 'VT QA', 'VT', 'asset', JSON.stringify({ kind: 'FLOW' }), 'PUSH', 0, 0, 0, 0)
  start(); await wait('Servidor não iniciou', async () => {
    try {
      const health = await api('/api/health')
      if (health.engines !== 1) {
        const state = await api('/api/n1/state')
        startupDiagnostic = JSON.stringify({health,engines:state.channels.map((row:any) => ({channelId:row.channelId,health:row.health}))})
      }
      return health.engines === 1
    } catch (error) { startupDiagnostic = `QA health request=${String(error)}`; return false }
  })
  await engine()
  const device = (await api('/api/external/devices', { name: 'QA — LOCAL', kind: 'VIDEOHUB_ROUTER', host: '127.0.0.1', port: equipmentPort, enabled: true }, 201)).device
  const events: any[] = []
  for (const [name, action, triggerMode] of [['Consulta automática', 'PING', 'OFFSET_FROM_START'], ['Rota manual', 'ROUTE_CROSSPOINT', 'MANUAL'], ['Rota incerta', 'ROUTE_CROSSPOINT', 'MANUAL'], ['Rota bloqueada', 'ROUTE_CROSSPOINT', 'MANUAL']]) {
    const editing=await api('/api/items/vt/secondary-events')
    events.push((await api('/api/items/vt/secondary-events', { name, type: 'DEVICE_AUTOMATION', targetLayer: 'LOWER_THIRD', triggerMode, offsetFrames: 0, deviceConfig: { deviceId: device.id, targetDevice: 'VIDEOHUB_ROUTER', action, params: action === 'PING' ? {} : { source: 2, destination: 4 } } },200,undefined,{'if-match':`w/"${editing.editorialRevision}"`})).event)
  }
  const {review}=await api('/api/rundowns/rd/operational-simulation')
  const revision = await api('/api/rundowns/rd/operational-publish', {reviewToken:review.token}, 201,undefined,{'if-match':`w/"${review.editorialRevision}"`})
  const publishedRevision = (database.sqlite.prepare('SELECT id FROM operational_playlist_revisions WHERE active=1 AND rundown_id=?').get('rd') as { id: string }).id
  assert.deepEqual(blocks, [], 'Programação/publicação enviou comando')
  assert.match((await api('/api/external/control', { action: 'take', channelId: 'automation' }, 409)).error, /CUE\/PVW/)
  const externalTake = await api('/api/external/control', { action: 'take', channelId: 'automation', itemId: 'vt' })
  assert.equal(externalTake.accepted, true)
  assert.equal(externalTake.transport, 'NATIVE')
  assert.equal(externalTake.nativeProgramConfirmed, true)
  assert.equal(externalTake.physicalOutputValidated, false)
  await wait('Consulta automática não foi persistida', () => Boolean(database.sqlite.prepare("SELECT 1 FROM secondary_event_runs WHERE event_id=? AND state='EXECUTED'").get(events[0].id)))
  assert.deepEqual(blocks, ['PING:'])
  const rejectedLoad = await api('/api/channels/automation/load-rundown', { rundownId: 'other' }, 409)
  assert.match(rejectedLoad.error, /PGM/)
  assert.equal((await api('/api/n1/state')).channels.find((row: any) => row.channelId === 'automation').state.onAir.itemId, 'vt')
  const path = (event: any) => `/api/channels/automation/secondary-events/${event.id}/fire`
  const first = await api(path(events[1]), {}), duplicate = await api(path(events[1]), {})
  assert.equal(first.run.state, 'EXECUTED'); assert.equal(duplicate.run.id, first.run.id)
  assert.equal(blocks.filter(block => block === 'VIDEO OUTPUT ROUTING:\n4 2').length, 1)
  refuseAfterRoute = true
  const uncertain = await api(path(events[2]), {}, 409)
  assert.equal(uncertain.run.state, 'FIRING')
  const sentBeforeBlocked = blocks.length
  assert.equal((await api(path(events[3]), {}, 409)).run.state, 'FAILED')
  assert.equal(blocks.length, sentBeforeBlocked)
  await api('/api/v1/external/control', { requestId: randomUUID(), deviceId: device.id, targetDevice: 'VIDEOHUB_ROUTER', action: 'ROUTE_CROSSPOINT', params: { source: 2, destination: 4 } }, 409)
  assert.equal(blocks.length, sentBeforeBlocked, 'Rota de serviço contornou o bloqueio de comando incerto')
  const history = await api('/api/external/commands'), uncertainRequest = history.runs.find((entry: any) => entry.command.origin?.eventId === events[2].id)
  assert.equal(uncertainRequest.state, 'FIRING')
  await api(`/api/external/commands/${uncertainRequest.requestId}/acknowledge`, { note: 'QA local: destino incerto conferido sem repetição' })
  assert.equal((await api(path(events[2]), {}, 409)).run.state, 'FIRING')
  assert.equal(blocks.length, sentBeforeBlocked)
  const beforeControlledRestart = await engine()
  assert.equal((await api('/api/channels/automation/restart', {})).controlledInterruption, true)
  await wait('Reinício controlado não encerrou engine anterior', () => !alive(beforeControlledRestart), 10_000)
  await wait('Reinício controlado não retomou o PGM', async () => { try { return (await api('/api/n1/state')).channels.some((row: any) => row.channelId === 'automation' && row.health.ready && row.state.onAir?.itemId === 'vt') } catch { return false } })
  assert.notEqual(await engine(), beforeControlledRestart)
  assert.equal(blocks.length, sentBeforeBlocked, 'Reinício controlado repetiu automação externa')
  const beforeGeometry = await engine()
  await awaitStableConfiguration()
  const geometry = await api('/api/channels/automation', { width: 640, height: 360 }, 200, 'PATCH',await configurationHeaders())
  assert.equal(geometry.controlledInterruption, true); assert.equal(geometry.recoveryRequested, true)
  await wait('Reconfiguração de geometria não encerrou engine anterior', () => !alive(beforeGeometry), 10_000)
  await wait('Reconfiguração de geometria não retomou o PGM', async () => (await api('/api/n1/state')).channels.some((row: any) => row.channelId === 'automation' && row.health.ready && row.state.onAir?.itemId === 'vt'))
  assert.notEqual(await engine(), beforeGeometry)
  const cadence = await api('/api/channels/automation', { rateNum: 50 }, 409, 'PATCH',await configurationHeaders())
  assert.match(cadence.error, /quadros/)
  assert.equal((database.sqlite.prepare('SELECT rate_num FROM channels WHERE id=?').get('automation') as any).rate_num, 25)
  assert.equal(blocks.length, sentBeforeBlocked, 'Geometria/cadência repetiu automação externa')
  const beforeOutput = await engine()
  await awaitStableConfiguration()
  const added = await api('/api/channels/automation/outputs', {name:'Gravação QA',kind:'FILE',target:join(directory,'qa-first.mkv')},200,'POST',await configurationHeaders())
  assert.equal(added.recoveryRequested, true)
  await wait('Criar saída não retomou PGM', async () => (await api('/api/n1/state')).channels.some((row:any) => row.channelId==='automation' && row.health.ready && row.state.onAir?.itemId==='vt'))
  assert.notEqual(await engine(), beforeOutput)
  const beforeHot = await engine()
  await awaitStableConfiguration()
  const hot = await api(`/api/outputs/${added.output.id}`, {target:join(directory,'qa-second.mkv')},200,'PATCH',await configurationHeaders())
  assert.equal(hot.applied, 'hot'); assert.equal(hot.restartRequired, false)
  assert.equal(await engine(), beforeHot)
  assert.equal((await api('/api/n1/state')).channels.find((row:any) => row.channelId==='automation').state.onAir.itemId,'vt')
  assert.equal((await api(`/api/outputs/${added.output.id}`, {enabled:false},200,'PATCH',await configurationHeaders())).recoveryRequested,true)
  await wait('Desativar saída não retomou PGM', async () => (await api('/api/n1/state')).channels.some((row:any) => row.channelId==='automation' && row.health.ready && row.state.onAir?.itemId==='vt'))
  await awaitStableConfiguration()
  assert.equal((await api(`/api/outputs/${added.output.id}`,undefined,200,'DELETE',await configurationHeaders())).recoveryRequested,true)
  await wait('Remover saída não retomou PGM', async () => (await api('/api/n1/state')).channels.some((row:any) => row.channelId==='automation' && row.health.ready && row.state.onAir?.itemId==='vt'))
  assert.equal(blocks.length,sentBeforeBlocked,'Configuração de saídas repetiu automação externa')
  const oldEngine = await engine(), oldServer = child!.pid!
  child!.kill('SIGKILL'); await wait('Servidor não encerrou', () => !alive(oldServer)); await wait('Engine órfão', () => !alive(oldEngine), 10_000)
  start(); await wait('PGM não retomou', async () => { try { return (await api('/api/n1/state')).channels.some((row: any) => row.channelId === 'automation' && row.health.ready && row.state.onAir?.itemId === 'vt') } catch { return false } })
  await engine()
  assert.equal(blocks.length, sentBeforeBlocked, 'Recuperação repetiu automação externa')
  assert.equal(secondaryRunCount(), 4)
  const project = (await api('/api/channels/automation/projects',{label:'Projeto QA configuração'})).project
  const restoreUrl = `/api/channels/automation/projects/${project.id}/restore`
  await api(restoreUrl,{},409)
  await awaitStableConfiguration()
  await api('/api/channels/automation',{width:800},200,'PATCH',await configurationHeaders())
  await wait('Última configuração não retomou PGM antes do STOP', async () => (await api('/api/n1/state')).channels.some((row:any) => row.channelId==='automation' && row.health.ready && row.state.onAir?.itemId==='vt'))
  await awaitStableConfiguration()
  await api('/api/channels/automation/transport', { action: 'stop' })
  await wait('STOP não fechou as-run nativo', () => Boolean(database.sqlite.prepare("SELECT 1 FROM as_run WHERE ended_by='STOP' AND execution_kind='NATIVE' AND duration_evidence='ENGINE_POSITION'").get()))
  const beforeRestore = await engine()
  assert.equal((await api(restoreUrl,{})).controlledInterruption,true)
  await wait('Restauração não encerrou engine com configuração antiga',() => !alive(beforeRestore),10_000)
  await wait('Restauração não deixou canal pronto e parado',async() => (await api('/api/n1/state')).channels.some((row:any) => row.channelId==='automation' && row.health.ready && row.state.onAir===null))
  assert.notEqual(await engine(),beforeRestore)
  assert.equal((database.sqlite.prepare('SELECT width FROM channels WHERE id=?').get('automation') as any).width,640)
  assert.equal((database.sqlite.prepare('SELECT id FROM operational_playlist_revisions WHERE active=1 AND rundown_id=?').get('rd') as any).id,publishedRevision)
  assert.equal(blocks.length,sentBeforeBlocked,'Restaurar projeto repetiu automação externa')
  await awaitStableConfiguration()
  // This fixture deliberately has no preview publisher. PVW/CUE is tested by
  // the separate OMT loopback and software routes, not a nonexistent monitor.
  await api('/api/channels/automation/load-rundown', { rundownId: 'other' })
  assert.equal((await api('/api/n1/state')).channels.find((row: any) => row.channelId === 'automation').state.onAir, null)
  assert.equal(blocks.length, sentBeforeBlocked, 'Troca de grade disparou automação antiga')
  const extraChannel=await api('/api/channels',{name:'QA — mantém um canal ativo'})
  const extraId=extraChannel.channelId
  assert.ok(extraId,'Canal adicional não retornou identidade')
  for(const row of (await api('/api/processes')).processes)if(row.kind==='ENGINE' && row.pid)ownedEngines.add(row.pid)
  const beforeArchive=await engine(),historicCount=(database.sqlite.prepare('SELECT count(*) n FROM as_run WHERE channel_id=?').get('automation') as any).n
  assert.ok(historicCount>0)
  const archived=await api('/api/channels/automation',undefined,200,'DELETE')
  assert.equal(archived.historyPreserved,true);assert.equal(archived.archived,true)
  await wait('Arquivar não encerrou o engine próprio',()=>!alive(beforeArchive),10_000)
  assert.equal((await api('/api/state')).channels.some((row:any)=>row.id==='automation'),false)
  assert.equal((await api('/api/n1/state')).channels.some((row:any)=>row.channelId==='automation'),false)
  assert.equal((await api('/api/channels/archived')).channels.find((row:any)=>row.id==='automation').archivedAt!==null,true)
  assert.equal((database.sqlite.prepare('SELECT count(*) n FROM as_run WHERE channel_id=?').get('automation') as any).n,historicCount)
  assert.equal((database.sqlite.prepare('SELECT id FROM operational_playlist_revisions WHERE active=1 AND rundown_id=?').get('rd') as any).id,publishedRevision)
  await api('/api/channels/automation/restart',{},409)
  assert.equal((await api('/api/channels/automation/reactivate',{})).automaticTake,false)
  assert.equal((await api('/api/n1/state')).channels.some((row:any)=>row.channelId==='automation'),false)
  assert.equal(JSON.parse((database.sqlite.prepare('SELECT payload FROM channel_checkpoints WHERE channel_id=?').get('automation') as any).payload).playing,false)
  const stateAudit=await api('/api/audit?channelId=automation')
  assert.ok(stateAudit.entries.some((row:any)=>row.kind==='CHANNEL_ARCHIVED'))
  assert.ok(stateAudit.entries.some((row:any)=>row.kind==='CHANNEL_REACTIVATED'))
  assert.equal(blocks.length,sentBeforeBlocked,'Arquivar/reativar repetiu automação externa')
  console.log(JSON.stringify({result:'PASS',directory,channelArchiveRetiresEngine:true,asRunAndPublicationPreserved:true,reactivationDoesNotStartEngineOrTake:true,channelAuditReadable:true,physicalOutputValidated:false}))
  console.log(JSON.stringify({result:'PASS',directory,geometryRebuildResumesPgm:true,cadenceChangeRefusesFrameReinterpretation:true,outputCreationDisableDeleteResumePgm:true,hotOutputKeepsEngineAndPgm:true,configurationDoesNotReplayAutomation:true,projectRestoreRebuildsStoppedEngine:true,publishedHistoryPreserved:true,physicalOutputValidated:false}))
  console.log(JSON.stringify({ result: 'PASS', evidence: 'COMPILED_NATIVE_PGM_AND_LOCAL_DEVICE_AUTOMATION', directory, root, port, equipmentPort, revisionId: publishedRevision, programmedWithoutSending: true, nativePgmRequired: true, pingWithoutRouting: true, manualDuplicateNotResent: true, unknownRouteBlocksNext: true, serviceCannotBypassUncertainty: true, externalTakeDoesNotInferNext: true, externalTakeReportsNativeConfirmation: true, controlledRestartResumesWithoutReplay: true, acknowledgementDoesNotReplay: true, recoveryDoesNotReplay: true, secondaryRuns: 4, historicalRateAndNativeCursorInAsRun: true, playlistActivationPreservesPgm: true, previewPublisherEnabled: false, localProtocolBlocks: blocks, physicalOutputValidated: false }))
} finally {
  child?.kill('SIGKILL')
  for (const pid of ownedEngines) if (alive(pid)) { try { process.kill(pid) } catch {} }
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => peer.close(() => resolve()))
  database.sqlite.close()
}

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// This test only creates/kills its own fakesink engine. It never opens a board
// or network publisher and never touches the installation's operational DB.
const run = promisify(execFile)
const directory = await mkdtemp(join(tmpdir(), 'RPlayout-recovery-'))
process.env.RPLAYOUT_VAULT_FILE = join(directory, 'vault.json')
const mediaPath = join(directory, 'RECUPERAÇÃO-ÇÃO.mp4')
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))
process.env.RPLAYOUT_ENGINE = resolve(workspaceRoot, 'apps/engine/target/release/rplayout-engine.exe')
const gstBin = join(process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ?? 'C:/Program Files/gstreamer/1.0/msvc_x86_64', 'bin')
await run(join(gstBin, 'gst-launch-1.0.exe'), ['-q', 'videotestsrc', 'num-buffers=750', '!', 'video/x-raw,width=320,height=180,framerate=25/1', '!', 'videoconvert', '!', 'x264enc', 'speed-preset=ultrafast', '!', 'h264parse', '!', 'mp4mux', '!', 'filesink', `location=${mediaPath.replaceAll('\\', '/')}`], { timeout: 30_000, windowsHide: true })
const [{ openDatabase }, { getChannel }, { ChannelRuntime }, { Checkpoints }, { publishOperationalPlaylist }] = await Promise.all([
  import('../apps/server/src/db/client.js'), import('../apps/server/src/db/repo.js'), import('../apps/server/src/app.js'),
  import('../apps/server/src/domain/checkpoints.js'), import('../apps/server/src/domain/operational-playlist.js'),
])
let database = openDatabase(join(directory, 'recovery.db'))
let runtime: InstanceType<typeof ChannelRuntime> | null = null
async function waitFor(description: string, predicate: () => boolean, timeout = 15_000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    runtime?.transport.tick()
    runtime?.transport.watchdog()
    runtime?.checkpoint(true)
    runtime?.fireDueGraphics()
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`${description}: ${JSON.stringify(runtime?.transport.health())} ${JSON.stringify(runtime?.transport.state())}`)
}
try {
  const now = new Date().toISOString()
  const hash = createHash('sha256').update(await readFile(mediaPath)).digest('hex')
  database.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('recovery', 'Teste isolado', 25,1,320,180,-23,-1,5,now)
  database.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('rd','recovery','Teste',0,now.slice(0,10),now,now)
  database.sqlite.prepare('INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,duration_ns,width,height,rate_num,rate_den,interlace_mode,has_audio,qc_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('asset',hash,mediaPath,'RECUPERAÇÃO','VIDEO',750,30_000_000_000,320,180,25,1,'progressive',0,'APPROVED',now)
  database.sqlite.prepare('INSERT INTO rundown_items (id,rundown_id,sort_order,title,type,media_id,anchor,on_overrun,min_duration,auto_next,loop,locked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('vt','rd',0,'VT teste','VT','asset',JSON.stringify({kind:'FLOW'}),'PUSH',0,0,0,0)
  const channel = (await getChannel(database.db, 'recovery'))!
  const {secondaryEvents}=await import('../apps/server/src/db/schema.js')
  await database.db.insert(secondaryEvents).values({id:'secondary-test',channelId:'recovery',itemId:'vt',
    definition:{id:'secondary-test',channelId:'recovery',rundownItemId:'vt',name:'Logo congelado',targetLayer:'STATION_LOGO',type:'GRAPHICS_OVERLAY',triggerMode:'OFFSET_FROM_START',offsetFrames:0,templateId:'',payload:{title:'RECUPERAÇÃO'},enabled:true},createdAt:now,updatedAt:now})
  const revision = await publishOperationalPlaylist(database.db, channel, 'rd', '@process-test')
  runtime = new ChannelRuntime(channel, database.db, ['null'], null, new Set(), new Map(), null, new Checkpoints(database.sqlite))
  await runtime.load('rd')
  await waitFor('Engine não ficou pronto', () => runtime!.transport.health().ready)
  await runtime.transport.take('rd', 'vt')
  await waitFor('Não avançou posição nativa', () => (runtime!.transport.state().onAir?.elapsed ?? 0) >= 25)
  const before = Math.floor(runtime.transport.state().onAir!.elapsed)
  // Periodic observers must not duplicate a confirmed native TAKE.
  await Promise.all(Array.from({ length: 20 }, () => runtime!.followAsRun()))
  runtime.checkpoint(true)
  const executionId=new Checkpoints(database.sqlite).read('recovery')!.executionId
  assert.ok(executionId)
  await waitFor('Evento secundário não executado',()=>Boolean(database.sqlite.prepare("SELECT 1 FROM secondary_event_runs WHERE state='EXECUTED'").get()))
  const killedPid = runtime.transport.processId()
  assert.ok(killedPid && killedPid !== process.pid)
  process.kill(killedPid)
  await waitFor('Watchdog não restaurou o item', () => runtime!.transport.health().deaths > 0 && runtime!.transport.health().ready && runtime!.transport.processId() !== killedPid && runtime!.transport.state().onAir?.itemId === 'vt')
  const recovered = Math.floor(runtime.transport.state().onAir!.elapsed)
  assert.ok(recovered >= before, `Retomou de ${recovered}, anterior ${before}`)
  await waitFor('Posição não avançou após recuperação', () => (runtime!.transport.state().onAir?.elapsed ?? 0) >= recovered + 25)
  const saved = new Checkpoints(database.sqlite).read('recovery')!
  assert.equal(saved.revisionId, revision.id)
  assert.equal(saved.executionId,executionId,'Watchdog must keep the same execution identity')
  assert.ok(saved.elapsed > before)
  runtime.close(); await runtime.asRun.finish('TEST_RUNTIME_RESTART'); database.sqlite.close()
  database = openDatabase(join(directory, 'recovery.db'))
  runtime = new ChannelRuntime(channel, database.db, ['null'], null, new Set(), new Map(), null, new Checkpoints(database.sqlite))
  assert.equal(await runtime.recoverCheckpoint(), true)
  await waitFor('Checkpoint não restaurou PGM', () => runtime!.transport.health().ready && runtime!.transport.state().onAir?.itemId === 'vt')
  assert.ok(Math.floor(runtime.transport.state().onAir!.elapsed) >= saved.elapsed)
  await waitFor('Identidade de execução não restaurada',()=>new Checkpoints(database.sqlite).read('recovery')?.executionId===executionId)
  assert.equal((database.sqlite.prepare('SELECT count(*) n FROM secondary_event_runs').get() as {n:number}).n,1,'Recovery must not create a duplicate timed command')
  await runtime.asRun.finish('TEST_END', Math.floor(runtime.transport.state().onAir!.elapsed))
  const asRun = database.sqlite.prepare('SELECT revision_id, start_position_frames, end_position_frames, ended_by FROM as_run ORDER BY rowid').all() as Array<{ revision_id: string; start_position_frames: number; end_position_frames: number | null; ended_by: string }>
  assert.equal(asRun.length, 3, 'One row per confirmed original, recovered and restarted TAKE')
  assert.equal(asRun[0]!.ended_by, 'ENGINE_FAILURE')
  assert.equal(asRun[0]!.end_position_frames, before)
  assert.equal(asRun[1]!.start_position_frames, recovered)
  assert.equal(asRun[2]!.start_position_frames, saved.elapsed)
  assert.ok(asRun.every(row => row.revision_id === revision.id))
  console.log(JSON.stringify({ result: 'PASS', evidence: 'NATIVE_ENGINE_FAKESINK_AND_RUNTIME_RESTART', directory, killedPid, beforeFrames: before, watchdogFrames: recovered, checkpointFrames: saved.elapsed, restartedFrames: runtime.transport.state().onAir!.elapsed, revisionId: revision.id, executionId,secondaryDispatches:1,asRun,physicalOutputValidated: false }))
} finally {
  runtime?.close()
  await runtime?.asRun.finish('TEST_END')
  database.sqlite.close()
}

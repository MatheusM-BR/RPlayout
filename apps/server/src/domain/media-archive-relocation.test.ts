import { afterEach, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../db/client.js'
import { MediaWorkflow } from './media-workflow.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

it('traz cópias de versão de fora para a pasta fixa, conferindo o hash, sem apagar a antiga', async () => {
  const base = await mkdtemp(join(tmpdir(), 'rplayout-archive-')); dirs.push(base)
  const db = openDatabase(':memory:'), sqlite = db.sqlite
  const content = Buffer.from('video'), hash = createHash('sha256').update(content).digest('hex')
  const old = join(base, 'antiga', `${hash}.mp4`), missing = join(base, 'antiga', 'sumiu.mp4')
  await (await import('node:fs/promises')).mkdir(join(base, 'antiga'), { recursive: true })
  await writeFile(old, content)
  const now = new Date().toISOString()
  sqlite.prepare("INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,rate_num,rate_den,created_at) VALUES ('a','x','p','t','VIDEO',250,25,1,?)").run(now)
  for (const [id, path] of [['v1', old], ['v2', missing]]) {
    sqlite.prepare('INSERT INTO media_versions (id,asset_id,revision,content_hash,metadata,archive_path,created_at) VALUES (?,?,?,?,?,?,?)').run(id, 'a', id === 'v1' ? 1 : 2, id === 'v1' ? hash : 'b'.repeat(64), '{}', path, now)
    sqlite.prepare("INSERT INTO media_jobs (id,version_id,kind,state,output_path,created_at,updated_at) VALUES (?,?,'ARCHIVE','READY',?,?,?)").run(randomUUID(), id, path, now, now)
  }
  const workflow = new MediaWorkflow(sqlite, join(base, 'fixa'), '')
  expect(await workflow.relocateArchives()).toEqual({ moved: 1, missing: 1, failed: 0 })
  const moved = sqlite.prepare("SELECT archive_path FROM media_versions WHERE id='v1'").get() as { archive_path: string }
  expect(moved.archive_path).toBe(join(base, 'fixa', `${hash}.mp4`))
  expect(await readFile(moved.archive_path)).toEqual(content)
  expect(existsSync(old)).toBe(true)
  expect((sqlite.prepare("SELECT output_path FROM media_jobs WHERE version_id='v1'").get() as { output_path: string }).output_path).toBe(moved.archive_path)
  expect(await workflow.relocateArchives()).toEqual({ moved: 0, missing: 1, failed: 0 })
  await workflow.close(); sqlite.close()
})

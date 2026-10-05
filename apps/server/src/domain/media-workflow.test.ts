import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/client.js'
import { MediaWorkflow } from './media-workflow.js'

let database: ReturnType<typeof openDatabase>, root: string, workflow: MediaWorkflow
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rplayout-workflow-'))
  database = openDatabase(join(root, 'workflow.db'))
  database.sqlite.exec("INSERT INTO media_assets (id,content_hash,path,title,kind,duration_frames,created_at) VALUES ('a','old','test','AÇÃO','VIDEO',25,'now')")
  workflow = new MediaWorkflow(database.sqlite, join(root, 'versions'), '')
})
afterEach(async () => { workflow.close(); database.sqlite.close(); await rm(root, { recursive: true, force: true }) })
const hash = (content: string) => createHash('sha256').update(content).digest('hex')
async function wait() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = workflow.jobs() as Array<{ state: string }>
    if (jobs.every(job => !['PENDING', 'RUNNING'].includes(job.state))) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('worker did not finish')
}
describe('ingestão durável e versões', () => {
  it('preserva cópia e metadata por hash sem duplicar a mesma versão', async () => {
    const source = join(root, 'ÇÃO.mp4'); await writeFile(source, 'first')
    const metadata = { contentHash: hash('first'), kind: 'VIDEO', path: source, title: 'AÇÃO' }
    const firstId = workflow.record('a', metadata)
    expect(workflow.record('a', metadata)).toBe(firstId)
    await wait()
    const archived = await workflow.archived('a', hash('first'))
    expect(archived).toBeTruthy()
    await writeFile(source, 'second')
    workflow.record('a', { ...metadata, contentHash: hash('second') }); await wait()
    expect(await workflow.inspectionOriginal('a',hash('first'),source)).toBe(archived)
    expect(await readFile(archived!, 'utf8')).toBe('first')
    expect(workflow.versions('a').map(version => version.revision)).toEqual([2, 1])
    expect(await workflow.preview('a', hash('first'))).toBeNull()
    expect((workflow.jobs() as Array<{ kind: string; state: string; error: string }>).filter(job => job.kind === 'PROXY')).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'FAILED', error: expect.stringContaining('Gerador de proxy') })]))
    await writeFile(archived!, 'corrupted')
    expect(await workflow.archived('a', hash('first'))).toBeNull()
    expect(await workflow.inspectionOriginal('a',hash('first'),source)).toBeNull()
  })
  it('recusa arquivar uma versão quando o arquivo foi substituído', async () => {
    const source = join(root, 'alterado.mp4'); await writeFile(source, 'new')
    workflow.record('a', { contentHash: hash('old'), kind: 'VIDEO', path: source }); await wait()
    expect(await workflow.archived('a', hash('old'))).toBeNull()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ARCHIVE', state: 'FAILED', error: expect.stringContaining('arquivo mudou') })]))
    expect(workflow.record('a', { contentHash: hash('old'), kind: 'AUDIO', path: source })).toBeNull()
  })
  it('retoma trabalho interrompido com o mesmo ID, sem perder tentativas', async () => {
    const source = join(root, 'retomar.mp4'); await writeFile(source, 'resume')
    workflow.record('a', { contentHash: hash('resume'), kind: 'VIDEO', path: source }); await wait()
    const proxy = (workflow.jobs() as Array<{ id: string; kind: string }>).find(job => job.kind === 'PROXY')!
    database.sqlite.prepare("UPDATE media_jobs SET state='RUNNING', attempts=1 WHERE id=?").run(proxy.id)
    workflow.close()
    workflow = new MediaWorkflow(database.sqlite, join(root, 'versions'), '')
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({ id: proxy.id, state: 'PENDING', attempts: 1 })]))
    await workflow.tick(); await wait()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({ id: proxy.id, state: 'FAILED', attempts: 2 })]))
    expect(workflow.retry(proxy.id)).toBe(true); await wait()
    expect(workflow.jobs()).toEqual(expect.arrayContaining([expect.objectContaining({ id: proxy.id, attempts: 1 })]))
  })
})

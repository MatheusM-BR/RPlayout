import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MediaMtx, channelPaths } from './mediamtx.js'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

it('grava só o PGM, em segmentos, apagando depois do prazo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rplayout-mtx-')); dirs.push(dir)
  const configPath = join(dir, 'mediamtx.yml')
  const server = new MediaMtx({ binary: 'mediamtx', configPath, bind: '127.0.0.1', logLevel: 'warn', record: { directory: 'D:\\RPlayout Gravacao PGM\\', hours: 24 } })
  await server.apply(channelPaths([{ id: 'abcd-1', name: 'RW' }]), [])
  const config = await readFile(configPath, 'utf8')
  expect(config).toContain('  rw/pgm:\n    record: yes\n    recordPath: "D:/RPlayout Gravacao PGM/%path/%Y-%m-%d_%H-%M-%S-%f"\n    recordFormat: fmp4\n    recordSegmentDuration: 15m\n    recordDeleteAfter: 24h\n')
  expect(config).toContain('  rw/pvw:\n  rw/qc:')
  const plain = new MediaMtx({ binary: 'mediamtx', configPath, bind: '127.0.0.1', logLevel: 'warn' })
  await plain.apply(channelPaths([{ id: 'abcd-1', name: 'RW' }]), [])
  expect(await readFile(configPath, 'utf8')).not.toContain('record')
})

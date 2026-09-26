import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/client.js'
import { eq } from 'drizzle-orm'
import { channels, outputProfiles, rundowns } from '../db/schema.js'
import { listChannelProjects, restoreChannelProject, saveChannelProject } from './channel-projects.js'

describe('projetos versionados por canal', () => {
  const opened: ReturnType<typeof openDatabase>[] = []
  afterEach(() => opened.splice(0).forEach(({ sqlite }) => sqlite.close()))

  it('restaura somente o canal salvo', async () => {
    const db = openDatabase(':memory:')
    opened.push(db)
    const createdAt = '2026-09-26T00:00:00.000Z'
    for (const id of ['a', 'b']) {
      await db.db.insert(channels).values({ id, name: id, rateNum: 25, rateDen: 1, width: 1920, height: 1080, scan: 'PROGRESSIVE', fieldOrder: 'TFF', targetLufs: -23, ceilingDbtp: -1, limiterLookaheadMs: 5, createdAt })
    }
    await db.db.insert(outputProfiles).values({ id: 'out-a', channelId: 'a', name: 'Saída A', kind: 'RTMP', target: 'rtmp://a', role: 'PROGRAM', enabled: true, createdAt })
    await db.db.insert(rundowns).values({ id: 'run-a', channelId: 'a', name: 'Grade A', plannedStart: 0, loop: true, date: '2026-09-26', createdAt, updatedAt: createdAt })
    await db.db.insert(outputProfiles).values({ id: 'out-b', channelId: 'b', name: 'Saída B', kind: 'RTMP', target: 'rtmp://b', role: 'PROGRAM', enabled: true, createdAt })
    const saved = await saveChannelProject(db.db, 'a', 'Antes da mudança')
    await db.db.delete(outputProfiles).where(eq(outputProfiles.channelId, 'a'))
    await restoreChannelProject(db.db, 'a', saved.id)
    const projects = await listChannelProjects(db.db, 'a')
    expect(projects).toHaveLength(1)
    const restoredA = await db.db.select().from(outputProfiles)
    expect(restoredA).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'out-a', channelId: 'a' })]))
    expect(restoredA).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'out-b', channelId: 'b' })]))
  })
})

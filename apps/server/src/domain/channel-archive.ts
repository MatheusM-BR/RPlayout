import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Checkpoints,stoppedCheckpoint } from './checkpoints.js'
import { installationVault } from './secret-vault.js'

/** Atomic last-active guard; never deletes editorial, operational or as-run
 * data. Native STOP/CUE/pending command guards belong to the owning queue. */
export function setChannelArchived(sqlite:Database.Database,id:string,archive:boolean,actor:string|null) {
  return sqlite.transaction(() => {
    const channel=sqlite.prepare('SELECT archived_at FROM channels WHERE id=?').get(id) as {archived_at:string|null}|undefined
    if (!channel) throw new Error('Canal não encontrado.')
    if (Boolean(channel.archived_at)===archive) return {archived:archive,archivedAt:channel.archived_at,alreadyApplied:true}
    if (archive && (sqlite.prepare('SELECT count(*) n FROM channels WHERE archived_at IS NULL').get() as {n:number}).n<=1) throw new Error('Este é o único canal ativo. Crie ou reative outro antes de arquivar.')
    const at=new Date().toISOString(),archivedAt=archive ? at : null
    if (archive) {
      const checkpoints=new Checkpoints(sqlite),saved=checkpoints.read(id)
      // The owning runtime already persisted its confirmed STOP. Preserve that
      // native checkpoint byte-for-byte: this editorial transaction has no
      // execution lease and must not impersonate its owner. A protected playing
      // checkpoint remains rejected by Checkpoints.write; empty runtime != STOP.
      if (saved?.playing) checkpoints.write(stoppedCheckpoint(saved))
    }
    sqlite.prepare('UPDATE channels SET archived_at=? WHERE id=?').run(archivedAt,id)
    sqlite.prepare('INSERT INTO operator_decisions (id,rundown_id,item_id,kind,payload,actor_username,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(),'@security',null,archive ? 'CHANNEL_ARCHIVED' : 'CHANNEL_REACTIVATED',installationVault().encrypt(JSON.stringify({channelId:id,historyPreserved:true,automaticTake:false}),'operator_decisions.payload'),actor,at)
    return {archived:archive,archivedAt,alreadyApplied:false}
  })()
}

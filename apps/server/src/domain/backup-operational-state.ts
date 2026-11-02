import type Database from 'better-sqlite3'
import {parseChannelCheckpoint} from './checkpoints.js'
export interface BackupOperationalState {
  savedCheckpoints:number;savedPlayingCheckpoints:number;publishedRevisions:number;
  savedHeldCheckpoints?:number;
  activeRevisions:number;asRunRecords:number;openAsRunRecords:number;
  executionResumeAllowed:false
}
/** Read-only inventory, not proof of a stopped engine or permission to TAKE. */
export function backupOperationalState(sqlite:Database.Database):BackupOperationalState {
  const has=(table:string)=>Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
  const state:BackupOperationalState={savedCheckpoints:0,savedPlayingCheckpoints:0,savedHeldCheckpoints:0,publishedRevisions:0,activeRevisions:0,asRunRecords:0,openAsRunRecords:0,executionResumeAllowed:false}
  if(has('channel_checkpoints'))for(const row of sqlite.prepare('SELECT channel_id,payload FROM channel_checkpoints').all() as {channel_id:string;payload:string}[]){
    const checkpoint=parseChannelCheckpoint(JSON.parse(row.payload),row.channel_id)
    state.savedCheckpoints++;if(checkpoint.playing)state.savedPlayingCheckpoints++
    if(checkpoint.programHold)state.savedHeldCheckpoints!++
  }
  if(has('operational_playlist_revisions')){
    state.publishedRevisions=Number((sqlite.prepare('SELECT count(*) n FROM operational_playlist_revisions').get() as {n:number}).n)
    state.activeRevisions=Number((sqlite.prepare('SELECT count(*) n FROM operational_playlist_revisions WHERE active=1').get() as {n:number}).n)
  }
  if(has('as_run')){
    state.asRunRecords=Number((sqlite.prepare('SELECT count(*) n FROM as_run').get() as {n:number}).n)
    state.openAsRunRecords=Number((sqlite.prepare('SELECT count(*) n FROM as_run WHERE ended_at IS NULL').get() as {n:number}).n)
  }
  return state
}

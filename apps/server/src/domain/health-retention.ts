import type Database from 'better-sqlite3'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'

/** Acknowledgement is not resolution: preserve unresolved PGM incidents even
 * after the operator acknowledges or the signal can no longer be observed. */
export function pruneHealthHistory(sqlite:Database.Database,days:number,now=Date.now()):number{
  if(!Number.isFinite(days)||days<=0||!Number.isFinite(now)||isRecoveryRehearsal(sqlite))return 0
  const cutoffTime=now-days*86400000
  if(!Number.isFinite(cutoffTime)||Math.abs(cutoffTime)>8640000000000000)return 0
  const cutoff=new Date(cutoffTime).toISOString()
  return sqlite.prepare(`DELETE FROM health_events WHERE occurred_at<? AND acknowledged_at<?
    AND (NOT((component='SIGNAL' AND id LIKE 'pgm-signal:%:active') OR id LIKE 'runtime-signal:%:active') OR resolved_at<?)`).run(cutoff,cutoff,cutoff).changes
}

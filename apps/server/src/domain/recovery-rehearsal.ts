import type Database from 'better-sqlite3'
import {readRestoredActivations} from '../db/restored-activations.js'
/** Presence is deliberately fail-closed, even for an incomplete provenance row.
 * Never remove this marker as a substitute for operational promotion proof. */
export function isRecoveryRehearsal(sqlite:Database.Database):boolean{
  if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ha_recovery_origin'").get())return true
  try{const latest=readRestoredActivations(sqlite).at(-1);return Boolean(latest&&latest.phase!=='CONFIRMED')}catch{return true}
}
export function rehearsalRequestAllowed(method:string,path:string):boolean{
  return ['GET','HEAD','OPTIONS'].includes(method)||['/api/auth/login','/api/auth/logout','/api/backups'].includes(path)&&method==='POST'
}

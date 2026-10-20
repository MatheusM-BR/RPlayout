import type Database from 'better-sqlite3'
import {readRestoredActivations,restoredActivationFingerprint} from '../db/restored-activations.js'
/** Presence is deliberately fail-closed, even for an incomplete provenance row.
 * Never remove this marker as a substitute for operational promotion proof. */
const decided=new WeakMap<object,{fingerprint:string;rehearsal:boolean}>()
/** Called on every request and signal observation: one fingerprint query when
 * nothing changed (creating ha_recovery_origin bumps schema_version, so the
 * marker is covered). Any change, or an absent fingerprint, reruns the full
 * fail-closed decision. */
export function isRecoveryRehearsal(sqlite:Database.Database):boolean{
  const fingerprint=restoredActivationFingerprint(sqlite)
  const cached=fingerprint?decided.get(sqlite):undefined
  if(cached&&cached.fingerprint===fingerprint)return cached.rehearsal
  const rehearsal=decideRecoveryRehearsal(sqlite)
  if(fingerprint)decided.set(sqlite,{fingerprint,rehearsal})
  else decided.delete(sqlite)
  return rehearsal
}
function decideRecoveryRehearsal(sqlite:Database.Database):boolean{
  if(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ha_recovery_origin'").get())return true
  try{const latest=readRestoredActivations(sqlite).at(-1);return Boolean(latest&&latest.phase!=='CONFIRMED')}catch{return true}
}
export function rehearsalRequestAllowed(method:string,path:string):boolean{
  return ['GET','HEAD','OPTIONS'].includes(method)||['/api/auth/login','/api/auth/logout','/api/backups'].includes(path)&&method==='POST'
}

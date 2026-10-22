import Database from 'better-sqlite3'
import {execFile} from 'node:child_process'
import {existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {readStorageAdmission} from '../db/storage-admission.js'
import {readRestoredActivations} from '../db/restored-activations.js'

export type StartupReservationCheck='NO_MANIFEST'|'OPEN'|'NOT_CONFIRMED'|'RECOVER'
/** An installation adopted through an upgrade keeps its activation's storage
 * reservation for the server's whole life. Power loss, a crash or closing the
 * console window then blocked every later start ("Banco reservado para
 * manutenção") until someone ran the offline recovery by hand. Only the case
 * the official recovery was built for is selected here: reservation held AND
 * the last restored activation already CONFIRMED. Anything else is left for
 * explicit review. */
export function startupReservationCheck(sqlite:Database.Database,manifest:string):StartupReservationCheck{
  if(!existsSync(manifest))return 'NO_MANIFEST'
  if(readStorageAdmission(sqlite)?.phase!=='MAINTENANCE')return 'OPEN'
  return readRestoredActivations(sqlite).at(-1)?.phase==='CONFIRMED'?'RECOVER':'NOT_CONFIRMED'
}
export interface StartupReservationResult {check:StartupReservationCheck;recovered:boolean;detail:string|null}
/** Runs the same packaged tool an operator would run (host fence, dead owner,
 * same host and provenance checks all stay in that tool). Never throws: a
 * refusal leaves the reservation and the normal start reports it. */
export async function recoverInterruptedReservationAtStartup(file:string,tool=join(dirname(resolve(process.argv[1]??'.')),'recover-restored-reservation.cjs')):Promise<StartupReservationResult>{
  const database=resolve(file),manifest=join(dirname(database),'restore-quarantine.json')
  if(!existsSync(database)||!existsSync(manifest))return {check:'NO_MANIFEST',recovered:false,detail:null}
  let check:StartupReservationCheck
  const sqlite=new Database(database,{readonly:true,fileMustExist:true})
  try{check=startupReservationCheck(sqlite,manifest)}catch(error){return {check:'NOT_CONFIRMED',recovered:false,detail:error instanceof Error?error.message:String(error)}}
  finally{sqlite.close()}
  if(check!=='RECOVER')return {check,recovered:false,detail:null}
  if(!existsSync(tool))return {check,recovered:false,detail:'Ferramenta de recuperação ausente no pacote.'}
  return await new Promise(done=>execFile(process.execPath,[tool,'--database',database,'--manifest',manifest],{env:process.env,windowsHide:true,timeout:120_000,maxBuffer:65536},(error,stdout,stderr)=>{
    if(error)return done({check,recovered:false,detail:String(stderr||error.message).trim().slice(0,300)})
    try{const result=JSON.parse(String(stdout)) as {stage?:string};done({check,recovered:result.stage==='RESERVATION_RELEASED_NOT_ACTIVATED',detail:result.stage??null})}
    catch{done({check,recovered:false,detail:'Resposta da recuperação ilegível.'})}
  }))
}

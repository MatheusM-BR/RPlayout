/** Test fixture only: a real independent builder pauses after durably claiming
 * CHECKING. The verifier kills this process, never an operator installation.
 * No engine, publisher, output or media write is opened by this helper. */
import Database from '../apps/server/node_modules/better-sqlite3/lib/index.js'
import {dirname,join,basename,relative,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {lstatSync} from 'node:fs'
import {HaRecovery,haRecoveryRequest} from '../apps/server/src/domain/ha-recovery.js'
import {installationVault} from '../apps/server/src/domain/secret-vault.js'
import type {HaSnapshot} from '../apps/server/src/domain/ha-replication.js'

const [file,requestId,channelId,counter]=process.argv.slice(2)
if(!file)throw new Error('Missing owned fixture mirror DB')
const absolute=resolve(file),parent=dirname(absolute),fixture=dirname(parent)
if(basename(absolute)!=='mirror.db'||basename(parent)!=='reserve'||!/^RPlayout-ha-replication-[a-z0-9]+$/i.test(relative(tmpdir(),fixture)))throw new Error('Helper only accepts its temporary replication fixture')
for(const path of [absolute,parent,fixture]){const entry=lstatSync(path);if(entry.isSymbolicLink())throw new Error('Fixture path must not be a link')}
const request=haRecoveryRequest.parse({requestId,channelId,sequence:Number(counter)})
const inspection=new Database(absolute,{readonly:true,fileMustExist:true})
let identity:unknown[]
try{identity=JSON.parse((inspection.prepare('SELECT identity FROM ha_identity WHERE id=1').get() as {identity:string}).identity)}finally{inspection.close()}
if(identity[0]!=='STANDBY'||identity[1]!=='fixture'||identity[2]!=='reserve'||identity[3]!=='primary')throw new Error('Fixture requires the dedicated reserve mirror DB')
const database=new Database(absolute,{fileMustExist:true})
database.pragma('journal_mode=WAL');database.pragma('synchronous=FULL')
const [,cluster,node]=identity
const current=()=>{
  const row=database.prepare('SELECT sequence,payload FROM ha_state WHERE id=1').get() as {sequence:number;payload:string}
  return {sequence:row.sequence,snapshot:JSON.parse(installationVault(false).decrypt(row.payload,`ha-mirror:v1:${cluster}:${node}`)) as HaSnapshot}
}
const recovery=new HaRecovery(database,join(dirname(file),'rehearsals'),current,async()=>{
  process.stdout.write(JSON.stringify({paused:true,pid:process.pid,requestId:request.requestId})+'\n')
  return new Promise<string|null>(()=>{})
},cluster+':'+node)
process.stdin.resume()
await recovery.rehearse(request)
throw new Error('Paused fixture unexpectedly completed')

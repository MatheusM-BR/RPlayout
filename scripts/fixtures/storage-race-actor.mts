import assert from 'node:assert/strict'
import {openProcessDatabase,databaseStorageStatus} from '../../apps/server/src/db/process-database.js'

// Own fixture actor, no HTTP server, account impersonation or operational data.
assert.ok(process.send);assert.equal(process.argv.length,4)
const actor=process.argv[3]!,db=openProcessDatabase(process.argv[2]!)
const status=databaseStorageStatus(db);let expected:number|null=null,closing=false
const alive=(pid:number)=>{try{process.kill(pid,0);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error}}
async function close(){
  if(closing)return;closing=true;db.close()
  const deadline=performance.now()+10000
  while(alive(status.storagePid)&&performance.now()<deadline)await new Promise(done=>setTimeout(done,25))
  assert.equal(alive(status.storagePid),false,'Own storage exit not confirmed; never kill a historical PID')
}
async function send(value:unknown){await new Promise<void>((done,fail)=>process.send!(value,error=>error?fail(error):done()))}
process.on('disconnect',()=>{void close().catch(()=>{process.exitCode=1})})
process.on('message',(input:unknown)=>{void (async()=>{
  const message=input as {id:number;op:string};assert.ok(Number.isSafeInteger(message.id))
  try{
    let value:unknown
    if(message.op==='read'){
      const row=db.prepare("SELECT revision FROM fixture_state WHERE id='shared'").get() as {revision:number}
      expected=row.revision;value={actor,expected}
    }else if(message.op==='commit'){
      assert.equal(expected,0,'Both actors must read the same pre-race revision')
      const changes=db.transaction(()=>{
        const changed=db.prepare('UPDATE fixture_state SET revision=revision+1,value=value+1 WHERE id=? AND revision=?').run('shared',expected).changes
        if(changed)db.prepare('INSERT INTO fixture_audit(actor,revision) VALUES(?,?)').run(actor,expected!+1)
        return changed
      }).immediate()
      value={actor,changes}
    }else if(message.op==='stop'){await close();value={actor,storageStopped:true}}
    else throw new Error('Unknown fixture actor command')
    await send({id:message.id,ok:true,value})
    if(message.op==='stop'&&process.connected)process.disconnect()
  }catch(error){await send({id:message.id,ok:false,error:String(error)})}
})().catch(error=>{console.error(error);void close().finally(()=>{process.exitCode=1;if(process.connected)process.disconnect()})})})
await send({ready:true,actor,pid:process.pid,storage:status})

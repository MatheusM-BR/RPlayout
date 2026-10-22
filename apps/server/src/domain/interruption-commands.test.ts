import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {Interruptions} from './interruptions.js'
import {InterruptionCommands} from './interruption-commands.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import type {ItemView} from './plan.js'

let f:ReturnType<typeof openDatabase>,commands:InterruptionCommands,items:Interruptions,id:string
const entry={item:{id:'vt',mediaId:'media',title:'VT'},asset:{id:'media',kind:'VIDEO',contentHash:'original'},trim:{in:50,out:300},audio:{mode:'OFF'},gainDb:0} as ItemView
beforeEach(()=>{
  f=openDatabase(':memory:');commands=new InterruptionCommands(f.db,f.sqlite);items=new Interruptions(f.sqlite)
  f.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
  id=items.record('ch','grade','revision',entry,143)!
})
afterEach(()=>{vi.restoreAllMocks();f.sqlite.close()})
const intent=()=>({channelId:'ch',interruptionId:id,action:'RESUME' as const,reviewToken:'a'.repeat(64)})
type Work=Parameters<InterruptionCommands['execute']>[6]
const execute=(work:Work,request='request',authorize=()=>{},action:'RESUME'|'DISCARD'='RESUME')=>commands.execute(request,{...intent(),action},'operator',null,authorize,()=>items.validateEntry('ch',id,'grade',entry),work)
const state=()=>f.sqlite.prepare('SELECT state FROM interrupted_items WHERE id=?').get(id) as {state:string}
const finish:Work=async lifecycle=>{lifecycle.validate();lifecycle.beforeTake();lifecycle.confirmed(true)}

describe('retorno durável sem repetição de TAKE desconhecido',()=>{
  it('confirma estado e journal juntos; pedido idêntico não executa de novo',async()=>{
    const work=vi.fn(finish)
    expect(await execute(work)).toMatchObject({run:{phase:'CONFIRMED',nativeProgramConfirmed:true,physicalOutputValidated:false},deduplicated:false})
    expect(state().state).toBe('RESUMED')
    expect(await execute(work)).toMatchObject({deduplicated:true,run:{phase:'CONFIRMED'}})
    expect(work).toHaveBeenCalledTimes(1)
    await expect(execute(work,'request',()=>{},'DISCARD')).rejects.toMatchObject({status:409})
  })
  it('descarte não chama engine e falha de auditoria reverte decisão inteira',async()=>{
    const work=vi.fn()
    f.sqlite.exec("CREATE TRIGGER qa_claim BEFORE INSERT ON operator_decisions WHEN NEW.kind='INTERRUPTION_COMMAND_SLOT' BEGIN SELECT RAISE(ABORT,'audit failed'); END")
    await expect(execute(work,'discard',()=>{},'DISCARD')).rejects.toThrow('audit failed')
    expect(state().state).toBe('PENDING');expect(f.db.select().from(operatorDecisions).all()).toHaveLength(0)
    f.sqlite.exec('DROP TRIGGER qa_claim')
    await execute(work,'discard',()=>{},'DISCARD');expect(state().state).toBe('DISCARDED');expect(work).not.toHaveBeenCalled()
  })
  it('erro anterior ao TAKE libera apenas preparação; erro após despacho nunca libera retorno',async()=>{
    expect(await execute(async()=>{throw new Error('preroll failed')})).toMatchObject({run:{phase:'FAILED'}})
    expect(state().state).toBe('PENDING');expect(commands.blockedReason('ch')).toBeNull()
    expect(await execute(async l=>{l.beforeTake();throw new Error('ACK perdido')},'next')).toMatchObject({run:{phase:'UNCERTAIN'}})
    expect(state().state).toBe('UNCERTAIN');expect(commands.blockedReason('ch')).not.toBeNull()
    expect(new InterruptionCommands(f.db,f.sqlite).blockedReason('ch')).not.toBeNull()
    await expect(execute(finish,'retry')).rejects.toMatchObject({status:409})
  })
  it('callback lento mantém posse; outro escritor e reconhecimento não podem tomar o canal',async()=>{
    let release!:()=>void,entered!:()=>void
    const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve)
    const first=execute(async l=>{l.beforeTake();entered();await waiting;l.confirmed(true)})
    await started
    expect(commands.canReconcile(id)).toBe(false)
    const other=new InterruptionCommands(f.db,f.sqlite)
    await expect(other.execute('other',intent(),'operator',null,()=>{},()=>{},finish)).rejects.toMatchObject({status:409})
    expect(()=>commands.acknowledge('ch',id,'request','admin',()=>{})).toThrow('ativos/desconhecidos')
    const duplicate=await execute(finish);expect(duplicate).toMatchObject({deduplicated:true,run:{phase:'SWITCHING'}})
    release();await first;expect(state().state).toBe('RESUMED')
  })
  it('reconfere autorização após preparação e conserva status da revogação',async()=>{
    let allowed=true
    const authorize=()=>{if(!allowed)throw new CollaborativeEditError(403,{error:'revoked'})}
    await expect(execute(async l=>{l.validate();allowed=false;l.beforeTake()},'request',authorize)).rejects.toMatchObject({status:403})
    expect(state().state).toBe('PENDING');expect(commands.current(id)?.phase).toBe('FAILED')
  })
  it('falha na confirmação atômica não produz RESUMED sem journal; encerramento não reabre cursor',async()=>{
    const result=await execute(async l=>{
      l.beforeTake()
      f.sqlite.exec("CREATE TRIGGER qa_finish BEFORE UPDATE ON operator_decisions BEGIN SELECT RAISE(ABORT,'finish failed'); END")
      l.confirmed(true)
    }).catch(error=>error)
    expect(result.message).toContain('finish failed');expect(state().state).toBe('RESUMING')
    expect(commands.current(id)?.phase).toBe('SWITCHING');expect(commands.blockedReason('ch')).not.toBeNull()
    f.sqlite.exec('DROP TRIGGER qa_finish')
    expect(()=>commands.acknowledge('ch',id,'wrong','admin',()=>{})).toThrow()
    expect(commands.acknowledge('ch',id,'request','admin',()=>{})).toMatchObject({closed:true,automaticTake:false,physicalOutputValidated:false})
    expect(state().state).toBe('CLOSED_UNCERTAIN');expect(items.list('ch')).toHaveLength(0)
    expect(await execute(finish)).toMatchObject({deduplicated:true,run:{phase:'CLOSED_UNCERTAIN'}})
  })
  it('limpeza de preview falha após confirmação: não desfaz nem anuncia retorno inconclusivo',async()=>{
    expect(await execute(async l=>{await finish(l);throw new Error('preview timeout')})).toMatchObject({run:{phase:'CONFIRMED',nativeProgramConfirmed:true,message:expect.stringContaining('limpeza')}})
    expect(state().state).toBe('RESUMED');expect(commands.blockedReason('ch')).toBeNull()
  })
  it.each(['remote','alive','unknown','engine-alive','gone'])('reconciliação conservadora de processo anterior: %s',async scenario=>{
    await execute(async l=>{l.beforeTake();throw new Error('unknown')})
    const row=f.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,'interruption-command:request')).get()!
    f.db.update(operatorDecisions).set({payload:{...row.payload,owner:{...(row.payload.owner as object),boot:'old-boot',pid:12345,enginePid:12346,...(scenario==='remote'?{host:'remote'}:{})}}}).where(eq(operatorDecisions.id,row.id)).run()
    vi.spyOn(process,'kill').mockImplementation(pid=>{if(scenario==='alive'||scenario==='engine-alive'&&pid===12346)return true;throw Object.assign(new Error('pid'),{code:scenario==='unknown'?'EPERM':'ESRCH'})})
    expect(new InterruptionCommands(f.db,f.sqlite).canReconcile(id)).toBe(scenario==='gone')
  })
  it('pendência antiga não desaparece sob limite dos últimos 50 retornos',async()=>{
    await execute(async l=>{l.beforeTake();throw new Error('unknown')})
    for(let n=0;n<55;n++)items.record('ch','grade','revision',entry,143)
    expect(items.list('ch')).toHaveLength(56);expect(items.list('ch').some(row=>row.id===id&&row.state==='UNCERTAIN')).toBe(true)
  })
})

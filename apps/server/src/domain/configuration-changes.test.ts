import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {ConfigurationChanges} from './configuration-changes.js'

let f:ReturnType<typeof openDatabase>,changes:ConfigurationChanges
beforeEach(()=>{f=openDatabase(':memory:');changes=new ConfigurationChanges(f.db)})
afterEach(()=>{vi.restoreAllMocks();f.sqlite.close()})
const slot=()=>f.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,'configuration-slot:ch')).get()!
const alter=(patch:Record<string,unknown>)=>f.db.update(operatorDecisions).set({payload:{...slot().payload,...patch}}).where(eq(operatorDecisions.id,'configuration-slot:ch')).run()
const execute=(work:Parameters<ConfigurationChanges['execute']>[4])=>changes.execute('ch',null,'editor','QA',work)

describe('cerca durável de configuração não expira e não é lease de HA',()=>{
  it('posse cobre o callback inteiro; outro escritor não rouba um processo lento',async()=>{
    let release!:()=>void,entered!:()=>void
    const started=new Promise<void>(resolve=>entered=resolve),waiting=new Promise<void>(resolve=>release=resolve)
    const work=execute(async lease=>{expect(changes.owns('ch')).toBe(true);entered();await waiting;f.db.transaction(tx=>lease.record(tx,'COMMITTED'));return 1})
    await started
    const other=new ConfigurationChanges(f.db)
    expect(other.status('ch')).toMatchObject({state:'APPLYING',reconcilable:false})
    await expect(other.execute('ch',null,null,'OTHER',async()=>{})).rejects.toMatchObject({status:409})
    expect(changes.status('ch').reconcilable).toBe(false)
    release();expect(await work).toBe(1);expect(changes.status('ch')).toMatchObject({state:'IDLE',runId:null,phase:null})
    await other.execute('ch',null,null,'OTHER',async()=>{})
    expect(f.db.select().from(operatorDecisions).all().filter(row=>row.kind==='CHANNEL_CONFIGURATION_OPERATION')).toHaveLength(2)
  })
  it('falha anterior a efeito nativo termina FAILED sem bloquear a próxima operação',async()=>{
    await expect(execute(async()=>{throw new Error('refused')})).rejects.toThrow('refused')
    expect(changes.status('ch').state).toBe('IDLE')
    expect(f.db.select().from(operatorDecisions).all().find(row=>row.kind==='CHANNEL_CONFIGURATION_OPERATION')!.payload.state).toBe('FAILED')
    await execute(async()=>{})
  })
  it('efeito sem confirmação permanece UNCERTAIN, não recupera nem reenvia automaticamente',async()=>{
    await execute(async lease=>{
      f.db.transaction(tx=>lease.record(tx,'HOT_DISPATCHED',{target:'srt://host:1?passphrase=PRIVATE_OUTPUT'}))
      expect(changes.canRecover('ch')).toBe(false)
      lease.markUncertain('falha srt://host:1?passphrase=PRIVATE_OUTPUT')
    })
    expect(changes.status('ch')).toMatchObject({state:'UNCERTAIN',reconcilable:true})
    expect(JSON.stringify(changes.status('ch'))).not.toContain('PRIVATE_OUTPUT')
    expect(changes.canRecover('ch')).toBe(false)
    await expect(execute(async()=>{})).rejects.toMatchObject({status:409})
    const restarted=new ConfigurationChanges(f.db)
    expect(restarted.status('ch')).toMatchObject({state:'UNCERTAIN',reconcilable:false})
  })
  it('reconciliação exige identificador exato e autorização atual; encerra a incerteza sem replay',async()=>{
    await execute(async lease=>lease.markUncertain('sem ACK'))
    const runId=changes.status('ch').runId!,authorize=vi.fn()
    await expect(changes.execute('ch',null,null,'RECONCILE',async()=>{}, {runId:'bad',authorize})).rejects.toMatchObject({status:409})
    await expect(changes.execute('ch',null,null,'RECONCILE',async()=>{}, {runId,authorize:()=>{throw new Error('revoked')}})).rejects.toThrow('revoked')
    expect(changes.status('ch').state).toBe('UNCERTAIN')
    await changes.execute('ch',null,'admin','RECONCILE',async lease=>{expect(changes.canRecover('ch')).toBe(false);f.db.transaction(tx=>lease.record(tx,'RECONCILED',{automaticTake:false}))},{runId,authorize})
    expect(changes.status('ch').state).toBe('IDLE')
    const old=f.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,`configuration-run:${runId}`)).get()!
    expect(old.payload).toMatchObject({state:'CLOSED_UNCERTAIN',acknowledgedBy:'admin'})
  })
  it('falha ao persistir incerteza mantém APPLYING bloqueado em vez de liberar efeito desconhecido',async()=>{
    f.sqlite.exec("CREATE TRIGGER qa_uncertain BEFORE UPDATE ON operator_decisions WHEN NEW.kind='CHANNEL_CONFIGURATION_SLOT' AND NEW.payload!=OLD.payload BEGIN SELECT RAISE(ABORT,'QA durable failure'); END")
    await expect(execute(async lease=>lease.markUncertain('unknown'))).rejects.toThrow('QA durable failure')
    expect(changes.status('ch')).toMatchObject({state:'APPLYING',reconcilable:true})
    await expect(execute(async()=>{})).rejects.toMatchObject({status:409})
  })
  it('falha no journal não deixa um slot órfão criado parcialmente',async()=>{
    f.sqlite.exec("CREATE TRIGGER qa_claim BEFORE INSERT ON operator_decisions WHEN NEW.kind='CHANNEL_CONFIGURATION_OPERATION' BEGIN SELECT RAISE(ABORT,'QA claim failure'); END")
    await expect(execute(async()=>{})).rejects.toThrow('QA claim failure')
    expect(slot()).toBeUndefined();expect(changes.status('ch').state).toBe('IDLE')
  })
  it('falha na conclusão permanece cercada e não é anunciada como IDLE',async()=>{
    await expect(execute(async()=>{f.sqlite.exec("CREATE TRIGGER qa_finish BEFORE UPDATE ON operator_decisions WHEN NEW.kind='CHANNEL_CONFIGURATION_SLOT' BEGIN SELECT RAISE(ABORT,'QA finish failure'); END")})).rejects.toThrow('QA finish failure')
    expect(changes.status('ch').state).toBe('APPLYING')
  })
  it.each(['remote','alive','unknown','engine-alive','gone'])('prova conservadora de processos anteriores: %s',async scenario=>{
    await execute(async lease=>lease.markUncertain('unknown'))
    const owner=slot().payload.owner as Record<string,unknown>
    alter({owner:{...owner,boot:'00000000-0000-4000-8000-000000000001',pid:12345,enginePids:[12346],...(scenario==='remote'?{host:'remote'}:{})}})
    vi.spyOn(process,'kill').mockImplementation(pid=>{
      if(scenario==='alive' || scenario==='engine-alive' && pid===12346)return true
      throw Object.assign(new Error('pid'),{code:scenario==='unknown'?'EPERM':'ESRCH'})
    })
    expect(new ConfigurationChanges(f.db).status('ch').reconcilable).toBe(scenario==='gone')
  })
  it('registra engines reconstruídos e recusa escrita após perda de posse',async()=>{
    await expect(execute(async lease=>{
      changes.trackEngine('ch',12345);changes.trackEngine('ch',12345)
      expect((slot().payload.owner as {enginePids:number[]}).enginePids).toEqual([12345])
      alter({runId:'00000000-0000-4000-8000-000000000002'})
      f.db.transaction(tx=>lease.record(tx,'COMMITTED'))
    })).rejects.toMatchObject({status:409})
    expect(changes.status('ch').state).toBe('APPLYING')
  })
  it('registro malformado falha fechado sem iniciar alteração',async()=>{
    await execute(async()=>{});alter({owner:null})
    expect(()=>changes.status('ch')).toThrow('Registro de configuração inválido')
    await expect(execute(async()=>{})).rejects.toMatchObject({status:409})
  })
})

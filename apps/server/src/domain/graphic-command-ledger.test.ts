import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'
import {EngineCommandRejected} from './engine.js'
import {operatorDecisions,healthEvents,secondaryEventRuns} from '../db/schema.js'
import {SecondaryEventLedger,SecondaryEventUncertain} from './secondary-event-ledger.js'
let db:ReturnType<typeof openDatabase>,ledger:GraphicCommandLedger
const input={key:'original-key',actorId:'user',actorName:'Operador Çãó',selection:{action:'SHOW',values:{title:'PRIVATE_GRAPHIC_FIELD'}},native:true}
beforeEach(()=>{db=openDatabase(':memory:');db.sqlite.prepare('INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES(?,?,320,180,25,1,-23,-1,5,?)').run('a','A','now');ledger=new GraphicCommandLedger(db.db,'a')})
afterEach(()=>db.sqlite.close())
const secondary={id:'secondary',rundownItemId:'item',targetLayer:'LOWER_THIRD' as const,triggerMode:'OFFSET_FROM_START' as const,offsetFrames:0,templateId:'',payload:{},enabled:true,type:'GRAPHICS_OVERLAY' as const}
const secondaryContext={executionId:'execution',itemId:'item',revisionId:'revision',frames:0}
it('mudança de ocorrência na fila recusa grafismo antes do efeito externo',async()=>{
  let context={executionId:'execution',revisionId:'revision',itemId:'item'}
  const effect=vi.fn()
  await expect(ledger.execute({...input,context:()=>context},()=>{},async send=>{
    context={...context,itemId:'next'};send();effect()
  })).rejects.toMatchObject({status:409})
  expect(effect).not.toHaveBeenCalled()
  expect(ledger.list()[0]?.state).toBe('REJECTED')
})
it('troca de PGM após envio preserva resultado incerto e não confirma outra ocorrência',async()=>{
  let context={executionId:'execution',revisionId:'revision',itemId:'item'}
  await expect(ledger.execute({...input,context:()=>context},()=>{},async send=>{
    send();context={...context,executionId:'new-execution'}
  })).rejects.toMatchObject({status:409})
  const command=ledger.list()[0]!
  expect(command.state).toBe('UNCERTAIN')
  expect(ledger.confirmedContext(command.id)).toBeNull()
  expect(ledger.hasUnresolved()).toBe(true)
})
it('FIRING antigo bloqueia novo comando sem registro otimista nem envio; outro canal não bloqueia',async()=>{
  db.db.insert(secondaryEventRuns).values({id:'old',channelId:'other',...secondaryContext,eventId:secondary.id,mode:'FIRE',state:'FIRING',createdAt:'now'}).run()
  expect(ledger.hasUnresolved()).toBe(false)
  db.db.insert(secondaryEventRuns).values({id:'ours',channelId:'a',...secondaryContext,executionId:'ours',eventId:secondary.id,mode:'FIRE',state:'FIRING',createdAt:'now'}).run()
  expect(ledger.hasUnresolved()).toBe(true)
  const work=vi.fn()
  await expect(ledger.execute(input,()=>{},work)).rejects.toMatchObject({status:409})
  expect(work).not.toHaveBeenCalled();expect(ledger.list()).toEqual([])
})
it('evento local em curso não bloqueia o próprio ledger gráfico, mas incerteza passa a bloquear depois',async()=>{
  const secondaryLedger=new SecondaryEventLedger(db.db,'a')
  await secondaryLedger.execute(secondaryContext,secondary,'FIRE',async()=>{
    expect(ledger.hasUnresolved()).toBe(false)
    await ledger.execute(input,()=>{},async send=>{send()})
    throw new SecondaryEventUncertain('completion unknown')
  })
  expect(ledger.list()[0]?.state).toBe('CONFIRMED')
  expect(ledger.hasUnresolved()).toBe(true)
  const work=vi.fn()
  await expect(ledger.execute({...input,key:'new-graphic-key'},()=>{},work)).rejects.toMatchObject({status:409})
  expect(work).not.toHaveBeenCalled()
})
it('pendência surgida enquanto espera a fila impede SENDING e o efeito externo',async()=>{
  const effect=vi.fn()
  await expect(ledger.execute(input,()=>{},async send=>{
    db.db.insert(secondaryEventRuns).values({id:'late',channelId:'a',...secondaryContext,eventId:secondary.id,mode:'FIRE',state:'FIRING',createdAt:'now'}).run()
    send();effect()
  })).rejects.toMatchObject({status:409})
  expect(effect).not.toHaveBeenCalled();expect(ledger.list()[0]?.state).toBe('REJECTED')
  expect(db.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE kind='GRAPHIC_COMMAND_SENDING'").get()).toEqual({n:0})
})
it('pedido e envio são duráveis antes do trabalho; confirmado só depois da resposta',async()=>{
  const work=vi.fn(async(send:()=>void)=>{expect(ledger.list()[0]!.state).toBe('ACCEPTED');send();expect(ledger.list()[0]!.state).toBe('SENDING');return 'applied'})
  const result=await ledger.execute(input,()=>{},work)
  expect(result).toMatchObject({result:'applied',receipt:{state:'CONFIRMED',replayed:false,physicalOutputValidated:false}})
  expect(db.sqlite.prepare('SELECT payload FROM operator_decisions').all().every(row=>!JSON.stringify(row).includes('PRIVATE_GRAPHIC_FIELD'))).toBe(true)
  const repeat=await ledger.execute(input,()=>{},work);expect(repeat.receipt.replayed).toBe(true);expect(work).toHaveBeenCalledTimes(1)
  await expect(ledger.execute({...input,selection:{action:'HIDE'}},()=>{},work)).rejects.toMatchObject({status:409})
})
it('falha em aceitar/auditar impede qualquer envio',async()=>{
  db.sqlite.exec("CREATE TRIGGER accepted_failure BEFORE INSERT ON operator_decisions BEGIN SELECT RAISE(ABORT,'STORAGE_FAILED'); END")
  const work=vi.fn();await expect(ledger.execute(input,()=>{},work)).rejects.toThrow('STORAGE_FAILED')
  expect(work).not.toHaveBeenCalled()
})
it('timeout é incerto, bloqueia repetição e outra chave; conferência não é recuperação',async()=>{
  const work=vi.fn(async(send:()=>void)=>{send();throw new Error('ACK_TIMEOUT')})
  await expect(ledger.execute(input,()=>{},work)).rejects.toMatchObject({payload:{graphicCommand:{state:'UNCERTAIN'}}})
  await expect(ledger.execute(input,()=>{},work)).rejects.toMatchObject({status:409})
  await expect(ledger.execute({...input,key:'new-key-1'},()=>{},work)).rejects.toMatchObject({status:409})
  expect(work).toHaveBeenCalledTimes(1);expect(db.db.select().from(healthEvents).all()).toHaveLength(1)
  const receipt=ledger.list()[0]!
  expect(()=>ledger.review(receipt.id,'stale','checked','admin',()=>{})).toThrow()
  expect(ledger.review(receipt.id,receipt.reviewToken,'Imagem conferida; não reenviar','admin',()=>{}).state).toBe('REVIEWED')
  const reviewed=db.db.select().from(operatorDecisions).all().find(row=>row.kind==='GRAPHIC_COMMAND_REVIEWED')!
  expect(reviewed.payload.signalRecovered).toBe(false)
  const next=await ledger.execute({...input,key:'new-key-2'},()=>{},async send=>{send()});expect(next.receipt.state).toBe('CONFIRMED')
})
it('recusa nativa e autorização revogada antes de enviar são rejeições, não confirmação',async()=>{
  await expect(ledger.execute(input,()=>{},async send=>{send();throw new EngineCommandRejected('NATIVE_REJECTED')})).rejects.toMatchObject({payload:{graphicCommand:{state:'REJECTED'}}})
  const work=vi.fn();await expect(ledger.execute({...input,key:'different-key'},()=>{throw new Error('REVOKED')},work)).rejects.toThrow('REVOKED')
  expect(work).not.toHaveBeenCalled();expect(db.db.select().from(healthEvents).all()).toEqual([])
})
it('processamento em curso impede conferência e segundo comando concorrente',async()=>{
  let finish!:()=>void
  const active=ledger.execute(input,()=>{},async send=>{send();await new Promise<void>(resolve=>{finish=resolve})})
  await vi.waitFor(()=>expect(ledger.list()[0]!.state).toBe('SENDING'))
  const receipt=ledger.list()[0]!
  expect(()=>ledger.review(receipt.id,receipt.reviewToken,'checked','admin',()=>{})).toThrow()
  await expect(ledger.execute({...input,key:'second-key'},()=>{},async()=>{})).rejects.toMatchObject({status:409})
  finish();await active
})
it('falha após ACK conserva SENDING protegido; outro recorder não reenvia',async()=>{
  db.sqlite.exec("CREATE TRIGGER completion_failure BEFORE INSERT ON operator_decisions WHEN NEW.kind IN ('GRAPHIC_COMMAND_CONFIRMED','GRAPHIC_COMMAND_UNCERTAIN') BEGIN SELECT RAISE(ABORT,'COMPLETION_STORAGE_FAILED'); END")
  await expect(ledger.execute(input,()=>{},async send=>{send()})).rejects.toMatchObject({payload:{graphicCommand:{state:'UNCERTAIN'}}})
  const restored=new GraphicCommandLedger(db.db,'a'),work=vi.fn()
  expect(restored.list()[0]!.state).toBe('SENDING')
  await expect(restored.execute(input,()=>{},work)).rejects.toMatchObject({status:409});expect(work).not.toHaveBeenCalled()
})

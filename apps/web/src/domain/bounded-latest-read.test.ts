import {afterEach,expect,it,vi} from 'vitest'
import {BoundedLatestRead,incidentHistoryWindow} from './bounded-latest-read.js'
afterEach(()=>vi.useRealTimers())
it('read encerra no prazo mesmo quando o transporte ignora abort; resposta tardia não publica valor',async()=>{
  vi.useFakeTimers();const reads=new BoundedLatestRead(),controller=new AbortController()
  let late!:(value:string)=>void
  const outcome=reads.read(()=>new Promise<string>(resolve=>{late=resolve}),'Consulta indisponível')
  const rejected=expect(outcome).rejects.toThrow('Consulta indisponível')
  await vi.advanceTimersByTimeAsync(10000);await rejected
  late('resposta antiga');await Promise.resolve()
  expect(controller.signal.aborted).toBe(false) // Mutations are never coupled.
  expect(vi.getTimerCount()).toBe(0)
  expect(await reads.read(async()=> 'nova','prazo')).toEqual({current:true,value:'nova'})
})
it('read nova cancela anterior sem erro visível e sem aceitar sucesso atrasado',async()=>{
  vi.useFakeTimers();const reads=new BoundedLatestRead();let late!:(value:string)=>void
  const old=reads.read(()=>new Promise<string>(resolve=>{late=resolve}),'prazo')
  const fresh=reads.read(async()=> 'novo','prazo')
  expect(await old).toEqual({current:false});expect(await fresh).toEqual({current:true,value:'novo'})
  late('antigo');await Promise.resolve();expect(vi.getTimerCount()).toBe(0)
})
it('read cancelada ao fechar não exige resposta do transporte nem informa erro tardio',async()=>{
  vi.useFakeTimers();const reads=new BoundedLatestRead(),outcome=reads.read(()=>new Promise<never>(()=>{}),'prazo')
  reads.cancel();expect(await outcome).toEqual({current:false});expect(vi.getTimerCount()).toBe(0)
})
it('read de polling não sobrepõe nem aborta leitura ativa; erro real continua explícito',async()=>{
  vi.useFakeTimers();const reads=new BoundedLatestRead(),work=vi.fn(async()=> 'não executar')
  const active=reads.read(()=>new Promise<never>(()=>{}),'prazo')
  expect(await reads.read(work,'prazo',false)).toEqual({current:false});expect(work).not.toHaveBeenCalled()
  reads.cancel();expect(await active).toEqual({current:false})
  await expect(reads.read(async()=>{throw new Error('Falha de rede')},'prazo')).rejects.toThrow('Falha de rede')
  expect(vi.getTimerCount()).toBe(0)
})
it('falha de um GET drena o GET irmão com o mesmo signal sem publicar resultado parcial',async()=>{
  vi.useFakeTimers();const reads=new BoundedLatestRead();let siblingAborted=false
  await expect(reads.read(signal=>Promise.all([
    Promise.reject(new Error('Catálogo indisponível')),
    new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>{siblingAborted=true;reject(new DOMException('Cancelado','AbortError'))},{once:true}))
  ]),'prazo')).rejects.toThrow('Catálogo indisponível')
  expect(siblingAborted).toBe(true);expect(vi.getTimerCount()).toBe(0)
})
it('poll não sobrepõe leitura ativa nem cancela uma consulta manual',()=>{
  vi.useFakeTimers();const reads=new BoundedLatestRead(),first=reads.start()!
  expect(reads.start(false)).toBeNull();expect(first.signal.aborted).toBe(false)
  first.finish();expect(reads.start(false)).not.toBeNull();reads.cancel();expect(vi.getTimerCount()).toBe(0)
})
it('filtro novo cancela a leitura anterior e resultado antigo não é atual',()=>{
  vi.useFakeTimers();const reads=new BoundedLatestRead(),old=reads.start()!,fresh=reads.start()!
  expect(old.signal.aborted).toBe(true);expect(old.isCurrent()).toBe(false);expect(fresh.isCurrent()).toBe(true)
  old.finish();expect(fresh.isCurrent()).toBe(true);expect(vi.getTimerCount()).toBe(1)
  fresh.finish();expect(vi.getTimerCount()).toBe(0)
})
it('prazo10s aborta a leitura, conserva diagnóstico de timeout e permite retry',()=>{
  vi.useFakeTimers();const reads=new BoundedLatestRead(),read=reads.start()!
  vi.advanceTimersByTime(9999);expect(read.signal.aborted).toBe(false)
  vi.advanceTimersByTime(1);expect(read.signal.aborted).toBe(true);expect(read.timedOut()).toBe(true)
  read.finish();const retry=reads.start(false)!;expect(retry.signal.aborted).toBe(false);reads.cancel()
})
it('fechamento cancela grupo e remove timer sem cancelar requisição de mutação',()=>{
  vi.useFakeTimers();const writes=new AbortController(),reads=new BoundedLatestRead(),read=reads.start()!
  reads.cancel();expect(read.signal.aborted).toBe(true);expect(read.timedOut()).toBe(false);expect(read.isCurrent()).toBe(false)
  expect(writes.signal.aborted).toBe(false);expect(vi.getTimerCount()).toBe(0)
})
it('voltar ao início histórico mantém âncora; somente reset explícito retoma janela atual',()=>{
  const until='2026-10-10T00:00:00.000Z',cursor={until,beforeAt:until,beforeId:'older'}
  expect(incidentHistoryWindow(until,cursor)).toBe(cursor)
  expect(incidentHistoryWindow(until)).toEqual({until})
  expect(incidentHistoryWindow(null)).toBeUndefined()
})

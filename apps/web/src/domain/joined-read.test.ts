import {afterEach,it,expect,vi} from 'vitest'
import {JoinedRead} from './joined-read.js'
import {SupersededContextError} from './client-context.js'
afterEach(()=>vi.useRealTimers())
it('mesmo contexto compartilha rede e publica só uma vez',async()=>{
  const reads=new JoinedRead<number>();let finish!:(value:number)=>void
  const load=vi.fn(()=>new Promise<number>(resolve=>{finish=resolve})),commit=vi.fn((value:number)=>value)
  const first=reads.run('session1:channelA',load,commit,'prazo'),second=reads.run('session1:channelA',load,commit,'prazo')
  expect(second).toBe(first);finish(7);expect(await first).toBe(7);expect(await second).toBe(7)
  expect(load).toHaveBeenCalledOnce();expect(commit).toHaveBeenCalledOnce()
})
it('troca de contexto aborta anterior e retorno tardio não publica nem limpa leitura nova',async()=>{
  const reads=new JoinedRead<string>();let oldFinish!:(value:string)=>void
  const oldCommit=vi.fn((value:string)=>value)
  const old=reads.run('old',()=>new Promise<string>(resolve=>{oldFinish=resolve}),oldCommit,'prazo')
  const rejected=expect(old).rejects.toBeInstanceOf(SupersededContextError)
  const fresh=reads.run('new',async()=> 'novo',value=>value,'prazo')
  await rejected;expect(await fresh).toBe('novo');oldFinish('privado antigo');await Promise.resolve();expect(oldCommit).not.toHaveBeenCalled()
})
it('prazo único libera todos os leitores, não publica parcial e permite nova consulta',async()=>{
  vi.useFakeTimers();const reads=new JoinedRead<string>(),commit=vi.fn((value:string)=>value)
  const pending=reads.run('context',()=>new Promise<string>(()=>{}),commit,'acervo demorou')
  const joined=reads.run('context',async()=> 'não executar',commit,'outro')
  expect(joined).toBe(pending);const rejected=expect(pending).rejects.toThrow('acervo demorou')
  await vi.advanceTimersByTimeAsync(10000);await rejected;expect(commit).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0)
  expect(await reads.run('context',async()=> 'válido',value=>value,'prazo')).toBe('válido')
})
it('cancelar sessão/fechamento não aguarda servidor e nunca cancela mutação',async()=>{
  const writes=new AbortController(),reads=new JoinedRead<number>(),commit=vi.fn((value:number)=>value)
  const pending=reads.run('old',()=>new Promise<number>(()=>{}),commit,'prazo'),rejected=expect(pending).rejects.toBeInstanceOf(SupersededContextError)
  reads.cancel();await rejected;expect(writes.signal.aborted).toBe(false);expect(commit).not.toHaveBeenCalled()
})

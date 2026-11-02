import {expect,it,vi} from 'vitest'
import {BackgroundTaskGuard} from './background-task-guard.js'

it('consome falhas síncronas/assíncronas e nunca repete o trabalho da chamada',async()=>{
  const errors:unknown[]=[],unavailable=vi.fn(),guard=new BackgroundTaskGuard(()=>true,unavailable,(name,error)=>{errors.push([name,error])})
  const sync=vi.fn(()=>{throw new Error('sync')}),asyncWork=vi.fn(async()=>{throw new Error('async')})
  await expect(guard.run('sync',sync)).resolves.toBeUndefined();await expect(guard.run('async',asyncWork)).resolves.toBeUndefined()
  expect(sync).toHaveBeenCalledOnce();expect(asyncWork).toHaveBeenCalledOnce();expect(errors).toHaveLength(2);expect(unavailable).not.toHaveBeenCalled()
})
it('suspende a geração perdida, notifica uma vez e não retoma por mudança posterior do getter',async()=>{
  let connected=false;const unavailable=vi.fn(),work=vi.fn(),guard=new BackgroundTaskGuard(()=>connected,unavailable,vi.fn())
  await guard.run('first',work);connected=true;await guard.run('later',work)
  expect(work).not.toHaveBeenCalled();expect(unavailable).toHaveBeenCalledOnce();expect(guard.status().suspended).toBe(true)
})
it('captura falha do guard de admissão antes de entrar no corpo',async()=>{
  let connected=true;const work=vi.fn(),unavailable=vi.fn(),errors=vi.fn(),guard=new BackgroundTaskGuard(()=>connected,unavailable,errors)
  await guard.run('admission',work,()=>{connected=false;throw new Error('admission failed')})
  expect(work).not.toHaveBeenCalled();expect(unavailable).toHaveBeenCalledOnce();expect(errors).toHaveBeenCalledOnce()
})
it('detecta conexão perdida mesmo quando o domínio absorveu o próprio erro',async()=>{
  let connected=true;const unavailable=vi.fn(),guard=new BackgroundTaskGuard(()=>connected,unavailable,vi.fn())
  await guard.run('domain',()=>{connected=false});expect(unavailable).toHaveBeenCalledOnce();expect(guard.status().suspended).toBe(true)
})
it('não executa tarefa desautorizada e permite outro ciclo saudável sem replay oculto',async()=>{
  const work=vi.fn(),guard=new BackgroundTaskGuard(()=>true,vi.fn(),vi.fn())
  await guard.run('disabled',work,()=>false);expect(work).not.toHaveBeenCalled()
  await guard.run('enabled',work);expect(work).toHaveBeenCalledOnce()
})
it('falha de diagnóstico e de notificação não produz rejeição escapando do guard',async()=>{
  const fallback=vi.spyOn(console,'error').mockImplementation(()=>{})
  try{
    const guard=new BackgroundTaskGuard(()=>false,async()=>{throw new Error('notification')},async()=>{throw new Error('logger')})
    await expect(guard.run('lost',()=>{})).resolves.toBeUndefined();expect(fallback).toHaveBeenCalledOnce()
  }finally{fallback.mockRestore()}
})
it('close impede nova admissão mas não finge cancelar/voltar um efeito já iniciado',async()=>{
  let done!:()=>void;const work=vi.fn(),guard=new BackgroundTaskGuard(()=>true,vi.fn(),vi.fn())
  const pending=guard.run('active',()=>new Promise<void>(resolve=>{done=resolve}))
  guard.close();await guard.run('new',work);expect(work).not.toHaveBeenCalled();done();await pending;expect(guard.status().closed).toBe(true)
})
it('conexão com estado inconclusivo também falha fechada sem chamar o corpo',async()=>{
  const work=vi.fn(),unavailable=vi.fn(),guard=new BackgroundTaskGuard(()=>{throw new Error('status unavailable')},unavailable,vi.fn())
  await guard.run('status',work);expect(work).not.toHaveBeenCalled();expect(unavailable).toHaveBeenCalledOnce()
})

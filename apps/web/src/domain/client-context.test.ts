import {describe,expect,it,vi} from 'vitest'
import {ClientContext,ContextCommandQueue} from './client-context.js'
describe('contexto de operação do navegador',()=>{
  it('rejeita proveniência desconhecida e invalida objetos aninhados na troca',()=>{
    const scope=new ClientContext(),ticket=scope.capture(),value={snapshot:{live:{}}}
    expect(scope.accepts(value)).toBe(false)
    scope.mark(value,ticket)
    expect(scope.accepts(value.snapshot.live)).toBe(true)
    scope.nextView();expect(scope.accepts(value)).toBe(false)
    scope.nextView();expect(scope.accepts(value.snapshot)).toBe(false)
    expect(scope.sessionCurrent(ticket)).toBe(true)
    scope.nextSession();expect(scope.sessionCurrent(ticket)).toBe(false)
  })
  it('ordena CUE/TAKE no mesmo contexto sem duplicar comandos',async()=>{
    const scope=new ClientContext(),queue=new ContextCommandQueue(scope),calls:string[]=[]
    let release!:()=>void
    const cue=queue.enqueue(async()=>{calls.push('CUE');await new Promise<void>(resolve=>{release=resolve})})
    const take=queue.enqueue(async()=>{calls.push('TAKE')})
    await vi.waitFor(()=>expect(calls).toEqual(['CUE']))
    release();await Promise.all([cue,take]);expect(calls).toEqual(['CUE','TAKE'])
  })
  it.each(['view','session'] as const)('não envia TAKE antigo após trocar %s; fila nova não espera pedido antigo',async(kind)=>{
    const scope=new ClientContext(),queue=new ContextCommandQueue(scope),calls:string[]=[]
    let release!:()=>void
    const cue=queue.enqueue(async()=>{calls.push('CUE já enviado');await new Promise<void>(resolve=>{release=resolve})})
    const take=queue.enqueue(async()=>{calls.push('TAKE antigo')})
    await vi.waitFor(()=>expect(calls).toEqual(['CUE já enviado']))
    if(kind==='view')scope.nextView();else scope.nextSession()
    await queue.enqueue(async()=>{calls.push('CUE atual')})
    expect(calls).toEqual(['CUE já enviado','CUE atual'])
    release();await Promise.all([cue,take]);expect(calls).not.toContain('TAKE antigo')
  })
  it('falha atual não envenena a fila nem produz repetição automática',async()=>{
    const scope=new ClientContext(),queue=new ContextCommandQueue(scope),first=vi.fn(async()=>{throw new Error('recusado')}),second=vi.fn(async()=>{})
    const failed=queue.enqueue(first),next=queue.enqueue(second)
    await expect(failed).rejects.toThrow('recusado');await next
    expect(first).toHaveBeenCalledOnce();expect(second).toHaveBeenCalledOnce()
  })
})

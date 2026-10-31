import {describe,expect,it,vi} from 'vitest'
import {ClientContext,SupersededContextError} from './client-context.js'
import {requestResult} from './json-request.js'

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})
describe('fronteira HTTP da sessão e seleção',()=>{
  it('preserva headers/signal, marca todo snapshot e devolve JSON atual',async()=>{
    const scope=new ClientContext(),fetcher=vi.fn<typeof fetch>(async()=>json({snapshot:{live:{channelId:'ch'}}})),signal=new AbortController().signal
    const result=await requestResult<{snapshot:{live:object}}>('/api/test',{method:'POST',body:'{}',headers:{'x-test':'qa'},signal},{context:scope,fetcher})
    expect(scope.accepts(result.body.snapshot.live)).toBe(true)
    const init=fetcher.mock.calls[0]![1]!
    expect(new Headers(init.headers).get('x-test')).toBe('qa');expect(new Headers(init.headers).get('content-type')).toBe('application/json');expect(init.signal).toBe(signal)
  })
  it('401 atrasado da sessão anterior não revoga a sessão nova',async()=>{
    const scope=new ClientContext(),unauthorized=vi.fn();let release!:(response:Response)=>void
    const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{release=resolve}))
    const pending=requestResult('/api/test',undefined,{context:scope,fetcher,unauthorized})
    scope.nextSession();release(json({error:'PRIVATE_OLD_SESSION'},401))
    await expect(pending).rejects.toBeInstanceOf(SupersededContextError)
    expect(unauthorized).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce()
  })
  it('verifica contexto após ler corpo lento, não apenas após receber headers',async()=>{
    const scope=new ClientContext(),unauthorized=vi.fn();let release!:(body:unknown)=>void
    const response={status:401,ok:false,json:vi.fn(()=>new Promise(resolve=>{release=resolve}))} as unknown as Response
    const pending=requestResult('/api/test',undefined,{context:scope,fetcher:vi.fn(async()=>response),unauthorized})
    await vi.waitFor(()=>expect(response.json).toHaveBeenCalled())
    scope.nextSession();release({error:'PRIVATE_OLD_BODY'})
    await expect(pending).rejects.toBeInstanceOf(SupersededContextError);expect(unauthorized).not.toHaveBeenCalled()
  })
  it('401 da sessão atual notifica revogação, sem exibir corpo depois da mudança',async()=>{
    const scope=new ClientContext(),unauthorized=vi.fn(()=>scope.nextSession())
    await expect(requestResult('/api/test',undefined,{context:scope,fetcher:vi.fn(async()=>json({error:'PRIVATE_BODY'},401)),unauthorized})).rejects.toBeInstanceOf(SupersededContextError)
    expect(unauthorized).toHaveBeenCalledOnce()
  })
  it.each(['GET','POST'])('resposta após mudança de canal não atualiza estado; %s não é repetido',async(method)=>{
    const scope=new ClientContext();let release!:(response:Response)=>void
    const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{release=resolve}))
    const pending=requestResult('/api/test',{method},{context:scope,fetcher})
    scope.nextView();release(json({oldProgram:'PRIVATE_OLD_PROGRAM'}))
    try{await pending;throw new Error('resposta antiga aceita')}catch(error){
      expect(error).toBeInstanceOf(SupersededContextError)
      expect((error as SupersededContextError).mayHaveExecuted).toBe(method==='POST')
      expect((error as Error).message).not.toContain('PRIVATE_')
    }
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('erro de rede antigo não propaga diagnóstico privado à nova conta',async()=>{
    const scope=new ClientContext();let reject!:(error:Error)=>void
    const pending=requestResult('/api/test',undefined,{context:scope,fetcher:vi.fn(()=>new Promise<Response>((_resolve,rejectRequest)=>{reject=rejectRequest}))})
    scope.nextSession();reject(new Error('PRIVATE_OLD_NETWORK'))
    await expect(pending).rejects.toThrow('contexto mudou')
  })
  it('conserva conflitos explicitamente aceitos e resposta vazia, sem retry',async()=>{
    const scope=new ClientContext()
    expect(await requestResult('/api/asset',{method:'DELETE'},{context:scope,fetcher:vi.fn(async()=>json({error:'em uso',items:2},409)),acceptedStatuses:[409]})).toMatchObject({status:409,body:{error:'em uso',items:2}})
    expect(await requestResult('/api/empty',undefined,{context:scope,fetcher:vi.fn(async()=>new Response(null,{status:204}))})).toEqual({status:204,body:null})
  })
  it('mantém erro e JSON inválido atuais explícitos',async()=>{
    const scope=new ClientContext()
    await expect(requestResult('/api/test',undefined,{context:scope,fetcher:vi.fn(async()=>json({error:'Pare PGM'},409))})).rejects.toThrow('Pare PGM')
    await expect(requestResult('/api/test',undefined,{context:scope,fetcher:vi.fn(async()=>new Response('invalid',{status:200}))})).rejects.toThrow()
  })
})

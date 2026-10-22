import {afterEach,expect,it,vi} from 'vitest'
import {postWhepOffer} from './whep-offer.js'
afterEach(()=>vi.useRealTimers())
it('aguarda publicação404 e503 usando a mesma oferta antes da única sessão aceita',async()=>{
  vi.useFakeTimers();const abort=new AbortController(),request=vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('no stream',{status:404}))
    .mockResolvedValueOnce(new Response('not ready',{status:503}))
    .mockResolvedValueOnce(new Response('answer',{status:201,headers:{Location:'/session/one'}}))
  const work=postWhepOffer('http://media/pvw/whep','same-sdp',abort.signal,request)
  await vi.runAllTimersAsync();expect((await work).headers.get('Location')).toBe('/session/one')
  expect(request).toHaveBeenCalledTimes(3)
  for(const call of request.mock.calls)expect(call[1]).toMatchObject({method:'POST',body:'same-sdp',signal:abort.signal})
})
it('caminho inexistente falha após prazo limitado em vez de sintonização eterna',async()=>{
  vi.useFakeTimers();const request=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('',{status:404}))
  const work=postWhepOffer('http://media/wrong/whep','sdp',new AbortController().signal,request)
  const rejected=expect(work).rejects.toThrow('HTTP 404')
  await vi.runAllTimersAsync();await rejected
  expect(request.mock.calls.length).toBeLessThanOrEqual(9);expect(vi.getTimerCount()).toBe(0)
})
it.each([400,401,403,500])('erro HTTP%s não é escondido pelo grace de publicação',async status=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status}))
  await expect(postWhepOffer('http://media/whep','sdp',new AbortController().signal,request)).rejects.toThrow(`HTTP ${status}`)
  expect(request).toHaveBeenCalledTimes(1)
})
it('erro de codec é definitivo, mesmo numa resposta404',async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response('no supported codecs',{status:404}))
  await expect(postWhepOffer('http://media/whep','sdp',new AbortController().signal,request)).rejects.toThrow('CODEC')
  expect(request).toHaveBeenCalledTimes(1)
})
it('troca de canal cancela espera e não cria outra sessão',async()=>{
  vi.useFakeTimers();const abort=new AbortController(),request=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('',{status:404}))
  const work=postWhepOffer('http://media/whep','sdp',abort.signal,request)
  const rejected=expect(work).rejects.toThrow('cancelled')
  await vi.advanceTimersByTimeAsync(1);abort.abort(new Error('cancelled'))
  await rejected;await vi.runAllTimersAsync()
  expect(request).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0)
})
it('cancelamento anterior não envia POST',async()=>{
  const abort=new AbortController();abort.abort(new Error('gone'));const request=vi.fn<typeof fetch>()
  await expect(postWhepOffer('http://media/whep','sdp',abort.signal,request)).rejects.toThrow('gone')
  expect(request).not.toHaveBeenCalled()
})
it('sessão aceita durante cancelamento devolve Location para o cleanup do chamador',async()=>{
  const abort=new AbortController(),request=vi.fn<typeof fetch>().mockImplementation(async()=>{abort.abort();return new Response('answer',{status:201,headers:{Location:'/accepted'}})})
  expect((await postWhepOffer('http://media/whep','sdp',abort.signal,request)).headers.get('Location')).toBe('/accepted')
  expect(request).toHaveBeenCalledTimes(1)
})

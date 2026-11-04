import {expect,it} from 'vitest'
import {AttemptLimiter} from './attempt-limiter.js'

it('bloqueia na 11ª tentativa da janela, libera depois dela e zera no acerto',()=>{
  let now=1_000
  const limiter=new AttemptLimiter(10,900_000,2000,()=>now)
  for(let i=0;i<10;i++){expect(limiter.blockedFor('k')).toBe(0);expect(limiter.record('k')).toBe(true)}
  expect(limiter.blockedFor('k')).toBe(900_000)
  expect(limiter.blockedFor('outra')).toBe(0)
  now+=900_000
  expect(limiter.blockedFor('k')).toBe(0)
  limiter.record('k');limiter.clear('k')
  expect(limiter.blockedFor('k')).toBe(0)
})
it('tabela cheia de chaves ativas recusa chave nova',()=>{
  const limiter=new AttemptLimiter(10,900_000,4,()=>0)
  for(const key of ['a','b','c','d','e'])expect(limiter.record(key)).toBe(true)
  expect(limiter.record('f')).toBe(false)
  expect(limiter.record('a')).toBe(true)
})

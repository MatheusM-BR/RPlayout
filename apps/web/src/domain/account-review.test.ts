import {afterEach,describe,expect,it,vi} from 'vitest'
import type {AccountCatalogReview,AccountSessionsReview} from '@rplayout/protocol'
import {accountCatalogHeaders,accountHeaders,accountSessionHeaders} from './account-review.js'
import {api} from '../api.js'
const catalog:AccountCatalogReview={revision:19,bootstrapAllowed:false,canCreate:true,users:[{id:'conta:ç',username:'Çãó',role:'OPERATOR',enabled:true,createdAt:'now',channelIds:null,stationIps:null,revision:7}]}
const sessions:AccountSessionsReview={userId:'conta:ç',username:'Çãó',accountRevision:7,revision:4,sessions:[]}
afterEach(()=>vi.unstubAllGlobals())
describe('API envia somente a conferência original de contas/sessões',()=>{
  it('provas são explícitas, namespaces Unicode e a lista não renova campos',()=>{
    expect(accountCatalogHeaders(catalog)).toEqual({'If-Match':'"accounts:catalog:19"'});expect(accountHeaders(catalog,'conta:ç')).toEqual({'If-Match':'"accounts:user:conta%3A%C3%A7:19:7"'});expect(accountSessionHeaders(sessions,'conta:ç')).toEqual({'If-Match':'"accounts:sessions:conta%3A%C3%A7:7:4"'})
    const newer={...catalog,revision:20};expect(accountCatalogHeaders(newer)).not.toEqual(accountCatalogHeaders(catalog));expect(accountHeaders(catalog,'conta:ç')['If-Match']).toContain(':19:7')
  })
  it.each([0,-1,NaN,Number.MAX_SAFE_INTEGER+1])('versão inválida %s não presume revisão',revision=>expect(()=>accountCatalogHeaders({...catalog,revision})).toThrow())
  it('conta ou sessões estrangeiras falham antes de qualquer request',()=>{expect(()=>accountHeaders(catalog,'other')).toThrow();expect(()=>accountSessionHeaders(sessions,'other')).toThrow()})
  it.each(['CREATE','PROFILE','ACCESS','REVOKE'])('%s não busca cabeçalho novo para autorizar ação antiga',async kind=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({...catalog,requiresLogin:false,applied:true}),{status:200}));vi.stubGlobal('fetch',fetch)
    if(kind==='CREATE')await api.addUser({username:'New',password:'PASSWORD',role:'OPERATOR'},catalog)
    else if(kind==='PROFILE')await api.patchUser('conta:ç',{enabled:false},catalog)
    else if(kind==='ACCESS')await api.userAccess('conta:ç',{channelIds:null,stationIps:null},catalog)
    else await api.revokeUserSessions('conta:ç',sessions)
    expect(fetch).toHaveBeenCalledTimes(1);const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
    expect(init.method).not.toBe('GET');expect(new Headers(init.headers).get('If-Match')).toContain(kind==='CREATE'?'catalog:19':kind==='REVOKE'?'sessions:conta%3A%C3%A7:7:4':'user:conta%3A%C3%A7:19:7')
    if(kind!=='CREATE')expect(url).toContain('conta%3A%C3%A7')
  })
})

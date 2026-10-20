import Fastify from 'fastify'
import {describe,it,expect} from 'vitest'
import {parseAllowedHosts,createHttpHostPolicy,registerHttpHostPolicy} from './http-host-policy.js'
import {trustedHttpOrigin} from './http-origin-policy.js'
const local={hostname:'STUDIO.broadcast.local',addresses:['192.168.42.172','::1']}
const policy=(aliases:string|undefined=undefined)=>createHttpHostPolicy({bindHost:'0.0.0.0',listenPort:4000,aliases:parseAllowedHosts(aliases)},local)
describe('admissão do endereço HTTP não depende do Origin recebido',()=>{
  it('nomes/IP reais permanecem aceitos somente na porta local',()=>{
    const allowed=policy()
    for(const host of ['localhost:4000','127.0.0.1:4000','[::1]:4000','STUDIO:4000','studio.broadcast.local.:4000','192.168.42.172:4000'])expect(allowed.allows(host)).toBe(true)
    for(const host of ['localhost','127.0.0.1:4001','studio:80','0.0.0.0:4000','[::]:4000','foreign.example:4000'])expect(allowed.allows(host)).toBe(false)
  })
  it('Origin compatível com Host forjado não concede acesso',()=>{
    expect(trustedHttpOrigin('http://foreign.example:4000','foreign.example:4000')).toBe(true)
    expect(policy().allows('foreign.example:4000')).toBe(false)
  })
  it('socket real normaliza IPv4 mapped e suporta nova interface, não outro destino',()=>{
    expect(policy().allows('10.42.0.17:4000',{localPort:4000,localAddress:'::ffff:10.42.0.17'})).toBe(true)
    expect(policy().allows('10.42.0.18:4000',{localPort:4000,localAddress:'::ffff:10.42.0.17'})).toBe(false)
  })
  it('porta dinâmica vem do socket; default80/443 usa o protocolo real',()=>{
    const dynamic=createHttpHostPolicy({bindHost:'::',listenPort:0,aliases:[]},local)
    expect(dynamic.allows('localhost:51965',{localPort:51965})).toBe(true)
    expect(dynamic.allows('localhost',{localPort:80,protocol:'http'})).toBe(true)
    expect(dynamic.allows('localhost',{localPort:443,protocol:'https'})).toBe(true)
    expect(dynamic.allows('localhost',{localPort:4000,protocol:'http'})).toBe(false)
  })
  it('alias explícito não é wildcard nem libera uma porta diferente',()=>{
    const allowed=policy('PLAYOUT.example, proxy.example:8443, [::1]:8080')
    expect(allowed.allows('playout.example:4000')).toBe(true);expect(allowed.allows('playout.example')).toBe(true)
    expect(allowed.allows('proxy.example:8443')).toBe(true);expect(allowed.allows('[::1]:8080')).toBe(true)
    for(const host of ['playout.example:4001','other.playout.example:4000','proxy.example','proxy.example:8444'])expect(allowed.allows(host)).toBe(false)
  })
  it('bind explícito aceita seu nome, sem tratar escuta wildcard como autoridade',()=>{
    expect(createHttpHostPolicy({bindHost:'bound.example',listenPort:4000,aliases:[]},local).allows('bound.example:4000')).toBe(true)
    expect(policy().allows('0.0.0.0:4000')).toBe(false)
  })
  it.each(['*','*.example','%2a.example','http://host','user:PRIVATE_HOST_PASSWORD@host','host/path','host?token=PRIVATE_HOST_TOKEN','host#fragment','host:','host:0','host:65536','host,,other','host,','ho\tst','host\\path','[::1]:'])('configuração inválida %j recusa a lista sem repetir valor',value=>{
    expect(()=>parseAllowedHosts(value)).toThrow('RPLAYOUT_ALLOWED_HOSTS')
    try{parseAllowedHosts(value)}catch(error){expect((error as Error).message).not.toContain('PRIVATE_HOST')}
  })
  it('deduplica/normaliza valores válidos e limita quantidade/tamanho',()=>{
    expect(parseAllowedHosts('HOST:80, host:080, [0:0:0:0:0:0:0:1]:4000')).toEqual([{hostname:'host',port:80},{hostname:'[::1]',port:4000}])
    expect(parseAllowedHosts('')).toEqual([])
    expect(()=>parseAllowedHosts(Array(65).fill('host').join(','))).toThrow('64')
    expect(()=>parseAllowedHosts('a'.repeat(1025))).toThrow('inválida')
  })
  it('HOST/PORT inválidos não criam política permissiva',()=>{
    for(const bindHost of ['','http://host','host:4000','user@host','[::]'])expect(()=>createHttpHostPolicy({bindHost,listenPort:4000,aliases:[]},local)).toThrow('HOST')
    for(const listenPort of [NaN,-1,65536,1.5])expect(()=>createHttpHostPolicy({bindHost:'0.0.0.0',listenPort,aliases:[]},local)).toThrow('PORT')
  })
  it('hook protege API, static, pré-flight e WS antes de qualquer handler e ignora forwarded-host',async()=>{
    const server=Fastify();registerHttpHostPolicy(server,policy())
    let executed=0
    for(const url of ['/api/state','/assets/index.js','/ws'])server.get(url,async()=>{executed++;return {ok:true}})
    server.options('/api/state',async(_,reply)=>{executed++;return reply.code(204).send()})
    try{
      for(const url of ['/api/state','/assets/index.js','/ws']){
        const result=await server.inject({url,headers:{host:'foreign.example:4000',origin:'http://foreign.example:4000','x-forwarded-host':'studio:4000'}})
        expect(result.statusCode).toBe(403);expect(result.json().error).toBe('HTTP_HOST_NOT_ALLOWED');expect(result.headers['cache-control']).toBe('private, no-store')
      }
      expect((await server.inject({method:'OPTIONS',url:'/api/state',headers:{host:'foreign.example:4000'}})).statusCode).toBe(403)
      expect(executed).toBe(0)
      expect((await server.inject({url:'/api/state',headers:{host:'studio:4000'}})).statusCode).toBe(200);expect(executed).toBe(1)
    }finally{await server.close()}
  })
})

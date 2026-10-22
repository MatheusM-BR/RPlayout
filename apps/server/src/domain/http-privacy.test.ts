import Fastify from 'fastify'
import {describe,it,expect} from 'vitest'
import {privateRequestLog,privateErrorLog,privateHttpLogger,privateStartupDiagnostic,privateApiCacheControl,registerHttpPrivacy} from './http-privacy.js'

describe('fronteira privada HTTP',()=>{
  it('tarefas de fundo registram contexto fixo/código conhecido sem repetir Error, string ou objeto privado',async()=>{
    const lines:string[]=[],server=Fastify({logger:{...privateHttpLogger('info'),stream:{write(line:string){lines.push(line)}}}})
    try{
      server.log.warn({err:Object.assign(new Error('PRIVATE_SCHEDULER'),{code:'SQLITE_CONSTRAINT_TRIGGER'})},'scheduler: aviso não persistido; nova tentativa sem alterar PGM.')
      server.log.error({err:'PRIVATE_BACKGROUND_STRING'},'Falha na análise de áudio.')
      server.log.error({err:{password:'PRIVATE_BACKGROUND_OBJECT',message:'PRIVATE_BACKGROUND_MESSAGE'}},'Falha na fila de mídia.')
      const entries=lines.map(line=>JSON.parse(line))
      expect(entries).toHaveLength(3)
      expect(entries[0].err.code).toBe('SQLITE_CONSTRAINT_TRIGGER')
      expect(entries[0].msg).toContain('scheduler: aviso não persistido')
      expect(entries.every(entry=>entry.err.detailsOmitted)).toBe(true)
      expect(lines.join('')).not.toContain('PRIVATE_')
    }finally{await server.close()}
  })
  it('startup retém diagnóstico sanitizado, sem stack/causa ou objeto de configuração',()=>{
    const diagnostic=privateStartupDiagnostic(Object.assign(new Error('Não abriu https://host/PRIVATE_WEBHOOK?key=PRIVATE_KEY ou srt://user:PRIVATE_PASSWORD@host?passphrase=PRIVATE_SRT'),{cause:{password:'PRIVATE_CAUSE'}}))
    expect(diagnostic.diagnostic).toContain('Não abriu')
    for(const secret of ['PRIVATE_WEBHOOK','PRIVATE_KEY','PRIVATE_PASSWORD','PRIVATE_SRT','PRIVATE_CAUSE'])expect(JSON.stringify(diagnostic)).not.toContain(secret)
    expect(privateStartupDiagnostic({password:'PRIVATE_OBJECT'}).diagnostic).toBe('Falha de partida não identificada.')
  })
  it('a produção pode registrar uma única fallback SPA depois, sem duplicar handler404',async()=>{
    const server=Fastify();registerHttpPrivacy(server,{notFound:false})
    server.setNotFoundHandler((request,reply)=>request.url.startsWith('/api')?reply.code(404).send({error:'Rota não existe.'}):reply.type('text/html').send('<p>Interface</p>'))
    try{expect((await server.inject('/workspace')).body).toContain('Interface');expect((await server.inject('/api/missing')).headers['cache-control']).toBe('private, no-store')}
    finally{await server.close()}
  })
  it('serializa somente método, rota canônica e estação, sem copiar outros campos',()=>{
    const request={method:'GET',routeOptions:{url:'/api/sources/:id'},ip:'127.0.0.1',url:'/api/sources/PRIVATE_PATH?key=PRIVATE_QUERY',headers:{cookie:'PRIVATE_COOKIE',authorization:'PRIVATE_BEARER'},body:{password:'PRIVATE_PASSWORD'}}
    expect(privateRequestLog(request)).toEqual({method:'GET',route:'/api/sources/:id',station:'127.0.0.1'})
    expect(privateRequestLog({method:'GET',url:'PRIVATE_RAW_URL'} as any)).toEqual({method:'GET',route:'UNMATCHED'})
  })
  it('erro conserva tipo/código conhecidos, nunca mensagem/stack/causa/objeto arbitrário',()=>{
    const error=Object.assign(new Error('PRIVATE_MESSAGE'),{code:'EACCES',statusCode:500,cause:{password:'PRIVATE_CAUSE'}})
    expect(privateErrorLog(error)).toEqual({type:'Error',message:'Detalhes privados omitidos',stack:'',code:'EACCES',statusCode:500,detailsOmitted:true})
    expect(privateErrorLog({name:'PRIVATE_NAME',code:'PRIVATE_CODE',statusCode:'PRIVATE_STATUS',stack:'PRIVATE_STACK',message:'PRIVATE_MESSAGE'})).toEqual({type:'Error',message:'Detalhes privados omitidos',stack:'',detailsOmitted:true})
    expect(privateErrorLog('PRIVATE_STRING')).toEqual({type:'Error',message:'Detalhes privados omitidos',stack:'',detailsOmitted:true})
  })
  it('controle nunca cacheia; mídia mantém TTL privado sem instrução pública/compartilhada',()=>{
    expect(privateApiCacheControl('public, max-age=9999',true)).toBe('private, no-store')
    expect(privateApiCacheControl(undefined,false)).toBe('private')
    expect(privateApiCacheControl('public, max-age=60, s-maxage=600, immutable',false)).toBe('private, max-age=60, immutable')
    expect(privateApiCacheControl('private, no-store',false)).toBe('private, no-store')
  })
  it('logger real info/erro não registra credenciais em parâmetros, query, headers ou stack',async()=>{
    const lines:string[]=[],server=Fastify({logger:{...privateHttpLogger('info'),stream:{write(line:string){lines.push(line)}}}})
    registerHttpPrivacy(server)
    server.get('/api/check/:id',async()=>({ok:true}))
    server.post('/api/fail',async()=>{throw Object.assign(new Error('PRIVATE_ERROR'),{code:'PRIVATE_ERROR_CODE'})})
    try{
      await server.inject({url:'/api/check/PRIVATE_PATH?secret=PRIVATE_QUERY&key=PRIVATE_KEY',headers:{cookie:'rplayout_session=PRIVATE_COOKIE',authorization:'Bearer PRIVATE_BEARER'}})
      await server.inject({url:'/api/missing/PRIVATE_UNKNOWN?password=PRIVATE_404'})
      const failure=await server.inject({method:'POST',url:'/api/fail?token=PRIVATE_POST_QUERY',payload:{password:'PRIVATE_BODY'}})
      expect(failure.json().message).toContain(failure.json().requestId);expect(failure.json().message).toContain('antes de repetir');expect(failure.body).not.toContain('PRIVATE_ERROR')
      const logs=lines.join('');expect(logs).toContain('/api/check/:id');expect(logs).toContain('reqId');expect(logs).toContain('statusCode')
      for(const secret of ['PRIVATE_PATH','PRIVATE_QUERY','PRIVATE_KEY','PRIVATE_COOKIE','PRIVATE_BEARER','PRIVATE_ERROR','PRIVATE_ERROR_CODE','PRIVATE_UNKNOWN','PRIVATE_404','PRIVATE_POST_QUERY','PRIVATE_BODY'])expect(logs).not.toContain(secret)
      expect(logs).toContain('detailsOmitted')
    }finally{await server.close()}
  })
  it('respostas JSON/erros/HEAD/CSV são privadas; mídia206 e assets web preservam conteúdo/cache',async()=>{
    const server=Fastify();registerHttpPrivacy(server)
    server.get('/api/state',async(_,reply)=>reply.header('cache-control','public, max-age=3600').send({ok:true}))
    server.get('/api/denied',async(_,reply)=>reply.code(403).send({error:'Acesso recusado'}))
    server.get('/api/history.csv',async(_,reply)=>reply.type('text/csv').send('item,status\nvt,OK'))
    server.get('/api/media',async(_,reply)=>reply.header('cache-control','public, max-age=60, immutable').header('content-range','bytes 0-2/3').code(206).type('video/mp4').send(Buffer.from([1,2,3])))
    server.get('/assets/index.js',async(_,reply)=>reply.header('cache-control','public, max-age=3600').type('application/javascript').send('ready'))
    try{
      for(const options of [{url:'/api/state'},{url:'/api/denied'},{url:'/api/history.csv'},{url:'/api/missing?token=SECRET'},{method:'HEAD' as const,url:'/api/state'}])expect((await server.inject(options)).headers['cache-control']).toBe('private, no-store')
      const media=await server.inject('/api/media');expect(media.statusCode).toBe(206);expect(media.rawPayload).toEqual(Buffer.from([1,2,3]));expect(media.headers['content-range']).toBe('bytes 0-2/3');expect(media.headers['cache-control']).toBe('private, max-age=60, immutable')
      expect((await server.inject('/assets/index.js')).headers['cache-control']).toBe('public, max-age=3600')
    }finally{await server.close()}
  })
})

import type {FastifyInstance} from 'fastify'
import {STATUS_CODES} from 'node:http'
import {sanitizeDiagnostic} from './sanitize-diagnostic.js'

/** Do not serialize raw URL, query, headers, body or arbitrary error strings.
 * Native/domain diagnostics have their own sanitization. HTTP logs correlate
 * request ID, canonical route and result without becoming a credential copy. */
export function privateRequestLog(request:{method?:unknown;routeOptions?:{url?:unknown};ip?:unknown}){
  return {method:typeof request.method==='string'?request.method:'UNKNOWN',
    route:typeof request.routeOptions?.url==='string'?request.routeOptions.url:'UNMATCHED',
    ...(typeof request.ip==='string'?{station:request.ip}:{})}
}
const errorTypes=new Set(['Error','TypeError','SyntaxError','RangeError','ReferenceError','URIError','AggregateError','SqliteError','FastifyError'])
const errorCodes=new Set(['ECONNRESET','ECONNREFUSED','EPIPE','ENOENT','EACCES','EPERM','ETIMEDOUT','ENOSPC','EEXIST','EADDRINUSE','SQLITE_BUSY','SQLITE_LOCKED','SQLITE_READONLY','SQLITE_FULL','SQLITE_CORRUPT','SQLITE_ERROR','SQLITE_CONSTRAINT_FOREIGNKEY','SQLITE_CONSTRAINT_UNIQUE','SQLITE_CONSTRAINT_TRIGGER','SQLITE_CONSTRAINT_CHECK','SQLITE_CONSTRAINT_NOTNULL','SQLITE_CONSTRAINT_PRIMARYKEY','ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ERR_INVALID_ARG_TYPE','FST_ERR_VALIDATION','FST_ERR_NOT_FOUND','FST_ERR_BAD_STATUS_CODE','FST_ERR_CTP_INVALID_MEDIA_TYPE'])
export function privateErrorLog(error:unknown){
  const value=error&&typeof error==='object'?error as {name?:unknown;code?:unknown;statusCode?:unknown}:{}
  return {type:typeof value.name==='string'&&errorTypes.has(value.name)?value.name:'Error',
    message:'Detalhes privados omitidos',stack:'',
    ...(typeof value.code==='string'&&errorCodes.has(value.code)?{code:value.code}:{}),
    ...(Number.isInteger(value.statusCode)&&Number(value.statusCode)>=100&&Number(value.statusCode)<=599?{statusCode:Number(value.statusCode)}:{}),
    detailsOmitted:true}
}
export function privateHttpLogger(level:string){
  return {level,serializers:{req:privateRequestLog,res:(reply:{statusCode?:number})=>({statusCode:reply.statusCode}),err:privateErrorLog}}
}
/** Startup is not a request: retain the existing sanitized operator diagnostic
 * without stack, causes, config objects or arbitrary non-Error values. */
export function privateStartupDiagnostic(error:unknown){
  return {...privateErrorLog(error),diagnostic:error instanceof Error?sanitizeDiagnostic(error.message):'Falha de partida não identificada.'}
}
export function internalFailureDiagnostic(error:unknown):{where:string[]}{
  if(!(error instanceof Error))return {where:[]}
  const where=(error.stack??'').split('\n').slice(1).map(line=>/^\s*at\s+(?:async\s+)?([A-Za-z_$][\w$.<>]*)\s+\(/.exec(line)?.[1]).filter((name):name is string=>Boolean(name)).slice(0,6)
  return {where}
}
export function privateApiCacheControl(previous:unknown,ephemeral:boolean):string{
  if(ephemeral)return 'private, no-store'
  const directives=typeof previous==='string'?previous.split(',').map(value=>value.trim()).filter(value=>value&&!/^public$|^private(?:\s*=.*)?$|^s-maxage\s*=/i.test(value)):[]
  return ['private',...directives].join(', ')
}
export function registerHttpPrivacy(server:FastifyInstance,options:{notFound?:boolean}={}){
  // Fastify's defaults also copy error.message and unmatched raw URLs into
  // the top-level log msg; field serializers alone cannot remove that copy.
  server.setErrorHandler((error,request,reply)=>{
    const value=error&&typeof error==='object'?error as {statusCode?:unknown;message?:unknown}:{}
    const status=Number.isInteger(value.statusCode)&&Number(value.statusCode)>=400&&Number(value.statusCode)<=599?Number(value.statusCode):500
    // A 5xx is a defect to be found later: keep only the function names of
    // the first frames. Messages stay out (they may carry operator data the
    // sanitizer does not know); no paths, causes, bodies or raw values.
    if(status>=500)request.log.error({err:error,...internalFailureDiagnostic(error)},'Falha HTTP; detalhes privados omitidos')
    else request.log.warn({err:error},'Falha HTTP; detalhes privados omitidos')
    return reply.code(status).type('application/json').send({statusCode:status,error:STATUS_CODES[status]??'Error',requestId:request.id,
      message:status>=500?`Falha interna (solicitação ${request.id}). Confira o diagnóstico do domínio antes de repetir o comando.`:typeof value.message==='string'?sanitizeDiagnostic(value.message):'Solicitação recusada.'})
  })
  // Production static routing may supply its own SPA fallback afterwards.
  // Missing web builds must not fall back to logging credential-bearing URLs.
  if(options.notFound!==false)server.setNotFoundHandler((_,reply)=>reply.code(404).send({error:'Rota não existe.'}))
  server.addHook('onSend',async(request,reply,payload)=>{
    const path=request.url.split('?')[0]!
    if(path==='/api'||path.startsWith('/api/')){
      const type=String(reply.getHeader('content-type')??'').split(';')[0]!.trim().toLowerCase()
      // Dynamic control/sessions/reviews/exports cannot be reused by a shared
      // cache or after account changes. Binary media keeps private TTL/ranges.
      const ephemeral=type==='application/json'||type.endsWith('+json')||['text/csv','text/plain','application/xml','text/xml'].includes(type)
      reply.header('cache-control',privateApiCacheControl(reply.getHeader('cache-control'),ephemeral))
    }
    return payload
  })
}

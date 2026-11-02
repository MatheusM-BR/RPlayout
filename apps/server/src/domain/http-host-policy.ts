import {hostname,networkInterfaces} from 'node:os'
import {isIP} from 'node:net'
import type {FastifyInstance} from 'fastify'

interface Authority {hostname:string;port:number|undefined}
function authority(raw:unknown):Authority|null{
  if(typeof raw!=='string'||!raw||raw.length>1024||/[\s\\/?#@*\u0000-\u001f\u007f]/u.test(raw))return null
  try{
    const parsed=new URL(`http://${raw}`)
    if(!parsed.hostname||parsed.hostname.includes('*')||parsed.username||parsed.password||parsed.pathname!=='/')return null
    const tail=raw.startsWith('[')?raw.slice(raw.indexOf(']')+1):raw.includes(':')?raw.slice(raw.lastIndexOf(':')):''
    if(tail&&!/^:\d+$/.test(tail))return null
    const port=tail?Number(tail.slice(1)):undefined
    if(port!==undefined&&(!Number.isInteger(port)||port<1||port>65535))return null
    let name=parsed.hostname.toLowerCase()
    if(name.endsWith('..'))return null
    if(name.endsWith('.'))name=name.slice(0,-1)
    return {hostname:name,port}
  }catch{return null}
}
export function parseAllowedHosts(raw:string|undefined):Authority[]{
  if(raw===undefined||!raw.trim())return []
  const entries=raw.split(',')
  if(entries.length>64)throw new Error('RPLAYOUT_ALLOWED_HOSTS aceita no máximo 64 endereços explícitos.')
  const values=new Map<string,Authority>()
  for(const [index,entry]of entries.entries()){
    const parsed=authority(entry.trim())
    if(!parsed)throw new Error(`RPLAYOUT_ALLOWED_HOSTS: entrada ${index+1} inválida. Use nome/IP e porta opcional, sem protocolo, credenciais, caminho, query ou curingas.`)
    values.set(`${parsed.hostname}:${parsed.port??''}`,parsed)
  }
  return [...values.values()]
}
function addressName(value:string):string|null{
  const clean=value.startsWith('::ffff:')?value.slice(7):value
  if(!isIP(clean))return null
  return authority(isIP(clean)===6?`[${clean}]`:clean)?.hostname??null
}
interface HostOptions {bindHost:string;listenPort:number;aliases:readonly Authority[]}
interface LocalIdentity {hostname:string;addresses:readonly string[]}
export function createHttpHostPolicy(options:HostOptions,identity?:LocalIdentity){
  if(!Number.isInteger(options.listenPort)||options.listenPort<0||options.listenPort>65535)throw new Error('PORT deve ser uma porta válida (0–65535). Nenhum servidor foi iniciado.')
  const binding=isIP(options.bindHost)?{hostname:addressName(options.bindHost)!,port:undefined}:authority(options.bindHost)
  if(!binding||binding.port!==undefined||options.bindHost.startsWith('['))throw new Error('HOST deve ser um nome/IP válido de escuta, sem porta, protocolo, credenciais ou caminho. IPv6 de escuta não usa colchetes.')
  const local=identity??{hostname:hostname(),addresses:Object.values(networkInterfaces()).flatMap(rows=>rows?.map(row=>row.address)??[])}
  const names=new Set<string>(['localhost','127.0.0.1','[::1]'])
  for(const candidate of [local.hostname,local.hostname.split('.')[0]!]){const parsed=authority(candidate);if(parsed&&parsed.port===undefined)names.add(parsed.hostname)}
  for(const address of local.addresses){const name=addressName(address);if(name&&name!=='0.0.0.0'&&name!=='[::]')names.add(name)}
  if(binding.hostname!=='0.0.0.0'&&binding.hostname!=='[::]')names.add(binding.hostname)
  const aliases=options.aliases.map(value=>({...value}))
  return {allows(raw:unknown,context:{localPort?:number;localAddress?:string;protocol?:string}={}):boolean{
    const parsed=authority(raw);if(!parsed)return false
    const boundPort=context.localPort??options.listenPort
    const effectivePort=parsed.port??(context.protocol==='https'?443:80)
    if(aliases.some(alias=>alias.hostname===parsed.hostname&&(alias.port!==undefined?alias.port===effectivePort:parsed.port===undefined||parsed.port===boundPort)))return true
    // The actual destination socket handles a changed local interface address,
    // never forwarded/request headers or DNS resolution of a supplied hostname.
    const destination=context.localAddress?addressName(context.localAddress):null
    return effectivePort===boundPort&&(names.has(parsed.hostname)||destination===parsed.hostname)
  }}
}
export function registerHttpHostPolicy(server:FastifyInstance,policy:ReturnType<typeof createHttpHostPolicy>){
  server.addHook('onRequest',async(request,reply)=>{
    const raw=request.raw.rawHeaders
    const hostFields=Array.isArray(raw)?raw.filter((_,index)=>index%2===0&&['host',':authority'].includes(raw[index]!.toLowerCase())).length:1
    const received=request.headers.host??request.headers[':authority']
    if(hostFields!==1||!policy.allows(received,{localPort:request.raw.socket.localPort,localAddress:request.raw.socket.localAddress,protocol:request.protocol})){
      return reply.code(403).header('cache-control','private, no-store').send({error:'HTTP_HOST_NOT_ALLOWED',message:'Endereço do servidor não autorizado. Abra pelo IP/nome real e porta do servidor; aliases personalizados precisam de configuração explícita.'})
    }
  })
}

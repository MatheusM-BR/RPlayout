import {randomUUID} from 'node:crypto'
import {lstatSync,realpathSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import type {FastifyInstance} from 'fastify'
import {writePrivateConfig} from './private-config-file.js'

export const LAUNCHER_IDENTITY_PATH='/_rplayout/launcher'
function physical(path:string){
  for(let current=resolve(path);;current=dirname(current)){
    const info=lstatSync(current)
    if(info.isSymbolicLink())throw new Error('Identificação local exige caminhos físicos, sem links ou junções.')
    if(dirname(current)===current)break
  }
  return realpathSync(path)
}
export function launcherPeerAllowed(remote:string|undefined,local:string|undefined,headers:Record<string,unknown>):boolean{
  if(['origin','sec-fetch-site','forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto'].some(name=>headers[name]!==undefined))return false
  const normalize=(value:string|undefined)=>value?.replace(/^::ffff:/,'')
  const peer=normalize(remote),destination=normalize(local)
  // A self-connection to a specifically bound local interface is also local.
  // Never trust forwarded headers, request.ip or a hostname supplied by HTTP.
  return !!peer&&(peer==='::1'||/^127\.\d+\.\d+\.\d+$/.test(peer)||peer===destination)
}

/** Opaque local instance identity, NOT a login/session or TAKE capability.
 * Stale private descriptors alone never prove that a server is still alive. */
export function registerLauncherDiscovery(server:FastifyInstance,options:{enabled:boolean;root:string;database:string;port:number},writer=writePrivateConfig){
  if(!options.enabled)return {publish:async()=>{}}
  if(!Number.isInteger(options.port)||options.port<1||options.port>65535)throw new Error('Porta do launcher inválida.')
  const identity={application:'RPlayout',version:1,pid:process.pid,port:options.port,instanceId:randomUUID()}
  let ready=false
  server.get(LAUNCHER_IDENTITY_PATH,async(request,reply)=>{
    reply.header('cache-control','private, no-store')
    if(!launcherPeerAllowed(request.raw.socket.remoteAddress,request.raw.socket.localAddress,request.headers))return reply.code(403).send({error:'LOCAL_LAUNCHER_ONLY'})
    if(!ready)return reply.code(503).send({error:'LAUNCHER_NOT_READY'})
    return identity // No installation/data paths or credentials over HTTP.
  })
  server.addHook('onClose',async()=>{ready=false})
  return {async publish(){
    // Publish only AFTER listen succeeds: a port collision must not replace
    // another running instance's descriptor. Protect before writing identity.
    const root=physical(options.root),database=physical(options.database)
    if(!lstatSync(root).isDirectory()||!lstatSync(database).isFile())throw new Error('Instalação ou banco local não confirmado.')
    await writer(join(root,`.rplayout-launcher-${options.port}.json`),JSON.stringify({...identity,root,database}))
    ready=true
  }}
}

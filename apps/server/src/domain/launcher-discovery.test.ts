import {describe,it,expect} from 'vitest'
import Fastify from 'fastify'
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {launcherPeerAllowed,registerLauncherDiscovery,LAUNCHER_IDENTITY_PATH} from './launcher-discovery.js'

describe('local launcher instance identity',()=>{
  it.each([
    ['127.0.0.1','127.0.0.1',{},true],['::ffff:127.0.0.1','::ffff:127.0.0.1',{},true],['::1','::1',{},true],
    ['192.0.2.5','192.0.2.5',{},true],['192.0.2.6','192.0.2.5',{},false],
    ['192.0.2.6','192.0.2.5',{'x-forwarded-for':'127.0.0.1'},false],
    ['127.0.0.1','127.0.0.1',{'x-forwarded-for':'192.0.2.6'},false],
    ['127.0.0.1','127.0.0.1',{origin:'http://localhost:4000'},false],
    ['127.0.0.1','127.0.0.1',{'sec-fetch-site':'none'},false],[undefined,'127.0.0.1',{},false],
  ] as const)('uses raw socket peer, not forwarded/browser authority (%s)',(remote,local,headers,allowed)=>{
    expect(launcherPeerAllowed(remote,local,headers)).toBe(allowed)
  })
  it('disabled direct startup does not create a public identity endpoint',async()=>{
    const app=Fastify();registerLauncherDiscovery(app,{enabled:false,root:'.',database:'none',port:4000})
    try{expect((await app.inject(LAUNCHER_IDENTITY_PATH)).statusCode).toBe(404)}finally{await app.close()}
  })
  it('publishes a protected descriptor after readiness, without paths or login credentials over HTTP',async()=>{
    const root=mkdtempSync(join(tmpdir(),'rplayout-launcher-unit-')),database=join(root,'data.db');writeFileSync(database,'own fixture')
    const app=Fastify(),writes:Array<{file:string;content:string}>=[]
    const state=registerLauncherDiscovery(app,{enabled:true,root,database,port:45678},async(file,content)=>{writes.push({file,content});writeFileSync(file,content,{mode:0o600})})
    try{
      expect((await app.inject(LAUNCHER_IDENTITY_PATH)).statusCode).toBe(503)
      expect(writes).toHaveLength(0)
      await state.publish()
      const response=await app.inject(LAUNCHER_IDENTITY_PATH),identity=response.json()
      expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store')
      expect(identity).toMatchObject({application:'RPlayout',version:1,pid:process.pid,port:45678})
      expect(identity.instanceId).toMatch(/^[a-f0-9-]{36}$/)
      expect(Object.keys(identity).sort()).toEqual(['application','instanceId','pid','port','version'])
      const descriptor=JSON.parse(readFileSync(join(root,'.rplayout-launcher-45678.json'),'utf8'))
      expect(descriptor).toMatchObject({...identity,root,database})
      expect((await app.inject({url:LAUNCHER_IDENTITY_PATH,headers:{origin:'null'}})).statusCode).toBe(403)
    }finally{await app.close()}
  })
  it('failed protection never confirms identity',async()=>{
    const root=mkdtempSync(join(tmpdir(),'rplayout-launcher-fail-')),database=join(root,'data.db');writeFileSync(database,'own')
    const app=Fastify(),state=registerLauncherDiscovery(app,{enabled:true,root,database,port:45679},async()=>{throw new Error('ACL failed')})
    try{await expect(state.publish()).rejects.toThrow('ACL failed');expect((await app.inject(LAUNCHER_IDENTITY_PATH)).statusCode).toBe(503)}finally{await app.close()}
  })
  it('refuses missing database before publishing or overwriting a descriptor',async()=>{
    const root=mkdtempSync(join(tmpdir(),'rplayout-launcher-missing-')),app=Fastify();let writes=0
    const state=registerLauncherDiscovery(app,{enabled:true,root,database:join(root,'missing'),port:45680},async()=>{writes++})
    try{await expect(state.publish()).rejects.toThrow();expect(writes).toBe(0)}finally{await app.close()}
  })
  it('rejects zero/fractional/nonportable ports',()=>{
    for(const port of [0,-1,1.5,65536,NaN])expect(()=>registerLauncherDiscovery(Fastify(),{enabled:true,root:'.',database:'none',port})).toThrow('Porta')
  })
})

import {afterEach,expect,it,vi} from 'vitest'
import Fastify from 'fastify'
import {createApp,type App} from '../app.js'
import {registerRoutes} from '../routes.js'
import {sessionDigest} from './access.js'
import type {SourceList} from './sources.js'
let app:App|undefined,server:ReturnType<typeof Fastify>|undefined
afterEach(async()=>{await server?.close();await app?.close();vi.restoreAllMocks()})
it('API filtra cadastro/convidado por sessão e canal antes de devolver cache compartilhado',async()=>{
  app=await createApp(':memory:');server=Fastify();registerRoutes(app,server,()=>{})
  app.sqlite.exec("INSERT INTO users VALUES('u','Source QA','NO_LOGIN','ADMIN',1,'now')")
  app.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionDigest('source-scope-token'),'u','2099-01-01','now')
  app.sqlite.prepare('INSERT INTO user_access(user_id,channel_ids,station_ips,updated_at) VALUES(?,?,NULL,?)').run('u',JSON.stringify(['a']),'now')
  const empty={available:false,reason:'not measured',sources:[]}
  const list:SourceList={sdi:empty,sdiOutputs:empty,omt:empty,guests:{available:true,reason:null,sources:[{family:'GUEST',channelId:'b',reference:'guest:PRIVATE_OTHER_KEY',label:'PRIVATE_OTHER_GUEST'}]},ndi:{available:true,reason:null,sources:[{family:'NDI',discovery:'DISCOVERED',reference:'ndi:CAM',label:'Found'},{family:'NDI',discovery:'CONFIGURED',configuredId:'a1',channelId:'a',reference:'ndi:CAM',label:'Allowed'},{family:'NDI',discovery:'CONFIGURED',configuredId:'b1',channelId:'b',reference:'ndi:CAM',label:'PRIVATE_OTHER_INPUT'}]}}
  vi.spyOn(app.sources,'list').mockResolvedValue(list)
  const headers={cookie:'rplayout_session=source-scope-token'}
  for(const url of ['/api/sources','/api/sources?channelId=a']){
    const response=await server.inject({url,headers});expect(response.statusCode,response.body).toBe(200);expect(response.body).toContain('Allowed');expect(response.body).not.toContain('PRIVATE_OTHER')
  }
  expect((await server.inject({url:'/api/sources?channelId=b',headers})).statusCode).toBe(403)
  expect((await server.inject({url:'/api/sources?refresh=invalid',headers})).statusCode).toBe(400)
  expect(list.ndi.sources).toHaveLength(3);expect(list.guests.sources).toHaveLength(1)
})

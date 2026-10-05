import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {openDatabase} from '../db/client.js'
import {operatorDecisions} from '../db/schema.js'
import {publicAuditValue,readAudit} from './audit.js'
import {installationVault} from './secret-vault.js'
let value:ReturnType<typeof openDatabase>
beforeEach(()=>{
  value=openDatabase(':memory:')
  for(const id of ['a','b']){
    value.sqlite.prepare('INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,id,25,1,320,180,-23,-1,5,'now')
    value.sqlite.prepare('INSERT INTO rundowns (id,channel_id,name,planned_start,loop,date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(`rd-${id}`,id,id,0,0,'2026-10-01','now','now')
  }
})
afterEach(()=>value.sqlite.close())
async function entry(id:string,rundownId:string,payload:Record<string,unknown>,createdAt='2026-10-01T20:00:00.000Z'){
  await value.db.insert(operatorDecisions).values({id,rundownId,kind:'QA',payload,createdAt})
}
describe('auditoria por canal e privilégios',()=>{
  it('payload legado nulo não interrompe leitura nem ganha permissão de canal',async()=>{
    await entry('own-null','rd-a',{})
    await entry('global-null','@security',{})
    // SQL NULL is forbidden, but an older encrypted JSON value may be null.
    value.sqlite.prepare('UPDATE operator_decisions SET payload=? WHERE id IN (?,?)').run(installationVault().encrypt('null','operator_decisions.payload'),'own-null','global-null')
    expect((await readAudit(value.db,{channelIds:['a'],globalAdmin:false},100)).map(row=>row.id)).toEqual(['own-null'])
  })
  it('operador restrito vê seus canais, não administração nem eventos cruzados',async()=>{
    await entry('a','rd-a',{})
    await entry('b','rd-b',{})
    await entry('config-a','@security',{channelId:'a'})
    await entry('login','@security',{username:'admin',station:'PRIVATE_STATION'})
    await entry('http-a','@http',{channelIds:['a']})
    await entry('http-cross','@http',{channelIds:['a','b']})
    expect((await readAudit(value.db,{channelIds:['a'],globalAdmin:false},100)).map(row=>row.id).sort()).toEqual(['a','config-a','http-a'])
    expect((await readAudit(value.db,{channelIds:['a'],globalAdmin:true},100)).map(row=>row.id).sort()).toEqual(['a','config-a','http-a'])
    expect((await readAudit(value.db,{channelIds:null,channelId:'a',globalAdmin:true},100)).map(row=>row.id).sort()).toEqual(['a','config-a','http-a','http-cross'])
    expect(await readAudit(value.db,{channelIds:['a'],channelId:'b',globalAdmin:false},100)).toEqual([])
    expect(await readAudit(value.db,{channelIds:null,globalAdmin:true},100)).toHaveLength(6)
  })
  it('limite vem após filtro, pagina eventos com timestamp igual sem perder os autorizados',async()=>{
    for(let i=0;i<270;i++)await entry(`hidden-${String(i).padStart(3,'0')}`,'@security',{username:'admin'})
    await entry('000-own-a','rd-a',{})
    await entry('001-own-a','rd-a',{})
    await entry('002-own-a','rd-a',{})
    expect((await readAudit(value.db,{channelIds:['a'],globalAdmin:false},2)).map(row=>row.id)).toEqual(['001-own-a','002-own-a'])
  })
  it('segredos legados são protegidos no payload devolvido, não alteram dado original',async()=>{
    const payload={password:'PRIVATE_PASSWORD',nested:{cookie:'PRIVATE_COOKIE',url:'srt://host:9000?passphrase=PRIVATE_PHRASE'},message:'Falhou rtmp://host/live/PRIVATE_STREAM'}
    await entry('secret','rd-a',payload)
    const result=await readAudit(value.db,{channelIds:['a'],globalAdmin:false},100)
    expect(JSON.stringify(result)).not.toContain('PRIVATE_')
    expect(publicAuditValue({title:'Ação — ÇÃO'})).toEqual({title:'Ação — ÇÃO'})
    expect(value.db.select().from(operatorDecisions).get()?.payload).toEqual(payload)
  })
})

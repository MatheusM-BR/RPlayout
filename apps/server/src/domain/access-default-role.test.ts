import {afterEach,describe,expect,it,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
const config=vi.hoisted(()=>({role:'INVALID'}))
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),AUTH_USER:'',AUTH_PASSWORD:'',get DEFAULT_ROLE(){return config.role}}))
import {AccessControl} from './access.js'
import {can} from './permissions.js'
let database:ReturnType<typeof openDatabase>|undefined
afterEach(()=>{database?.sqlite.close();database=undefined})
describe('papel local configurado é explícito e fail-closed',()=>{
  it.each(['VIEWER','ADMIN ','admin','','constructor'])('configuração inválida %j não concede comandos mesmo com header ADMIN',value=>{
    config.role=value;database=openDatabase(':memory:')
    const access=new AccessControl(database.sqlite)
    for(const headers of [{},{'x-rplayout-role':'ADMIN'},{'x-rplayout-role':'OPERATOR'}]){
      const role=access.role({headers});expect(role).toBe('DENIED');expect(can(role,'TRANSPORT')).toBe(false);expect(can(role,'PLAYLIST_EDIT')).toBe(false)
    }
  })
  it('configuração válida conserva redução voluntária sem permitir elevação',()=>{
    config.role='SUPERVISOR';database=openDatabase(':memory:');const access=new AccessControl(database.sqlite)
    expect(access.role({headers:{}})).toBe('SUPERVISOR')
    expect(access.role({headers:{'x-rplayout-role':'ADMIN'}})).toBe('SUPERVISOR')
    expect(access.role({headers:{'x-rplayout-role':'OPERATOR'}})).toBe('OPERATOR')
  })
})

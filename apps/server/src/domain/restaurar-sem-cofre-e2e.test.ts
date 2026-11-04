import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {openDatabase} from '../db/client.js'
import {graphicCommandPendingExpectedSql} from '../db/graphic-command-pending.js'
import {installationVault} from './secret-vault.js'
import {createApp} from '../app.js'
vi.mock('../config.js',async original=>({...await original<Record<string,unknown>>(),ENGINE_BINARY:'',MEDIAMTX_BINARY:'',DEVICES_BINARY:''}))

const require=createRequire(import.meta.url)
const tool=require(resolve(__dirname,'../../../../scripts/restaurar-sem-cofre.cjs')) as {main(argv:string[]):{rebuilt?:Record<string,number>};GRAPHIC_PENDING_EXPECTED:string}

let directory='',savedMode:string|undefined
beforeAll(()=>{savedMode=process.env.RPLAYOUT_STORAGE_MODE;process.env.RPLAYOUT_STORAGE_MODE='INLINE';directory=mkdtempSync(join(tmpdir(),'rplayout-rsc-e2e-'))})
afterAll(()=>{if(savedMode===undefined)delete process.env.RPLAYOUT_STORAGE_MODE;else process.env.RPLAYOUT_STORAGE_MODE=savedMode;rmSync(directory,{recursive:true,force:true})})

describe('restaurar-sem-cofre de ponta a ponta (backup r88-37, migração 58)',()=>{
  it('usa o mesmo predicado de "não resolvido" do servidor',()=>{
    expect(tool.GRAPHIC_PENDING_EXPECTED).toBe(graphicCommandPendingExpectedSql)
  })

  it('histórico cifrado + comando de grafismo aceito em claro sem resolução: o banco novo abre no servidor',async()=>{
    const source=join(directory,'backup.db'),target=join(directory,'novo.db')
    const now=new Date().toISOString()
    const seed=openDatabase(source)
    // Backup da r88-37: esquema até a migração 58 (a 59 só converte dados).
    seed.sqlite.prepare('DELETE FROM schema_migrations WHERE version>58').run()
    expect(seed.sqlite.prepare('SELECT max(version) v FROM schema_migrations').get()).toEqual({v:58})
    const enc=(value:string)=>installationVault().encrypt(value,'operator_decisions.payload')
    const insert=seed.sqlite.prepare('INSERT INTO operator_decisions(id,rundown_id,item_id,kind,payload,created_at) VALUES(?,?,NULL,?,?,?)')
    seed.sqlite.transaction(()=>{
      // Histórico antigo, ainda cifrado (r88-36).
      insert.run('velho-1','@http','API_MUTATION',enc(JSON.stringify({route:'/api/x'})),now)
      // Um comando antigo, cifrado e já resolvido.
      insert.run('g-velho:ACCEPTED','@graphics:c','GRAPHIC_COMMAND_ACCEPTED',enc('{}'),now)
      insert.run('g-velho:CONFIRMED','@graphics:c','GRAPHIC_COMMAND_CONFIRMED',enc('{}'),now)
      // Comandos novos, em claro: um aberto e um resolvido.
      insert.run('g-aberto:ACCEPTED','@graphics:c','GRAPHIC_COMMAND_ACCEPTED','{"command":"PLAY"}',now)
      insert.run('g-feito:ACCEPTED','@graphics:c','GRAPHIC_COMMAND_ACCEPTED','{"command":"STOP"}',now)
      insert.run('g-feito:CONFIRMED','@graphics:c','GRAPHIC_COMMAND_CONFIRMED','{}',now)
    })()
    expect(seed.sqlite.prepare('SELECT id FROM graphic_command_pending ORDER BY id').all()).toEqual([{id:'g-aberto:ACCEPTED'}])
    seed.sqlite.close()

    const report=tool.main([source,target])
    // A abertura chama validateGraphicCommandPending; antes da correção recusava
    // com "Índice de comandos pendentes diverge do histórico".
    const reopened=openDatabase(target)
    try{
      expect(report.rebuilt).toEqual({graphic_command_pending:1})
      expect(reopened.sqlite.prepare('SELECT id,scope FROM graphic_command_pending').all()).toEqual([{id:'g-aberto:ACCEPTED',scope:'@graphics:c'}])
      expect(reopened.sqlite.prepare("SELECT count(*) n FROM operator_decisions WHERE payload LIKE 'rplayout-secret:v1:%'").get()).toEqual({n:0})
      // Os gatilhos do índice continuam: a confirmação resolve o pendente.
      reopened.sqlite.prepare('INSERT INTO operator_decisions(id,rundown_id,item_id,kind,payload,created_at) VALUES(?,?,NULL,?,?,?)').run('g-aberto:REJECTED','@graphics:c','GRAPHIC_COMMAND_REJECTED','{}',now)
      expect(reopened.sqlite.prepare('SELECT count(*) n FROM graphic_command_pending').get()).toEqual({n:0})
    }finally{reopened.sqlite.close()}
    const app=await createApp(target)
    try{expect(app.sqlite.open).toBe(true)}finally{await app.close()}
  },60_000)
})

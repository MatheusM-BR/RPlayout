import Database from 'better-sqlite3'
import {afterEach,describe,expect,it} from 'vitest'
import {migrateProxyIntegrity} from './proxy-integrity.js'
let sqlite:Database.Database|undefined
afterEach(()=>sqlite?.close())
function legacy(){
  sqlite=new Database(':memory:')
  sqlite.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,created_at TEXT);
    CREATE TABLE media_jobs(id TEXT PRIMARY KEY,kind TEXT,state TEXT,output_path TEXT,error TEXT,updated_at TEXT);
    INSERT INTO media_jobs VALUES('proxy','PROXY','READY','unchanged.mp4',NULL,'old');
    INSERT INTO media_jobs VALUES('archive','ARCHIVE','READY','original.mp4',NULL,'old');`)
  return sqlite
}
describe('identidade persistida do proxy',()=>{
  it('migra legado sem certificar cache arbitrário, preservando arquivo e arquivo original',()=>{
    const db=legacy();migrateProxyIntegrity(db)
    expect(db.prepare('SELECT state,output_path,output_hash FROM media_jobs WHERE id=?').get('proxy')).toEqual({state:'FAILED',output_path:'unchanged.mp4',output_hash:null})
    expect(db.prepare('SELECT state,output_path FROM media_jobs WHERE id=?').get('archive')).toEqual({state:'READY',output_path:'original.mp4'})
    db.prepare("UPDATE media_jobs SET state='READY',output_hash=? WHERE id='proxy'").run('a'.repeat(64))
    migrateProxyIntegrity(db)
    expect(db.prepare("SELECT state FROM media_jobs WHERE id='proxy'").get()).toEqual({state:'READY'})
    expect(db.prepare('SELECT count(*) n FROM schema_migrations WHERE version=34').get()).toEqual({n:1})
  })
  it('recusa hash inválido no banco',()=>{
    const db=legacy();migrateProxyIntegrity(db)
    expect(()=>db.prepare("UPDATE media_jobs SET output_hash='not-a-sha'").run()).toThrow()
  })
  it('não aceita migração marcada com coluna removida',()=>{
    const db=legacy();db.prepare('INSERT INTO schema_migrations VALUES(34,?,?)').run('verified-proxy-cache-content','old')
    expect(()=>migrateProxyIntegrity(db)).toThrow('Identidade do cache')
  })
})

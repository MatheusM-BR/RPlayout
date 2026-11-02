import {it,expect,afterEach} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {writeStandaloneBackup} from './standalone-backup.js'
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
it('exporta origem WAL em arquivo fechado, sem mudar origem nem gerar auxiliares nas leituras',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rplayout-standalone-'));roots.push(root)
  const source=new Database(join(root,'live.db')),file=join(root,'backup.db')
  try{
    source.pragma('journal_mode=WAL');source.exec("CREATE TABLE t(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO t VALUES(1,'AÇÃO ☃')")
    await expect(writeStandaloneBackup(source,file)).resolves.toEqual({file,standalone:true})
    for(let i=0;i<2;i++){const reader=new Database(file,{readonly:true,fileMustExist:true});try{expect(reader.pragma('journal_mode',{simple:true})).toBe('delete');expect(reader.prepare('SELECT * FROM t').all()).toEqual([{id:1,value:'AÇÃO ☃'}])}finally{reader.close()}}
    expect(existsSync(file+'-wal')).toBe(false);expect(existsSync(file+'-shm')).toBe(false)
    expect(source.pragma('journal_mode',{simple:true})).toBe('wal');source.exec("INSERT INTO t VALUES(2,'continua')");expect(source.prepare('SELECT COUNT(*) n FROM t').get()).toEqual({n:2})
  }finally{source.close()}
})
it('não substitui destino existente nem converte o banco da origem',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rplayout-standalone-'));roots.push(root)
  const file=join(root,'keep.db');await writeFile(file,'preserve');const source=new Database(':memory:')
  try{await expect(writeStandaloneBackup(source,file)).rejects.toThrow();expect(await readFile(file,'utf8')).toBe('preserve')}finally{source.close()}
})

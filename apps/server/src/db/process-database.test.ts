import {mkdtempSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {ProcessDatabase} from './process-database.js'

// Real worker + isolated SQLite process from the compiled helpers.
const dist=resolve(__dirname,'../../dist')
const available=existsSync(join(dist,'storage-bridge.cjs'))&&existsSync(join(dist,'storage-service.cjs'))
let directory='',previous:string|undefined
beforeAll(()=>{previous=process.env.RPLAYOUT_STORAGE_BIN_DIR;process.env.RPLAYOUT_STORAGE_BIN_DIR=dist;directory=mkdtempSync(join(tmpdir(),'rplayout-process-db-'))})
afterAll(()=>{if(previous===undefined)delete process.env.RPLAYOUT_STORAGE_BIN_DIR;else process.env.RPLAYOUT_STORAGE_BIN_DIR=previous;rmSync(directory,{recursive:true,force:true})})
const calls=(db:ProcessDatabase)=>db.storageStatus().latency.calls

it.skipIf(!available)('prepare repetido não cruza o processo; DDL limpa e SQL inválido continua falhando',()=>{
  const db=new ProcessDatabase(join(directory,'a.db'))
  try{
    db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY,v TEXT)')
    db.prepare('INSERT INTO t(v) VALUES(?)').run('a')
    const before=calls(db)
    for(let i=0;i<10;i++)expect(db.prepare('SELECT v FROM t WHERE id=?').get(1)).toEqual({v:'a'})
    expect(calls(db)-before).toBe(11) // one prepare + ten reads
    const stmt=db.prepare('SELECT v FROM t WHERE id=?')
    expect(stmt.reader).toBe(true)
    expect(db.prepare('INSERT INTO t(v) VALUES(?)').reader).toBe(false)
    // Transaction control keeps the cache; DDL drops it and the gone table fails.
    db.transaction(()=>db.prepare('INSERT INTO t(v) VALUES(?)').run('b')).immediate()
    const mid=calls(db);db.prepare('SELECT v FROM t WHERE id=?').get(2);expect(calls(db)-mid).toBe(1)
    db.exec('DROP TABLE t')
    // The service already reused its own cached statement here before this
    // cache existed; what matters is that execution never returns stale rows.
    expect(()=>db.prepare('SELECT v FROM t WHERE id=?').get(1)).toThrow(/no such table/)
    expect(()=>db.prepare('SELECT v FROM t WHERE v=?')).toThrow(/no such table/)
    expect(()=>db.prepare('SELEC broken')).toThrow()
  }finally{db.close()}
})
it.skipIf(!available)('SQL invalidado por DDL de outra conexão falha na execução, sem resultado silencioso',()=>{
  const file=join(directory,'b.db'),a=new ProcessDatabase(file),b=new ProcessDatabase(file)
  try{
    a.exec('CREATE TABLE t(id INTEGER PRIMARY KEY)');a.prepare('INSERT INTO t VALUES(1)').run()
    expect(a.prepare('SELECT id FROM t').get()).toEqual({id:1})
    b.exec('DROP TABLE t')
    expect(()=>a.prepare('SELECT id FROM t').get()).toThrow(/no such table/)
  }finally{a.close();b.close()}
})

import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {inspectWal} from '../../../../scripts/lib/wal-evidence.js'

it('confere frames reais não commitados, checksum, truncamento e epoch sem reparar o WAL',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rplayout-wal-evidence-')),file=join(root,'qa.db'),db=new Database(file)
  try{
    db.pragma('journal_mode=WAL');db.pragma('wal_autocheckpoint=0');db.pragma('cache_size=10')
    db.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY,value TEXT)')
    const originalPages=Number(db.pragma('page_count',{simple:true})),insert=db.prepare('INSERT INTO fixture(value) VALUES(?)')
    db.exec('BEGIN IMMEDIATE')
    for(let i=0;i<1000;i++)insert.run('QA only '+i+'x'.repeat(2000))
    const bytes=await readFile(file+'-wal'),parsed=inspectWal(bytes)!
    expect(parsed.checksumValidated).toBe(true);expect(parsed.frames.some(frame=>frame.index>parsed.lastCommit&&frame.page>originalPages)).toBe(true)
    const final=parsed.frames.at(-1)!,offset=32+(final.index-1)*(24+parsed.pageSize)
    const corrupted=Buffer.from(bytes);corrupted[offset+24]!^=1
    expect(inspectWal(corrupted)!.frames.length).toBeLessThan(parsed.frames.length)
    const stale=Buffer.from(bytes);stale.writeUInt32BE((stale.readUInt32BE(offset+8)^1)>>>0,offset+8)
    expect(inspectWal(stale)!.frames.length).toBeLessThan(parsed.frames.length)
    expect(inspectWal(bytes.subarray(0,parsed.validBytes-1))!.frames.length).toBe(parsed.frames.length-1)
    const invalid=Buffer.from(bytes);invalid[0]=0;expect(inspectWal(invalid)).toBeNull()
    db.exec('ROLLBACK');expect(db.prepare('SELECT COUNT(*) AS n FROM fixture').get()).toEqual({n:0})
  }finally{if(db.inTransaction)db.exec('ROLLBACK');db.close();await rm(root,{recursive:true,force:true})}
})

import {it,expect} from 'vitest'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from '../db/client.js'
import {Ingest} from './ingest.js'
it('scanner inicia próximo PENDING após liberar o anterior, sem aguardar timer de60s',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'RPlayout-ingest-fifo-')),db=openDatabase(':memory:')
  const a=join(directory,'a'),b=join(directory,'b');mkdirSync(a);mkdirSync(b)
  const scanner=new Ingest(db.db,'unused-probe',join(directory,'.thumbs'),undefined,db.sqlite)
  try{
    for(const [id,path,created] of [['first',a,'2020-01-01'],['second',b,'2020-01-02']])db.sqlite.prepare("INSERT INTO ingest_batches(id,roots,measure,state,created_at,updated_at) VALUES(?,?,0,'PENDING',?,?)").run(id,JSON.stringify([path]),created,created)
    expect(scanner.resumePending()).toBe(true)
    const deadline=performance.now()+2000
    while(performance.now()<deadline&&(db.sqlite.prepare("SELECT COUNT(*) n FROM ingest_batches WHERE state='COMPLETED'").get() as {n:number}).n<2)await new Promise(resolve=>setTimeout(resolve,10))
    expect(db.sqlite.prepare('SELECT id,state FROM ingest_batches ORDER BY id').all()).toEqual([{id:'first',state:'COMPLETED'},{id:'second',state:'COMPLETED'}])
  }finally{await scanner.close();db.sqlite.close();rmSync(directory,{recursive:true,force:true})}
})

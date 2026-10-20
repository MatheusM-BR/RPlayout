import Database from 'better-sqlite3'
import {expect,it} from 'vitest'
import {backupOperationalState} from './backup-operational-state.js'
it('HELD is counted separately without granting resume or rewriting cursor',()=>{
  const db=new Database(':memory:')
  try{
    db.exec('CREATE TABLE channel_checkpoints(channel_id TEXT,payload TEXT)')
    const value={version:1,channelId:'c',rundownId:'r',revisionId:'rev',itemId:'i',elapsed:12,playing:false,realEngine:true,programTrim:{in:25,out:100,contentHash:'a'.repeat(64)},programHold:{status:'HELD',decoderId:7,frames:12}}
    const encoded=JSON.stringify(value);db.prepare('INSERT INTO channel_checkpoints VALUES(?,?)').run('c',encoded)
    expect(backupOperationalState(db)).toMatchObject({savedCheckpoints:1,savedPlayingCheckpoints:0,savedHeldCheckpoints:1,executionResumeAllowed:false})
    expect(db.prepare('SELECT payload FROM channel_checkpoints').get()).toEqual({payload:encoded})
  }finally{db.close()}
})
it('base antiga sem estado operacional não ganha autorização implícita',()=>{const db=new Database(':memory:');try{expect(backupOperationalState(db)).toMatchObject({savedCheckpoints:0,asRunRecords:0,executionResumeAllowed:false})}finally{db.close()}})
it('inventaria cursor salvo, edições e as-run aberto sem modificar dados',()=>{
  const db=new Database(':memory:')
  try{
    db.exec('CREATE TABLE channel_checkpoints(channel_id TEXT,payload TEXT);CREATE TABLE operational_playlist_revisions(active INTEGER);INSERT INTO operational_playlist_revisions VALUES(1),(0);CREATE TABLE as_run(ended_at TEXT);INSERT INTO as_run VALUES(NULL),(\'now\')')
    const value={version:1,channelId:'c',rundownId:'r',revisionId:'rev',itemId:'i',elapsed:12,playing:true,realEngine:true}
    db.prepare('INSERT INTO channel_checkpoints VALUES(?,?)').run('c',JSON.stringify(value))
    expect(backupOperationalState(db)).toEqual({savedCheckpoints:1,savedPlayingCheckpoints:1,savedHeldCheckpoints:0,publishedRevisions:2,activeRevisions:1,asRunRecords:2,openAsRunRecords:1,executionResumeAllowed:false})
    expect(db.prepare('SELECT payload FROM channel_checkpoints').get()).toEqual({payload:JSON.stringify(value)})
  }finally{db.close()}
})
it.each(['not-json',JSON.stringify({version:1,channelId:'foreign',rundownId:'r',revisionId:null,itemId:'i',elapsed:0,playing:true,realEngine:true})])('recusa cursor malformado ou de outro canal: %s',payload=>{const db=new Database(':memory:');try{db.exec('CREATE TABLE channel_checkpoints(channel_id TEXT,payload TEXT)');db.prepare('INSERT INTO channel_checkpoints VALUES(?,?)').run('c',payload);expect(()=>backupOperationalState(db)).toThrow()}finally{db.close()}})

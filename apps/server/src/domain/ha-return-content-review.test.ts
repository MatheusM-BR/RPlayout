// NOT_RUN: prepared fixtures, no execution/worker/hardware qualification.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {installationVault} from './secret-vault.js'
import {inspectReturnContent} from './ha-return-content-review.js'
import type {HaSnapshot} from './ha-replication.js'
const payload={version:1,rate:{num:25,den:1},audioChannels:2,rundown:{id:'r',channelId:'ch'},items:[{id:'i',rundownId:'r'}],schedule:{},privateValue:'never-return'}
function fixture(){
  const db=new Database(':memory:')
  db.exec('CREATE TABLE rundowns(id TEXT PRIMARY KEY,channel_id TEXT); CREATE TABLE operational_playlist_revisions(id TEXT PRIMARY KEY,rundown_id TEXT,payload TEXT,active INTEGER DEFAULT 1); CREATE TABLE channel_checkpoints(channel_id TEXT PRIMARY KEY,payload TEXT); INSERT INTO rundowns VALUES(\'r\',\'ch\')')
  const vault=installationVault(false)
  db.prepare('INSERT INTO operational_playlist_revisions(id,rundown_id,payload) VALUES(?,?,?)').run('rev','r',vault.encrypt(JSON.stringify(payload),'operational_playlist_revisions.payload'))
  const cursor={version:1,channelId:'ch',rundownId:'r',revisionId:'rev',itemId:'i',elapsed:0,playing:false,realEngine:false}
  db.prepare('INSERT INTO channel_checkpoints VALUES(?,?)').run('ch',JSON.stringify(cursor))
  const baseline:HaSnapshot={version:1,capturedAt:'2026-10-11T00:00:00.000Z',channels:[{channelId:'ch',configuration:{},revisions:[{id:'rev',rundownId:'r',payload}],checkpoint:{value:cursor,savedAt:'ignored'},transport:null,blockers:{}}],asRun:[],journals:[]}
  return {db,baseline,cursor,vault}
}
it('compara payload/checkpoint sem divulgar conteúdo ou autorizar PGM — NOT_RUN',()=>{
  const {db,baseline}=fixture()
  try{const result=inspectReturnContent(db,'ch',baseline);expect(result.editions.matched).toBe(1);expect(result.checkpoint.equal).toBe(true);expect(result.checkpoint.referencedItemPresent).toBe(true);expect(result.contentApproved).toBe(false);expect(result.authorityTransferred).toBe(false);expect(JSON.stringify(result)).not.toContain('never-return')}
  finally{db.close()}
})
it('mesmo ID com conteúdo diferente não é declarado igual — NOT_RUN',()=>{
  const {db,baseline,vault}=fixture()
  try{db.prepare('UPDATE operational_playlist_revisions SET payload=?').run(vault.encrypt(JSON.stringify({...payload,operation:{kind:'changed'}}),'operational_playlist_revisions.payload'));const result=inspectReturnContent(db,'ch',baseline);expect(result.editions.changed).toBe(1);expect(result.editions.details[0]!.changedFields).toContain('operation');expect(result.editions.payloadsApproved).toBe(false)}
  finally{db.close()}
})
it('cursor com item inexistente é diagnosticado, não selecionado — NOT_RUN',()=>{
  const {db,baseline,cursor}=fixture()
  try{db.prepare('UPDATE channel_checkpoints SET payload=?').run(JSON.stringify({...cursor,itemId:'missing'}));const result=inspectReturnContent(db,'ch',baseline);expect(result.checkpoint.referencedItemPresent).toBe(false);expect(result.checkpoint.equal).toBe(false);expect(result.checkpoint.cursorSelected).toBe(false)}
  finally{db.close()}
})

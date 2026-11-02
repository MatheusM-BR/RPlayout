import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {reviewRollbackAsRun} from './rollback-asrun-review.js'
// NOT_RUN: added to the consolidated review; no installer/hardware qualification.
function fixture(){const db=new Database(':memory:');db.exec('CREATE TABLE as_run(id TEXT PRIMARY KEY,channel_id TEXT,title TEXT,ended_at TEXT)');return db}
function add(db:Database.Database,id:string,end:string|null='2026-10-10T12:00:00Z'){db.prepare('INSERT INTO as_run VALUES(?,?,?,?)').run(id,'channel','VT '+id,end)}
it('detects new, changed and missing execution evidence without changing either database',()=>{
  const previous=fixture(),current=fixture()
  try{
    add(previous,'same');add(current,'same');add(previous,'finished',null);add(current,'finished');add(previous,'missing');add(current,'new')
    const before=JSON.stringify(previous.prepare('SELECT * FROM as_run ORDER BY id').all()),now=JSON.stringify(current.prepare('SELECT * FROM as_run ORDER BY id').all())
    const result=reviewRollbackAsRun(previous,current)
    expect(result).toMatchObject({newRecords:1,changedRecords:1,missingRecords:1,unchangedRecords:1,priorOpen:1,currentOpen:0,totalDifferences:3,historyReconciliationRequired:true,historyMerged:false,automaticTake:false,rollbackReady:false})
    expect(result.differences.map(row=>row.kind).sort()).toEqual(['ABSENT_FROM_CURRENT','AFTER_UPGRADE','CHANGED'])
    expect(JSON.stringify(previous.prepare('SELECT * FROM as_run ORDER BY id').all())).toBe(before)
    expect(JSON.stringify(current.prepare('SELECT * FROM as_run ORDER BY id').all())).toBe(now)
  }finally{previous.close();current.close()}
})
it('equal history does not establish binary compatibility or authorize rollback',()=>{
  const previous=fixture(),current=fixture()
  try{add(previous,'same');add(current,'same');expect(reviewRollbackAsRun(previous,current)).toMatchObject({totalDifferences:0,historyReconciliationRequired:false,rollbackReady:false})}
  finally{previous.close();current.close()}
})
it('caps displayed details but keeps full counts and a deterministic inventory hash',()=>{
  const previous=fixture(),current=fixture()
  try{
    current.transaction(()=>{for(let i=0;i<1003;i++)add(current,String(i))})()
    const result=reviewRollbackAsRun(previous,current)
    expect(result).toMatchObject({newRecords:1003,totalDifferences:1003,detailsTruncated:true})
    expect(result.differences).toHaveLength(1000)
    expect(reviewRollbackAsRun(previous,current).differenceInventoryHash).toBe(result.differenceInventoryHash)
  }finally{previous.close();current.close()}
})
it('does not silently accept missing as-run identities',()=>{
  const previous=fixture(),current=new Database(':memory:')
  try{expect(()=>reviewRollbackAsRun(previous,current)).toThrow('incompatível')}
  finally{previous.close();current.close()}
})
it('a changed evidence schema requires review even when existing rows contain only null in the new field',()=>{
  const previous=fixture(),current=fixture()
  try{
    add(previous,'same');add(current,'same');current.exec('ALTER TABLE as_run ADD COLUMN execution_id TEXT')
    expect(reviewRollbackAsRun(previous,current)).toMatchObject({totalDifferences:0,columnsAdded:['execution_id'],historyReconciliationRequired:true,rollbackReady:false})
  }finally{previous.close();current.close()}
})
it('an identical but still open occurrence cannot be treated as reconciled',()=>{
  const previous=fixture(),current=fixture()
  try{add(previous,'live',null);add(current,'live',null);expect(reviewRollbackAsRun(previous,current)).toMatchObject({totalDifferences:0,currentOpen:1,priorOpen:1,historyReconciliationRequired:true,rollbackReady:false})}
  finally{previous.close();current.close()}
})

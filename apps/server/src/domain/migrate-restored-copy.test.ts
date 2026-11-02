import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {installationVault} from './secret-vault.js'
import {assertNoInterruptedRestoredMigration} from './migrate-restored-copy.js'
// NOT_RUN. Journal-only fixtures, not native admission/migration proof.
function fixture(){const db=new Database(':memory:');db.exec('CREATE TABLE operator_decisions(kind TEXT,payload TEXT)');return db}
function append(db:Database.Database,phase:string,restorationId='restore',id='migration',kind=phase){db.prepare('INSERT INTO operator_decisions VALUES(?,?)').run(kind,installationVault().encrypt(JSON.stringify({version:1,id,restorationId,phase,automaticTake:false}),'operator_decisions.payload'))}
it('unfinished migration blocks review, while correlated terminal result preserves history',()=>{
  const db=fixture();try{
    append(db,'RESTORED_SCHEMA_MIGRATION_STARTED')
    expect(()=>assertNoInterruptedRestoredMigration(db)).toThrow('interrompida')
    append(db,'RESTORED_SCHEMA_MIGRATION_CONFIRMED')
    expect(()=>assertNoInterruptedRestoredMigration(db)).not.toThrow()
    expect(db.prepare('SELECT count(*) n FROM operator_decisions').get()).toEqual({n:2})
  }finally{db.close()}
})
it('changed phase or restoration origin cannot clear an unrelated pending intent',()=>{
  const db=fixture();try{
    append(db,'RESTORED_SCHEMA_MIGRATION_STARTED')
    append(db,'RESTORED_SCHEMA_MIGRATION_REFUSED','another-restoration')
    expect(()=>assertNoInterruptedRestoredMigration(db)).toThrow('correspondente')
  }finally{db.close()}
  const other=fixture();try{
    append(other,'RESTORED_SCHEMA_MIGRATION_STARTED','restore','migration','RESTORED_SCHEMA_MIGRATION_CONFIRMED')
    expect(()=>assertNoInterruptedRestoredMigration(other)).toThrow('inválido')
  }finally{other.close()}
})

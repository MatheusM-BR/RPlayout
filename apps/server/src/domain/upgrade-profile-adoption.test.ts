import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {installationVault} from './secret-vault.js'
import {assertNoUncertainUpgradeProfile} from './upgrade-profile-adoption.js'
// NOT_RUN: journal-only fixtures, not native/file publication qualification.
function fixture(){const db=new Database(':memory:');db.exec('CREATE TABLE operator_decisions(kind TEXT,payload TEXT)');return db}
function append(db:Database.Database,phase:string,id='adoption',kind=phase,activationId='activation'){db.prepare('INSERT INTO operator_decisions VALUES(?,?)').run(kind,installationVault().encrypt(JSON.stringify({version:1,id,phase,activationId}),'operator_decisions.payload'))}
it('startup refuses an interrupted or uncertain profile publication',()=>{
  const db=fixture();try{
    append(db,'UPGRADE_PROFILE_STARTED')
    expect(()=>assertNoUncertainUpgradeProfile(db)).toThrow('interrompida')
    append(db,'UPGRADE_PROFILE_UNCERTAIN')
    expect(()=>assertNoUncertainUpgradeProfile(db)).toThrow('interrompida')
  }finally{db.close()}
})
it('matching confirmed result clears only its own intent and preserves records',()=>{
  const db=fixture();try{
    append(db,'UPGRADE_PROFILE_STARTED');append(db,'UPGRADE_PROFILE_CONFIRMED')
    expect(()=>assertNoUncertainUpgradeProfile(db)).not.toThrow()
    append(db,'UPGRADE_PROFILE_STARTED','other')
    expect(()=>assertNoUncertainUpgradeProfile(db)).toThrow('interrompida')
    expect(db.prepare('SELECT count(*) n FROM operator_decisions').get()).toEqual({n:3})
  }finally{db.close()}
})
it('phase tampering or an orphaned completion cannot authorize opening',()=>{
  const db=fixture();try{
    append(db,'UPGRADE_PROFILE_STARTED','adoption','UPGRADE_PROFILE_CONFIRMED')
    expect(()=>assertNoUncertainUpgradeProfile(db)).toThrow('inválido')
  }finally{db.close()}
  const other=fixture();try{
    append(other,'UPGRADE_PROFILE_REFUSED')
    expect(()=>assertNoUncertainUpgradeProfile(other)).toThrow('sem intenção')
  }finally{other.close()}
})
it('a terminal record for another activation cannot clear an existing intent',()=>{
  const db=fixture();try{
    append(db,'UPGRADE_PROFILE_STARTED')
    append(db,'UPGRADE_PROFILE_CONFIRMED','adoption','UPGRADE_PROFILE_CONFIRMED','other-activation')
    expect(()=>assertNoUncertainUpgradeProfile(db)).toThrow('correspondente')
  }finally{db.close()}
})

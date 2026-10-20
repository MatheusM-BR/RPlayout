import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {assertSchemaCompatibility,supportedSchemaMigrations} from './schema-compatibility.js'
// NOT_RUN: prepared for the consolidated review, not per-change validation.
function fixture(){const db=new Database(':memory:');db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)');return db}
it('accepts known historical migrations without claiming current readiness',()=>{
  const db=fixture();try{
    db.prepare('INSERT INTO schema_migrations VALUES(1,?,?)').run(supportedSchemaMigrations[0],'old')
    expect(assertSchemaCompatibility(db)).toMatchObject({current:false,migrationRequired:true,rollbackReady:false})
    expect(()=>assertSchemaCompatibility(db,true)).toThrow('migração isolada')
  }finally{db.close()}
})
it('refuses a newer or renamed marker without removing it or applying schema',()=>{
  const db=fixture();try{
    db.prepare('INSERT INTO schema_migrations VALUES(999,?,?)').run('future-edition','now')
    expect(()=>assertSchemaCompatibility(db)).toThrow('outra versão')
    expect(db.prepare('SELECT name FROM schema_migrations WHERE version=999').get()).toEqual({name:'future-edition'})
    db.exec('DELETE FROM schema_migrations');db.prepare('INSERT INTO schema_migrations VALUES(1,?,?)').run('wrong-identity','now')
    expect(()=>assertSchemaCompatibility(db)).toThrow('outra versão')
  }finally{db.close()}
})
it('requires every supported migration for current readiness, not only maximum version',()=>{
  const db=fixture();try{
    const insert=db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)')
    for(const [index,name] of supportedSchemaMigrations.entries())insert.run(index+1,name,'now')
    expect(assertSchemaCompatibility(db,true).current).toBe(true)
    db.exec('DELETE FROM schema_migrations WHERE version=20')
    expect(()=>assertSchemaCompatibility(db,true)).toThrow('migração isolada')
  }finally{db.close()}
})

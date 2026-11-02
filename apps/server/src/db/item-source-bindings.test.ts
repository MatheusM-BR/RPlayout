import Database from 'better-sqlite3'
import {expect,it} from 'vitest'
import {migrateItemSourceBindings} from './item-source-bindings.js'

it('adds nullable identity without guessing legacy bindings and is repeatable',()=>{
  const sqlite=new Database(':memory:')
  try {
    sqlite.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); CREATE TABLE rundown_items(id TEXT PRIMARY KEY,source_ref TEXT); INSERT INTO rundown_items VALUES (\'old\',\'ndi:CAM\')')
    migrateItemSourceBindings(sqlite);migrateItemSourceBindings(sqlite)
    expect(sqlite.prepare('SELECT configured_source_id FROM rundown_items WHERE id=?').get('old')).toEqual({configured_source_id:null})
    sqlite.prepare('UPDATE rundown_items SET configured_source_id=? WHERE id=?').run('selected','old')
    expect(sqlite.prepare('SELECT configured_source_id FROM rundown_items WHERE id=?').get('old')).toEqual({configured_source_id:'selected'})
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=45').get()).toEqual({n:1})
  } finally {sqlite.close()}
})

it('does not trust a migration marker when its column is missing',()=>{
  const sqlite=new Database(':memory:')
  try{
    sqlite.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); CREATE TABLE rundown_items(id TEXT); INSERT INTO schema_migrations VALUES(45,'marker','now')")
    expect(()=>migrateItemSourceBindings(sqlite)).toThrow('Schema da identidade de entrada inválido')
  }finally{sqlite.close()}
})

import Database from 'better-sqlite3'
import {it,expect} from 'vitest'
import {migrateCategoryRevisions} from './category-revisions.js'
it('migração idempotente preserva categorias e invalida same-value, ABA e alterações de vínculos',()=>{
  const db=new Database(':memory:')
  try{
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);CREATE TABLE categories(id TEXT PRIMARY KEY,color TEXT,created_at TEXT);CREATE TABLE media_assets(id TEXT PRIMARY KEY,category_id TEXT);INSERT INTO categories VALUES('A','#112233','old');INSERT INTO media_assets VALUES('a','A')")
    migrateCategoryRevisions(db);const read=()=>Number((db.prepare('SELECT version FROM category_revision').get() as {version:number}).version),first=read()
    migrateCategoryRevisions(db);expect(read()).toBe(first)
    db.exec('UPDATE categories SET color=color');expect(read()).toBe(first+1)
    db.exec("DELETE FROM categories;INSERT INTO categories VALUES('A','#112233','old');UPDATE media_assets SET category_id=category_id")
    expect(read()).toBe(first+4);expect(db.prepare('SELECT id,color FROM categories').get()).toEqual({id:'A',color:'#112233'})
    db.exec('DROP TRIGGER category_revision_categories_update');expect(()=>migrateCategoryRevisions(db)).toThrow('incompleta')
  }finally{db.close()}
})

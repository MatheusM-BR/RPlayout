import Database from 'better-sqlite3'
import {expect,it} from 'vitest'
import {migrateProxyRecipe} from './proxy-recipe.js'
it('migra caches legados sem apagar arquivos, histórico ou aprovar receita por inferência',()=>{
  const db=new Database(':memory:')
  try{
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT); CREATE TABLE media_jobs(id TEXT,state TEXT,output_path TEXT); INSERT INTO media_jobs VALUES('old','READY','kept.mp4')")
    migrateProxyRecipe(db);migrateProxyRecipe(db)
    expect(db.prepare('SELECT * FROM media_jobs').get()).toEqual({id:'old',state:'READY',output_path:'kept.mp4',proxy_recipe:null})
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=46').get()).toEqual({n:1})
  }finally{db.close()}
})
it('marker existente não esconde schema de receita ausente',()=>{
  const db=new Database(':memory:')
  try{
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);INSERT INTO schema_migrations VALUES(46,'bad','now');CREATE TABLE media_jobs(id TEXT)")
    expect(()=>migrateProxyRecipe(db)).toThrow('Schema da receita de proxy inválido')
  }finally{db.close()}
})

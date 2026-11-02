import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'
import {hasRevisionMigration,validateSingletonRevision} from './revision-validation.js'
export function migrateCategoryRevisions(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=36').get())return
    sqlite.exec('CREATE TABLE category_revision(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version>0))')
    sqlite.prepare('INSERT INTO category_revision VALUES(1,?)').run(randomInt(2**40,2**48))
    for(const [table,operations] of [['categories',['INSERT','UPDATE','DELETE']],['media_assets',['INSERT','UPDATE OF category_id','DELETE']]] as const){
      for(const operation of operations){const name=`category_revision_${table}_${operation.split(' ')[0]!.toLowerCase()}`
        sqlite.exec(`CREATE TRIGGER ${name} AFTER ${operation} ON ${table} BEGIN UPDATE category_revision SET version=version+1 WHERE singleton=1; END`)
      }
    }
    sqlite.prepare('INSERT INTO schema_migrations VALUES(36,?,?)').run('durable-category-original-review',new Date().toISOString())
  }).immediate()
  validateCategoryRevisions(sqlite)
}
export function validateCategoryRevisions(sqlite:Database.Database):void {
  if(!hasRevisionMigration(sqlite,36,['category_revision']))return
  validateSingletonRevision(sqlite,'category_revision','Revisão das categorias ausente ou inválida.')
  for(const table of ['categories','media_assets'])for(const operation of ['insert','update','delete'])if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(`category_revision_${table}_${operation}`))throw new Error('Proteção de revisões de categorias incompleta.')
}

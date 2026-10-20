import Database from 'better-sqlite3'
import {afterEach,expect,it} from 'vitest'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {migrateCategoryRevisions} from '../db/category-revisions.js'
import {migrateIntegrationRevisions} from '../db/integration-revisions.js'
import {migrateRootRevisions} from '../db/root-revisions.js'
import {migrateScanRevisions} from '../db/scan-revisions.js'
import {validateBackupRestore} from './backup.js'

const directories:string[]=[]
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true})})
async function fixture(mutate:(db:Database.Database)=>void){
  const directory=await mkdtemp(join(tmpdir(),'rplayout-backup-revisions-'));directories.push(directory)
  const file=join(directory,'original.db'),db=new Database(file)
  try{
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);
      CREATE TABLE categories(id TEXT PRIMARY KEY);CREATE TABLE media_assets(id TEXT PRIMARY KEY,category_id TEXT);
      CREATE TABLE media_roots(id TEXT PRIMARY KEY,path TEXT);CREATE TABLE ingest_batches(id TEXT PRIMARY KEY,state TEXT);
      CREATE TABLE integrations(id TEXT PRIMARY KEY);CREATE TABLE integration_deliveries(id TEXT PRIMARY KEY,state TEXT,last_error TEXT);
      INSERT INTO categories VALUES('AÇÃO');INSERT INTO media_roots VALUES('r','C:\\Mídia\\São José');
      INSERT INTO integration_deliveries VALUES('kept','PENDING',NULL);INSERT INTO integration_deliveries VALUES('removed','PENDING',NULL);`)
    migrateCategoryRevisions(db);migrateIntegrationRevisions(db);migrateRootRevisions(db);migrateScanRevisions(db)
    db.exec("DELETE FROM integration_deliveries WHERE id='removed'")
    mutate(db)
  }finally{db.close()}
  return file
}

it('restaura revisões recentes e tombstone sem alterar o arquivo original',async()=>{
  const file=await fixture(()=>{}),before=await readFile(file)
  const validation=await validateBackupRestore(file)
  expect(validation.tables.integration_delivery_versions).toBe(2)
  expect(validation.tables.integration_deliveries).toBe(1)
  expect(await readFile(file)).toEqual(before)
})
it.each([
  'category_revision_categories_update','integration_delivery_revision_delete','root_revision_update','scan_revision_insert',
])('recusa backup com proteção ausente: %s',async name=>{
  const file=await fixture(db=>db.exec(`DROP TRIGGER ${name}`)),before=await readFile(file)
  await expect(validateBackupRestore(file)).rejects.toThrow('incompleta')
  expect(await readFile(file)).toEqual(before)
})
it.each([36,37,38,40])('não confunde registro de migração %i apagado com backup antigo',async version=>{
  const file=await fixture(db=>db.prepare('DELETE FROM schema_migrations WHERE version=?').run(version))
  await expect(validateBackupRestore(file)).rejects.toThrow('registro ausente')
})
it.each(['category_revision','integration_revision','root_revision','scan_revision'])('recusa contador ausente: %s',async table=>{
  const file=await fixture(db=>db.exec(`DELETE FROM ${table}`))
  await expect(validateBackupRestore(file)).rejects.toThrow()
})
it('recusa entrega sem revisão, não cria uma revisão substituta',async()=>{
  const file=await fixture(db=>db.exec("DELETE FROM integration_delivery_versions WHERE id='kept'"))
  await expect(validateBackupRestore(file)).rejects.toThrow('entregas incompletas')
})
it('recusa revisão histórica fora da faixa segura, mesmo sendo tombstone',async()=>{
  const file=await fixture(db=>db.exec("UPDATE integration_delivery_versions SET version=9007199254740992 WHERE id='removed'"))
  await expect(validateBackupRestore(file)).rejects.toThrow('entrega inválida')
})

import type Database from 'better-sqlite3'
import {randomInt} from 'node:crypto'

const MAX_VERSION=Number.MAX_SAFE_INTEGER
const tableSql=`CREATE TABLE editorial_revision_counters(
      scope TEXT NOT NULL CHECK(scope IN ('RUNDOWN','ITEM')),
      rundown_id TEXT NOT NULL,
      item_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND ${MAX_VERSION}),
      PRIMARY KEY(scope,rundown_id,item_id),CHECK(scope<>'RUNDOWN' OR item_id=''))`
const normalizeSql=(sql:string)=>sql.replace(/\s+/g,' ').trim()
const key="ON CONFLICT(scope,rundown_id,item_id) DO UPDATE SET version=version+1"
const exists=(id:string,where:string)=>`WHERE EXISTS (SELECT 1 FROM rundowns WHERE id=${id}) ${where?`AND (${where.replace(/^WHERE /,'')})`:''}`
const grade=(id:string,where='')=>`INSERT INTO editorial_revision_counters(scope,rundown_id,item_id,version) SELECT 'RUNDOWN',${id},'',1 ${exists(id,where)} ${key};`
const line=(rid:string,iid:string,where='')=>`INSERT INTO editorial_revision_counters(scope,rundown_id,item_id,version) SELECT 'ITEM',${rid},${iid},1 ${exists(rid,where)} ${key};`
const dependency=(selection:string)=>`
  INSERT INTO editorial_revision_counters(scope,rundown_id,item_id,version)
    SELECT DISTINCT 'RUNDOWN',rundown_id,'',1 FROM (${selection}) WHERE 1 ${key};
  INSERT INTO editorial_revision_counters(scope,rundown_id,item_id,version)
    SELECT DISTINCT 'ITEM',rundown_id,id,1 FROM (${selection}) WHERE 1 ${key};`
const triggers:Record<string,string>={
  editorial_grade_insert:`AFTER INSERT ON rundowns BEGIN ${grade('NEW.id')} END`,
  editorial_grade_update:`AFTER UPDATE ON rundowns BEGIN ${grade('NEW.id')} END`,
  editorial_grade_delete:`BEFORE DELETE ON rundowns BEGIN ${grade('OLD.id')} END`,
  editorial_item_insert:`AFTER INSERT ON rundown_items BEGIN ${grade('NEW.rundown_id')}${line('NEW.rundown_id','NEW.id')} END`,
  editorial_item_delete:`BEFORE DELETE ON rundown_items BEGIN ${grade('OLD.rundown_id')}${line('OLD.rundown_id','OLD.id')} END`,
  editorial_item_update:`AFTER UPDATE ON rundown_items BEGIN
    ${grade('OLD.rundown_id','WHERE OLD.rundown_id <> NEW.rundown_id')}
    ${line('OLD.rundown_id','OLD.id','WHERE OLD.rundown_id <> NEW.rundown_id OR OLD.id <> NEW.id')}
    ${grade('NEW.rundown_id')}${line('NEW.rundown_id','NEW.id')} END`,
}
for(const action of ['INSERT','UPDATE','DELETE'] as const){
  const row=action==='DELETE'?'OLD':'NEW',timing=action==='DELETE'?'BEFORE':'AFTER',suffix=action.toLowerCase()
  triggers[`editorial_media_${suffix}`]=`${timing} ${action} ON media_assets BEGIN ${dependency(`SELECT id,rundown_id FROM rundown_items WHERE media_id=${row}.id`)} END`
  triggers[`editorial_cue_${suffix}`]=`${timing} ${action} ON item_graphics BEGIN
    ${dependency(`SELECT id,rundown_id FROM rundown_items WHERE id=${row}.item_id ${action==='UPDATE'?'OR id=OLD.item_id':''}`)} END`
  triggers[`editorial_secondary_${suffix}`]=`${timing} ${action} ON secondary_events BEGIN
    ${dependency(`SELECT id,rundown_id FROM rundown_items WHERE id=${row}.item_id ${action==='UPDATE'?'OR id=OLD.item_id':''}`)} END`
  triggers[`editorial_qc_${suffix}`]=`${timing} ${action} ON qc_decisions BEGIN
    ${dependency(`SELECT i.id,i.rundown_id FROM rundown_items i JOIN rundowns r ON r.id=i.rundown_id WHERE (i.media_id=${row}.asset_id AND r.channel_id=${row}.channel_id) ${action==='UPDATE'?'OR (i.media_id=OLD.asset_id AND r.channel_id=OLD.channel_id)':''}`)} END`
}
for(const action of ['UPDATE','DELETE'] as const){
  // Secondary definitions are encrypted. Do not parse ciphertext in SQL: a
  // template edit conservatively invalidates grades containing secondaries.
  triggers[`editorial_template_${action.toLowerCase()}`]=`${action==='DELETE'?'BEFORE':'AFTER'} ${action} ON graphic_templates BEGIN
    ${dependency(`SELECT i.id,i.rundown_id FROM rundown_items i WHERE i.id IN (SELECT item_id FROM item_graphics WHERE template_id=OLD.id UNION SELECT item_id FROM secondary_events)`)} END`
}
triggers.editorial_channel_update=`AFTER UPDATE ON channels BEGIN
  ${dependency('SELECT i.id,i.rundown_id FROM rundown_items i JOIN rundowns r ON r.id=i.rundown_id WHERE r.channel_id=NEW.id')}
  INSERT INTO editorial_revision_counters(scope,rundown_id,item_id,version)
    SELECT 'RUNDOWN',id,'',1 FROM rundowns WHERE channel_id=NEW.id AND NOT EXISTS (SELECT 1 FROM rundown_items WHERE rundown_id=rundowns.id) ${key}; END`
// Migration 17 shipped its channel-scoped trigger contract. Preserve that
// contract for validation, then explicitly upgrade global (@all) QC effects.
const globalQcTriggers=Object.fromEntries(Object.entries(triggers).filter(([name])=>name.startsWith('editorial_qc_')).map(([name,body])=>[name,body.replace(/r.channel_id=(NEW|OLD)\.channel_id/g,"(r.channel_id=$1.channel_id OR $1.channel_id='@all')")]))

export function validateEditorialRevisions(sqlite:Database.Database):void{
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get() || !sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=17').get())return
  const globalQc=Boolean(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=18').get())
  const table=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='editorial_revision_counters'").get() as {sql:string}|undefined
  if(!table)throw new Error('Banco incompleto: falta tabela editorial_revision_counters da migração 17.')
  if(normalizeSql(table.sql)!==normalizeSql(tableSql))throw new Error('Estrutura de revisões editoriais alterada; restaure um backup validado.')
  for(const [name,body] of Object.entries(triggers)){
    const stored=sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name) as {sql:string}|undefined
    if(!stored)throw new Error(`Banco incompleto: falta proteção de revisão ${name}.`)
    if(normalizeSql(stored.sql)!==normalizeSql(`CREATE TRIGGER ${name} ${globalQc?globalQcTriggers[name]??body:body}`))throw new Error(`Proteção de revisão ${name} foi alterada; restaure um backup validado.`)
  }
  const invalid=sqlite.prepare("SELECT 1 FROM editorial_revision_counters WHERE version<1 OR version>? OR typeof(version)<>'integer' LIMIT 1").get(MAX_VERSION)
  if(invalid)throw new Error('Revisão editorial inválida; restaure um backup validado antes de editar.')
  const missingGrade=sqlite.prepare("SELECT 1 FROM rundowns r WHERE NOT EXISTS (SELECT 1 FROM editorial_revision_counters v WHERE v.scope='RUNDOWN' AND v.rundown_id=r.id AND v.item_id='') LIMIT 1").get()
  const missingItem=sqlite.prepare("SELECT 1 FROM rundown_items i WHERE NOT EXISTS (SELECT 1 FROM editorial_revision_counters v WHERE v.scope='ITEM' AND v.rundown_id=i.rundown_id AND v.item_id=i.id) LIMIT 1").get()
  if(missingGrade || missingItem)throw new Error('Revisões editoriais incompletas; nenhuma edição pode usar uma revisão inventada.')
}

/** Database triggers are the source of truth: all writers (legacy/modern,
 * ingest/QC/undo/import) change counters in the same SQLite transaction.
 * Grade and item tombstones survive removal/reinsertion (including undo),
 * preventing old ETag reuse. They intentionally have no parent foreign key. */
export function migrateEditorialRevisions(sqlite:Database.Database):void{
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=17').get()){
  sqlite.transaction(()=>{
    // Old memory counters cannot be recovered. Existing grades receive a new
    // large random baseline, not "1": invalidate pre-upgrade ETags without
    // inventing a count of historical edits. New grades start at 1 normally.
    const baseline=randomInt(2**40,2**48)
    sqlite.exec(`${tableSql};
      INSERT INTO editorial_revision_counters SELECT 'RUNDOWN',id,'',${baseline} FROM rundowns;
      INSERT INTO editorial_revision_counters SELECT 'ITEM',rundown_id,id,${baseline} FROM rundown_items;`)
    for(const [name,body] of Object.entries(triggers))sqlite.exec(`CREATE TRIGGER ${name} ${body}`)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(17,?,?)').run('durable-editorial-revisions-all-writers',new Date().toISOString())
  })()
  }
  validateEditorialRevisions(sqlite)
  if(!sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=18').get()){
    sqlite.transaction(()=>{
      for(const [name,body] of Object.entries(globalQcTriggers))sqlite.exec(`DROP TRIGGER ${name}; CREATE TRIGGER ${name} ${body}`)
      // Invalidate possibly stale pre-upgrade reads; this is not an edit count.
      sqlite.exec('UPDATE editorial_revision_counters SET version=version+1')
      sqlite.prepare('INSERT INTO schema_migrations VALUES(18,?,?)').run('global-qc-editorial-revision-invalidation',new Date().toISOString())
    })()
  }
  validateEditorialRevisions(sqlite)
}

export class EditorialVersions {
  constructor(private readonly sqlite:Database.Database){}
  read(rundownId:string,itemId?:string):number{
    const row=this.sqlite.prepare('SELECT version FROM editorial_revision_counters WHERE scope=? AND rundown_id=? AND item_id=?').get(itemId===undefined?'RUNDOWN':'ITEM',rundownId,itemId??'') as {version:number}|undefined
    if(!row || !Number.isSafeInteger(row.version) || row.version<1)throw new Error('Revisão editorial ausente ou inválida. Atualize a grade antes de editar.')
    return row.version
  }
}

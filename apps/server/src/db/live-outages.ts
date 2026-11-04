import type Database from 'better-sqlite3'
import {displaySourceAddress,storedSourceKey,STORED_SOURCE_KEY_PREFIX} from '../domain/source-address.js'
import {containsCredential} from '../domain/credential-detection.js'
/** Migração 57: paradas das entradas ao vivo, presas ao registro as-run do
 * item que estava no ar. Tabela nova, só aditiva. */
const table='CREATE TABLE live_outages(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,as_run_id TEXT,item_id TEXT,source_key TEXT NOT NULL,source_name TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,reasons TEXT NOT NULL,action TEXT NOT NULL,closed_by TEXT,created_at TEXT NOT NULL)'
const index='CREATE INDEX live_outages_as_run ON live_outages(as_run_id,started_at)'
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim()
export function validateLiveOutages(sqlite:Database.Database){
  const marked=sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations' AND type='table'").get()&&sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=57').get()
  const found=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='live_outages' AND type='table'").get() as {sql:string}|undefined
  if(!marked){if(found)throw new Error('Paradas do ao vivo sem registro de migração; preserve o banco.');return}
  const idx=sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='live_outages_as_run' AND type='index'").get() as {sql:string}|undefined
  if(!found||normalize(found.sql)!==table||!idx||normalize(idx.sql)!==index)throw new Error('Schema das paradas do ao vivo ausente/adulterado.')
}
export function migrateLiveOutages(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=57').get())return
    validateLiveOutages(sqlite)
    sqlite.exec(table);sqlite.exec(index)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(57,?,?)').run('live-input-outages-in-asrun',new Date().toISOString())
  }).immediate()
  validateLiveOutages(sqlite)
}

/** Migração 59: `live_outages.source_key` gravava o endereço bruto da fonte
 * (com passphrase SRT) e `source_name` podia cair no endereço quando a fonte
 * não tinha nome. Converte as linhas existentes: a chave vira o identificador
 * estável sem segredo (HMAC do endereço canônico, `storedSourceKey`) e o nome
 * passa pelo mascaramento do diagnóstico. Só dados; o DDL da 57 não muda. */
export function migrateLiveOutageSourceKeys(sqlite:Database.Database){
  sqlite.transaction(()=>{
    if(sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version=59').get())return
    const rows=sqlite.prepare(`SELECT id,source_key AS sourceKey,source_name AS sourceName FROM live_outages WHERE source_key NOT LIKE '${STORED_SOURCE_KEY_PREFIX}%' OR source_name LIKE '%://%'`).all() as Array<{id:string;sourceKey:string;sourceName:string}>
    const update=sqlite.prepare('UPDATE live_outages SET source_key=?,source_name=? WHERE id=?')
    for(const row of rows)update.run(storedSourceKey(row.sourceKey),displaySourceAddress(row.sourceName),row.id)
    sqlite.prepare('INSERT INTO schema_migrations VALUES(59,?,?)').run('live-outage-source-identity',new Date().toISOString())
  }).immediate()
}
/** Nenhuma credencial em `live_outages` (backup e partida). */
export function assertLiveOutagesWithoutCredential(sqlite:Database.Database){
  if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='live_outages' AND type='table'").get())return
  for(const row of sqlite.prepare('SELECT source_key AS k,source_name AS n FROM live_outages').iterate() as Iterable<{k:string;n:string}>)
    if(containsCredential(row.k)||containsCredential(row.n))throw new Error('Backup contém credencial sem proteção em live_outages; conclua a migração 59 antes do backup.')
}

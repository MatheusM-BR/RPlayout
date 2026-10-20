import { afterEach, describe, expect, it,vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { openDatabase } from './client.js'
import { destinations, liveSources, operationalPlaylistRevisions, healthEvents } from './schema.js'
import { SECRET_PREFIX, SecretVault } from '../domain/secret-vault.js'
import { validateBackupRestore } from '../domain/backup.js'
import {migrateSecretVault} from './vault-migration.js'

const opened: Database.Database[] = []
function removeEditorialRevisionMigration(sqlite:Database.Database){
  // A real pre-editorial/pre-cadence backup predates migration 33 too.
  // Keeping its marker while dropping cadence tables is corruption, not legacy.
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'distribution_owner_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE distribution_owner_slot; DROP TABLE distribution_owner_runs; DELETE FROM schema_migrations WHERE version=33')
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'execution_owner_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE execution_owner_asrun; DROP TABLE execution_owner_slots; DROP TABLE execution_owner_runs; DELETE FROM schema_migrations WHERE version=32')
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'asset_removal_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE asset_removal_versions; DELETE FROM schema_migrations WHERE version=31')
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'account_revision_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE account_versions; DELETE FROM schema_migrations WHERE version=30')
  sqlite.exec('DROP TABLE graphics_initialization; DELETE FROM schema_migrations WHERE version=29')
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'graphics_revision_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE graphics_versions; DELETE FROM schema_migrations WHERE version=28')
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'multiview_revision_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE multiview_versions; DELETE FROM schema_migrations WHERE version=26')
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'schedule_rule_revision_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE schedule_rule_versions; DELETE FROM schema_migrations WHERE version=27')
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'live_source_revision_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE live_source_versions; DELETE FROM schema_migrations WHERE version=25')
  // A pre-editorial fixture also predates project protection. Dropping its
  // tables while claiming migration 24 would correctly be treated as damage.
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'project_revision_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE channel_project_versions; DELETE FROM schema_migrations WHERE version=24')
  for(const row of sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'editorial_%'").all() as {name:string}[])sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
  sqlite.exec('DROP TABLE editorial_revision_counters; DELETE FROM schema_migrations WHERE version IN (17,18)')
}
afterEach(() => {vi.restoreAllMocks(); for (const db of opened.splice(0)) if (db.open) db.close() })
describe('migração de segredos reais do SQLite', () => {
  it('autenticar uma reabertura não regrava metadados ou contadores',()=>{
    const value=openDatabase(':memory:');opened.push(value.sqlite)
    const before=value.sqlite.prepare('SELECT total_changes() AS n').get()
    migrateSecretVault(value.sqlite)
    expect(value.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before)
  })
  it('reserva a escrita antes de ler as linhas e bloqueia outro escritor durante a migração',()=>{
    const file=join(mkdtempSync(join(tmpdir(),'RPlayout-vault-concurrent-')),'database.db')
    const value=openDatabase(file);opened.push(value.sqlite)
    value.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','CH',25,1,320,180,-23,-1,5,'now')")
    const writer=new Database(file,{timeout:0});opened.push(writer)
    const prepare=value.sqlite.prepare.bind(value.sqlite);let reserved=false
    vi.spyOn(value.sqlite,'prepare').mockImplementation(((sql:string)=>{
      if(!reserved&&sql.startsWith('SELECT rowid AS row_id')){
        expect(value.sqlite.inTransaction).toBe(true)
        expect(()=>writer.prepare("UPDATE channels SET name='OUTRO ESCRITOR' WHERE id='ch'").run()).toThrow('locked')
        reserved=true
      }
      return prepare(sql)
    }) as typeof value.sqlite.prepare)
    migrateSecretVault(value.sqlite)
    expect(reserved).toBe(true)
    expect(prepare("SELECT name FROM channels WHERE id='ch'").get()).toEqual({name:'CH'})
  })
  it('autentica backup pré-conversão e aplica migração 16 sem reinterpretar grade',async()=>{
    const file=join(mkdtempSync(join(tmpdir(),'RPlayout-vault-cadence-')),'pre-16.db')
    const old=openDatabase(file);opened.push(old.sqlite)
    removeEditorialRevisionMigration(old.sqlite)
    old.sqlite.exec("INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','CH',25,1,320,180,-23,-1,5,'now'); INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','ch','RD',250,'2026-10-01','now','now'); DROP TABLE channel_cadence_conversions; ALTER TABLE rundowns DROP COLUMN publication_required; DELETE FROM schema_migrations WHERE version=16")
    old.sqlite.close()
    expect(await validateBackupRestore(file)).toMatchObject({protectedSecrets:'verified'})
    const migrated=openDatabase(file);opened.push(migrated.sqlite)
    expect(migrated.sqlite.prepare('SELECT name FROM schema_migrations WHERE version=31').get()).toEqual({name:'durable-asset-removal-impact'})
    expect(migrated.sqlite.prepare('SELECT planned_start,publication_required FROM rundowns').get()).toEqual({planned_start:250,publication_required:0})
    expect(migrated.sqlite.prepare('SELECT version FROM schema_migrations WHERE version=16').get()).toEqual({version:16})
    expect(await validateBackupRestore(file)).toMatchObject({protectedSecrets:'verified'})
  })
  it('tabela de conversão perdida após migração 16 não é tratada como backup antigo',async()=>{
    const file=join(mkdtempSync(join(tmpdir(),'RPlayout-vault-cadence-')),'missing-table.db')
    const value=openDatabase(file);opened.push(value.sqlite)
    value.sqlite.exec('DROP TABLE channel_cadence_conversions');value.sqlite.close()
    await expect(validateBackupRestore(file)).rejects.toThrow('falta tabela channel_cadence_conversions')
  })
  it('migra valores antigos, limpa arquivo/WAL e preserva o valor para consumidores', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'RPlayout-vault-db-')), 'legacy.db')
    let value = openDatabase(file); opened.push(value.sqlite)
    value.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now')")
    const secret = 'LEGACY-SRT-SENHA-ÇÃO-SEGREDO'
    const url = `srt://host:9000?passphrase=${secret}`
    value.sqlite.prepare('INSERT INTO destinations VALUES (?,?,?,?,?,?)').run('old','ch','Destino',url,1,'now')
    value.sqlite.prepare('INSERT INTO health_events (id,component,state,message,occurred_at) VALUES (?,?,?,?,?)').run('legacy-health','ENGINE','failed',`Falha ${url}`,'now')
    value.sqlite.close()
    value = openDatabase(file); opened.push(value.sqlite)
    const raw = value.sqlite.prepare('SELECT url FROM destinations WHERE id=?').get('old') as { url: string }
    expect(raw.url.startsWith(SECRET_PREFIX)).toBe(true)
    expect((await value.db.select().from(destinations))[0]!.url).toBe(url)
    expect((await value.db.select().from(healthEvents))[0]!.message).toContain('Falha srt://host:9000?passphrase=REDACTED')
    expect((await value.db.select().from(healthEvents))[0]!.message).not.toContain(secret)
    expect((value.sqlite.prepare('SELECT message FROM health_events').get() as {message:string}).message.startsWith(SECRET_PREFIX)).toBe(true)
    expect(readFileSync(file).includes(Buffer.from(secret))).toBe(false)
    if (existsSync(file+'-wal')) expect(readFileSync(file+'-wal').includes(Buffer.from(secret))).toBe(false)
    expect(await validateBackupRestore(file)).toMatchObject({ protectedSecrets: 'verified' })
  })
  it('autentica backup protegido antigo antes de atualizar tabelas e novos diagnósticos',async()=>{
    const file=join(mkdtempSync(join(tmpdir(),'RPlayout-vault-db-')),'legacy-protected.db')
    const value=openDatabase(file);opened.push(value.sqlite)
    removeEditorialRevisionMigration(value.sqlite)
    // Removing the pre-v10 queue also removes its later v37 protection;
    // retaining that marker would describe damage, not an older backup.
    for(const row of value.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'integration_revision_%' OR name LIKE 'integration_delivery_revision_%')").all() as {name:string}[])value.sqlite.exec(`DROP TRIGGER "${row.name.replaceAll('"','""')}"`)
    value.sqlite.exec('DROP TABLE integration_revision; DROP TABLE integration_delivery_versions; DELETE FROM schema_migrations WHERE version=37')
    value.sqlite.exec('DROP TABLE secondary_event_runs; DROP TABLE secondary_events; DROP TABLE integration_deliveries; DELETE FROM schema_migrations WHERE version IN (10,11,12)')
    value.sqlite.prepare('INSERT INTO health_events (id,component,state,message,occurred_at) VALUES (?,?,?,?,?)').run('old','ENGINE','failed','Mensagem antiga','now')
    value.sqlite.close()
    expect(await validateBackupRestore(file)).toMatchObject({protectedSecrets:'verified'})
    const updated=openDatabase(file);opened.push(updated.sqlite)
    expect((await updated.db.select().from(healthEvents))[0]!.message).toBe('Mensagem antiga')
    expect(await validateBackupRestore(file)).toMatchObject({protectedSecrets:'verified'})
  })
  it('rejeita backup atual com mensagem desprotegida ou tabela de migração perdida',async()=>{
    const file=join(mkdtempSync(join(tmpdir(),'RPlayout-vault-db-')),'broken.db')
    const value=openDatabase(file);opened.push(value.sqlite)
    value.sqlite.prepare('INSERT INTO health_events (id,component,state,message,occurred_at) VALUES (?,?,?,?,?)').run('plain','ENGINE','failed','plain-fixture','now')
    value.sqlite.close()
    await expect(validateBackupRestore(file)).rejects.toThrow()
    const raw=new Database(file);opened.push(raw)
    raw.exec('DELETE FROM health_events; DROP TABLE integration_deliveries');raw.close()
    await expect(validateBackupRestore(file)).rejects.toThrow('falta tabela integration_deliveries')
  })
  it('protege configuração SRT e cópias da grade sem alterar seus contratos', async () => {
    const value = openDatabase(':memory:'); opened.push(value.sqlite)
    value.sqlite.exec("INSERT INTO channels (id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES ('ch','CH',25,1,320,180,-23,-1,5,'now'); INSERT INTO rundowns (id,channel_id,name,planned_start,date,created_at,updated_at) VALUES ('rd','ch','RD',0,'2026-09-30','now','now')")
    const config = { mode: 'caller' as const, host: 'host', port: 9000, latencyMs: 120, passphrase: 'SRT-SÓ-SEGREDO' }
    await value.db.insert(liveSources).values({ id: 'live', channelId: 'ch', name: 'Estúdio', kind: 'SRT', targetUrl: 'srt://host:9000', srtConfig: config, createdAt: 'now' })
    const payload = { items: [{ sourceRef: 'srt://host:9000?passphrase=SNAPSHOT-SEGREDO' }] }
    await value.db.insert(operationalPlaylistRevisions).values({ id: 'rev', rundownId: 'rd', revision: 1, state: 'PUBLISHED', payload, publishedAt: 'now' })
    expect((await value.db.select().from(liveSources))[0]!.srtConfig).toEqual(config)
    expect((await value.db.select().from(operationalPlaylistRevisions))[0]!.payload).toEqual(payload)
    expect(JSON.stringify(value.sqlite.prepare('SELECT srt_config,target_url FROM live_sources').all())).not.toContain('SRT-SÓ-SEGREDO')
    expect(JSON.stringify(value.sqlite.prepare('SELECT payload FROM operational_playlist_revisions').all())).not.toContain('SNAPSHOT-SEGREDO')
  })
  it('recusa metadados de chave incompatível sem sobrescrever banco', () => {
    const file = join(mkdtempSync(join(tmpdir(),'RPlayout-vault-db-')), 'wrong-key.db')
    const value = openDatabase(file); opened.push(value.sqlite)
    value.sqlite.prepare('UPDATE vault_metadata SET key_fingerprint=? WHERE id=1').run('wrong-key')
    value.sqlite.close()
    expect(() => openDatabase(file)).toThrow('Chave do cofre incompatível')
    const raw = new Database(file); opened.push(raw)
    expect(raw.prepare('SELECT key_fingerprint FROM vault_metadata').get()).toEqual({ key_fingerprint: 'wrong-key' })
  })
  it('recusa envelope de outra chave mesmo sem metadados', () => {
    const file = join(mkdtempSync(join(tmpdir(),'RPlayout-vault-db-')), 'tampered.db')
    const value = openDatabase(file); opened.push(value.sqlite)
    value.sqlite.exec('DELETE FROM vault_metadata')
    value.sqlite.prepare('INSERT INTO integrations (id,name,url,events,enabled,created_at) VALUES (?,?,?,?,?,?)').run('x','X', new SecretVault(randomBytes(32)).encrypt('secret','integrations.url'),'[]',0,'now')
    value.sqlite.close()
    expect(() => openDatabase(file)).toThrow('chave')
  })
})

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import Database from 'better-sqlite3'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openDatabase} from './client.js'
import {migrateGraphicsInitialization, validateGraphicsInitialization} from './graphics-initialization.js'
import {ensureDefaultGraphics} from '../domain/graphics.js'
import {validateBackupRestore} from '../domain/backup.js'

let file: string, value: ReturnType<typeof openDatabase>
const connections: Database.Database[] = []
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'RPlayout-graphics-initialization-')), 'db.sqlite')
  value = openDatabase(file); connections.push(value.sqlite)
})
afterEach(() => {vi.restoreAllMocks(); for (const db of connections.splice(0)) if (db.open) db.close()})
const rows = () => value.sqlite.prepare('SELECT * FROM graphic_templates ORDER BY id').all()
const marker = () => value.sqlite.prepare('SELECT * FROM graphics_initialization').get()
const snapshot = () => ({templates: rows(), marker: marker(), revisions: value.sqlite.prepare('SELECT * FROM graphics_versions ORDER BY scope').all()})
function localChannel() {
  value.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('G','Canal G',320,180,25,1,-23,-1,5,'now')")
}
function custom(id: string, name: string, channelId: string | null) {
  value.sqlite.prepare('INSERT INTO graphic_templates(id,channel_id,name,svg,fields,fade_ms,hold_seconds,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,channelId,name,'<g><text>{{custom}}</text></g>','[{"key":"custom","label":"Custom","defaultValue":"Çãó"}]',425,31,'original')
}
function old28() {value.sqlite.exec('DROP TABLE graphics_initialization; DELETE FROM schema_migrations WHERE version=29')}

describe('migração 29: modelos de fábrica não reaparecem em reinícios', () => {
  it('banco novo prepara catálogo uma única vez, sem alterar canal ou comandos', async () => {
    localChannel(); const channel = value.sqlite.prepare('SELECT * FROM channels').all()
    expect(marker()).toEqual({scope:'G',state:'PENDING',initialized_at:null}); expect(rows()).toEqual([])
    await ensureDefaultGraphics(value.db)
    expect(value.sqlite.prepare('SELECT name,channel_id FROM graphic_templates ORDER BY name').all()).toEqual([{name:'Crédito',channel_id:null},{name:'Selo do canal',channel_id:null},{name:'Tarja urgente',channel_id:null}])
    expect(marker()).toMatchObject({scope:'G',state:'INITIALIZED',initialized_at:expect.any(String)})
    const initialized = snapshot(), changes = value.sqlite.prepare('SELECT total_changes() AS n').get()
    await ensureDefaultGraphics(value.db); migrateGraphicsInitialization(value.sqlite,true)
    expect(snapshot()).toEqual(initialized); expect(value.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(changes)
    expect(value.sqlite.prepare('SELECT * FROM channels').all()).toEqual(channel)
    expect(value.sqlite.prepare('SELECT * FROM operator_decisions').all()).toEqual([])
  })
  it('nome de arte local nunca suprime padrão compartilhado e nenhum conteúdo é substituído', async () => {
    localChannel();custom('local','Crédito','G'); custom('shared','Selo do canal',null)
    const existing = rows();await ensureDefaultGraphics(value.db)
    expect(rows()).toHaveLength(4)
    for (const row of existing) expect(rows()).toContainEqual(row)
    expect(value.sqlite.prepare("SELECT count(*) AS n FROM graphic_templates WHERE name='Crédito' AND channel_id IS NULL").get()).toEqual({n:1})
  })
  it.each(['rename','delete','delete-all'])('decisão editorial %s não é desfeita por segunda conexão ou restart', async action => {
    await ensureDefaultGraphics(value.db)
    value.sqlite.exec(action==='rename'?"UPDATE graphic_templates SET name='Nome escolhido Çãó' WHERE name='Crédito'":action==='delete'?"DELETE FROM graphic_templates WHERE name='Crédito'":'DELETE FROM graphic_templates')
    const original = snapshot();const second = openDatabase(file);connections.push(second.sqlite)
    await ensureDefaultGraphics(second.db);expect(snapshot()).toEqual(original)
    value.sqlite.close();value = openDatabase(file);connections.push(value.sqlite)
    await ensureDefaultGraphics(value.db);expect(snapshot()).toEqual(original)
  })
  it.each(['empty','renamed','local','duplicates'])('upgrade 28 adota catálogo %s sem inventar ou modificar artes', async kind => {
    if(kind==='renamed') custom('renamed','Arte editada Çãó',null)
    if(kind==='local') {localChannel();custom('local','Crédito','G')}
    if(kind==='duplicates') {custom('first','Crédito',null);custom('second','Crédito',null)}
    old28();const original = rows(), revisions = value.sqlite.prepare('SELECT * FROM graphics_versions ORDER BY scope').all()
    value.sqlite.close();value = openDatabase(file);connections.push(value.sqlite)
    expect(marker()).toMatchObject({scope:'G',state:'INITIALIZED'})
    await ensureDefaultGraphics(value.db);expect(rows()).toEqual(original)
    expect(value.sqlite.prepare('SELECT * FROM graphics_versions ORDER BY scope').all()).toEqual(revisions)
    const previous = marker();migrateGraphicsInitialization(value.sqlite,false);expect(marker()).toEqual(previous)
  })
  it('falha no terceiro INSERT reverte artes, revisões e marcador e permite retry íntegro', async () => {
    const original = snapshot()
    value.sqlite.exec("CREATE TRIGGER factory_fixture_failure BEFORE INSERT ON graphic_templates WHEN NEW.name='Tarja urgente' BEGIN SELECT RAISE(ABORT,'FACTORY_FIXTURE'); END")
    await expect(ensureDefaultGraphics(value.db)).rejects.toThrow('FACTORY_FIXTURE'); expect(snapshot()).toEqual(original)
    value.sqlite.exec('DROP TRIGGER factory_fixture_failure');await ensureDefaultGraphics(value.db);expect(rows()).toHaveLength(3)
  })
  it('falha ao confirmar marcador também reverte todos os INSERTs e counters', async () => {
    const original = snapshot()
    value.sqlite.exec("CREATE TRIGGER factory_marker_failure BEFORE UPDATE ON graphics_initialization BEGIN SELECT RAISE(ABORT,'MARKER_FIXTURE'); END")
    await expect(ensureDefaultGraphics(value.db)).rejects.toMatchObject({cause:expect.objectContaining({message:expect.stringContaining('MARKER_FIXTURE')})});expect(snapshot()).toEqual(original)
    value.sqlite.exec('DROP TRIGGER factory_marker_failure');await ensureDefaultGraphics(value.db);expect(rows()).toHaveLength(3)
  })
  it.each(['empty','custom'])('legado anterior às migrações com catálogo %s é adotado sem defaults', async kind => {
    const legacyFile = join(mkdtempSync(join(tmpdir(),'RPlayout-factory-pre-baseline-')),'legacy.db')
    const legacy = new Database(legacyFile)
    legacy.exec('CREATE TABLE graphic_templates(id TEXT PRIMARY KEY,channel_id TEXT,name TEXT NOT NULL,svg TEXT NOT NULL,fields TEXT NOT NULL,fade_ms INTEGER NOT NULL,hold_seconds INTEGER,created_at TEXT NOT NULL)')
    if(kind==='custom')legacy.exec("INSERT INTO graphic_templates VALUES('old',NULL,'Arte legada','<g/>','[]',300,NULL,'original')")
    const existing = legacy.prepare('SELECT * FROM graphic_templates').all();legacy.close()
    const migrated = openDatabase(legacyFile);connections.push(migrated.sqlite)
    expect(migrated.sqlite.prepare('SELECT * FROM graphics_initialization').get()).toMatchObject({state:'INITIALIZED'})
    await ensureDefaultGraphics(migrated.db);expect(migrated.sqlite.prepare('SELECT * FROM graphic_templates').all()).toEqual(existing)
  })
  it('escrita é reservada antes da consulta ao catálogo; outro escritor não intervém', async () => {
    const second = new Database(file,{timeout:0});connections.push(second)
    const prepare = value.sqlite.prepare.bind(value.sqlite); let checked = false
    vi.spyOn(value.sqlite,'prepare').mockImplementation(((query: string) => {
      if(query.includes('SELECT state FROM graphics_initialization')) {
        expect(value.sqlite.inTransaction).toBe(true)
        expect(() => second.prepare("UPDATE graphics_initialization SET initialized_at=initialized_at").run()).toThrow(/locked/)
        checked = true
      }
      return prepare(query)
    }) as typeof value.sqlite.prepare)
    await ensureDefaultGraphics(value.db);expect(checked).toBe(true)
    vi.restoreAllMocks();const other = openDatabase(file);connections.push(other.sqlite)
    const original = snapshot();await ensureDefaultGraphics(other.db);expect(snapshot()).toEqual(original)
  })
  it('marcador final não pode ser redefinido/deletado por SQL comum', async () => {
    await ensureDefaultGraphics(value.db);const original = snapshot()
    expect(() => value.sqlite.exec("UPDATE graphics_initialization SET state='PENDING',initialized_at=NULL")).toThrow(/cannot be reset/)
    expect(() => value.sqlite.exec('DELETE FROM graphics_initialization')).toThrow(/cannot be deleted/)
    expect(snapshot()).toEqual(original)
  })
  it.each(['PENDING','INITIALIZED'])('backup restaura marcador %s sem escrever modelos', async state => {
    if(state==='INITIALIZED') {await ensureDefaultGraphics(value.db);value.sqlite.exec('DELETE FROM graphic_templates')}
    const original = snapshot(), backup = join(mkdtempSync(join(tmpdir(),'RPlayout-factory-backup-')),'backup.db')
    await value.sqlite.backup(backup)
    expect(await validateBackupRestore(backup)).toMatchObject({integrity:'ok',foreignKeys:'ok',tables:{graphics_initialization:1}})
    expect(snapshot()).toEqual(original)
    const restored = openDatabase(backup);connections.push(restored.sqlite)
    expect(restored.sqlite.prepare('SELECT * FROM graphics_initialization').get()).toEqual(marker())
    await ensureDefaultGraphics(restored.db);expect(restored.sqlite.prepare('SELECT count(*) AS n FROM graphic_templates').get()).toEqual({n:state==='PENDING'?3:0})
  })
  it.each(['table','row','trigger'])('dano marcado %s é recusado no startup/backup, nunca curado por recriação', async damage => {
    value.sqlite.exec(damage==='table'?'DROP TABLE graphics_initialization':damage==='trigger'?'DROP TRIGGER graphics_initialization_no_reset':'DROP TRIGGER graphics_initialization_no_delete; DELETE FROM graphics_initialization')
    expect(() => validateGraphicsInitialization(value.sqlite)).toThrow()
    const backup = join(mkdtempSync(join(tmpdir(),'RPlayout-factory-damaged-')),'backup.db');await value.sqlite.backup(backup)
    await expect(validateBackupRestore(backup)).rejects.toThrow()
    value.sqlite.close();expect(() => openDatabase(file)).toThrow()
  })
})

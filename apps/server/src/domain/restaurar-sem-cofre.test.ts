import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tool = require(resolve(__dirname, '../../../../scripts/restaurar-sem-cofre.cjs')) as { main(argv: string[]): { removed: Record<string, number>; cleared: Record<string, number>; kept: Record<string, number> } }
const SECRET = 'rplayout-secret:v1:AAAA'

function fixture(file: string) {
  const db = new Database(file)
  db.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT);
    INSERT INTO schema_migrations VALUES (32,'x','t'),(33,'y','t'),(42,'z','t'),(57,'w','t');
    CREATE TABLE vault_metadata(id INTEGER PRIMARY KEY, key_fingerprint TEXT NOT NULL, scrub_pending INTEGER NOT NULL);
    INSERT INTO vault_metadata VALUES (1,'antiga',0);
    CREATE TABLE channels(id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO channels VALUES ('c','RW');
    CREATE TABLE rundowns(id TEXT PRIMARY KEY, channel_id TEXT REFERENCES channels(id));
    INSERT INTO rundowns VALUES ('r','c');
    CREATE TABLE rundown_items(id TEXT PRIMARY KEY, rundown_id TEXT REFERENCES rundowns(id), title TEXT, source_ref TEXT, live_endpoint TEXT);
    INSERT INTO rundown_items VALUES ('vt','r','VT',NULL,NULL),('live','r','Ao vivo','${SECRET}','${SECRET}');
    CREATE TABLE item_graphics(id TEXT PRIMARY KEY, item_id TEXT REFERENCES rundown_items(id) ON DELETE CASCADE);
    INSERT INTO item_graphics VALUES ('g1','live'),('g2','vt');
    CREATE TABLE operator_decisions(id TEXT PRIMARY KEY, rundown_id TEXT, payload TEXT NOT NULL);
    INSERT INTO operator_decisions VALUES ('d1','@security','${SECRET}');
    CREATE TRIGGER audit_immutable_delete BEFORE DELETE ON operator_decisions BEGIN SELECT RAISE(ABORT,'imutável'); END;
    CREATE TABLE health_events(id TEXT PRIMARY KEY, message TEXT, context TEXT);
    INSERT INTO health_events VALUES ('h1','${SECRET}','${SECRET}');
    CREATE TABLE live_sources(id TEXT PRIMARY KEY, target_url TEXT NOT NULL, srt_config TEXT);
    INSERT INTO live_sources VALUES ('l1','${SECRET}',NULL);
    CREATE TABLE storage_admission(id INTEGER PRIMARY KEY, payload TEXT NOT NULL, signature TEXT NOT NULL);
    INSERT INTO storage_admission VALUES (1,'{}','assinada');
    CREATE TABLE execution_owner_runs(id TEXT PRIMARY KEY, payload TEXT, signature TEXT);
    INSERT INTO execution_owner_runs VALUES ('run','{}','sig');
    CREATE TABLE channel_checkpoints(channel_id TEXT PRIMARY KEY, payload TEXT);
    INSERT INTO channel_checkpoints VALUES ('c','{}');
    CREATE TABLE as_run(id TEXT PRIMARY KEY, channel_id TEXT, title TEXT, started_at TEXT, ended_at TEXT, ended_by TEXT);
    INSERT INTO as_run VALUES ('a1','c','VT','2026-11-03T12:00:00Z','2026-11-03T12:01:00Z','EOS'),('a2','c','VT','2026-11-03T12:50:00Z',NULL,NULL);
    CREATE TABLE media_assets(id TEXT PRIMARY KEY, path TEXT);
    INSERT INTO media_assets VALUES ('m','D:/Videos/a.mp4');
    CREATE TABLE extra_report(id TEXT PRIMARY KEY, report TEXT NOT NULL);
    INSERT INTO extra_report VALUES ('x','${SECRET}');
  `)
  db.close()
}

describe('restaurar-sem-cofre', () => {
  it('apaga só o que depende da chave antiga e preserva grade, acervo e AIRED', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rsc-'))
    const source = join(dir, 'orig.db'), target = join(dir, 'novo.db')
    fixture(source)
    const report = tool.main([source, target])
    const db = new Database(target, { readonly: true })
    const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n
    // Original intacto.
    expect(new Database(source, { readonly: true }).prepare('SELECT count(*) n FROM operator_decisions').get()).toEqual({ n: 1 })
    // Nenhum envelope cifrado sobrou em lugar nenhum.
    for (const [table, column] of [['rundown_items', 'source_ref'], ['operator_decisions', 'payload'], ['health_events', 'message'], ['live_sources', 'target_url'], ['extra_report', 'report']])
      expect(n(`SELECT count(*) n FROM ${table} WHERE ${column} LIKE 'rplayout-secret:v1:%'`)).toBe(0)
    expect(n('SELECT count(*) n FROM rundown_items')).toBe(1)
    expect(n("SELECT count(*) n FROM item_graphics WHERE id='g2'")).toBe(1)
    expect(n('SELECT count(*) n FROM item_graphics')).toBe(1)
    expect(n('SELECT count(*) n FROM health_events')).toBe(1)
    expect(n('SELECT count(*) n FROM media_assets')).toBe(1)
    expect(n('SELECT count(*) n FROM as_run WHERE ended_at IS NULL')).toBe(0)
    expect(n('SELECT count(*) n FROM vault_metadata')).toBe(0)
    expect(n('SELECT count(*) n FROM channel_checkpoints')).toBe(0)
    // Tabelas assinadas saem com o registro da migração, para o servidor recriá-las.
    expect(n("SELECT count(*) n FROM sqlite_master WHERE name IN ('storage_admission','execution_owner_runs')")).toBe(0)
    expect(n('SELECT count(*) n FROM schema_migrations WHERE version IN (32,33,42)')).toBe(0)
    expect(n('SELECT count(*) n FROM schema_migrations WHERE version=57')).toBe(1)
    // A proteção da auditoria volta no lugar.
    expect(n("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name='audit_immutable_delete'")).toBe(1)
    expect(report.kept.as_run).toBe(2)
    db.close()
  })

  it('backup r88-37 (migração 58): mantém o que já está em claro e esquece a recuperação da chave antiga', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rsc-'))
    const source = join(dir, 'orig.db'), target = join(dir, 'novo.db')
    fixture(source)
    const db = new Database(source)
    db.exec(`
      INSERT INTO schema_migrations VALUES (58,'credential-only-vault-and-recovery','t');
      CREATE TABLE vault_recovery(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL);
      INSERT INTO vault_recovery VALUES (1,'{}',1,'t');
      INSERT INTO operator_decisions VALUES ('d2','@http','{"route":"/api/x"}');
      UPDATE health_events SET message='CPU alta', context=NULL;
      INSERT INTO live_sources VALUES ('ndi','ndi://ESTUDIO',NULL);
    `)
    db.close()
    const report = tool.main([source, target])
    const out = new Database(target, { readonly: true })
    const n = (sql: string) => (out.prepare(sql).get() as { n: number }).n
    expect(n("SELECT count(*) n FROM operator_decisions WHERE id='d2'")).toBe(1)
    expect(n('SELECT count(*) n FROM operator_decisions')).toBe(1)
    expect(report.removed.operator_decisions).toBe(1)
    expect(n("SELECT count(*) n FROM health_events WHERE message='CPU alta'")).toBe(1)
    expect(n("SELECT count(*) n FROM live_sources WHERE id='ndi'")).toBe(1)
    expect(n("SELECT count(*) n FROM live_sources")).toBe(1)
    expect(n('SELECT count(*) n FROM vault_recovery')).toBe(0)
    expect(n('SELECT count(*) n FROM schema_migrations WHERE version=58')).toBe(1)
    out.close()
  })

  it('recusa sobrescrever um destino existente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rsc-'))
    const source = join(dir, 'orig.db')
    fixture(source)
    expect(() => tool.main([source, source])).toThrow('destino já existe')
    expect(existsSync(source)).toBe(true)
  })
})

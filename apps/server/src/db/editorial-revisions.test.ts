import {afterEach,describe,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import type Database from 'better-sqlite3'
import {openDatabase} from './client.js'
import {EditorialVersions,validateEditorialRevisions} from './editorial-revisions.js'
import {validateBackupRestore} from '../domain/backup.js'

const opened:Database.Database[]=[],dirs:string[]=[]
afterEach(()=>{for(const db of opened.splice(0))if(db.open)db.close();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
function fixture(file=':memory:'){
  const value=openDatabase(file);opened.push(value.sqlite)
  const {sqlite}=value
  sqlite.exec(`INSERT INTO channels(id,name,rate_num,rate_den,width,height,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('ch','CH',25,1,320,180,-23,-1,5,'now'),('other','Other',25,1,320,180,-23,-1,5,'now');
    INSERT INTO rundowns(id,channel_id,name,planned_start,date,created_at,updated_at) VALUES('rd','ch','Grade',0,'2026-10-01','now','now'),('other','other','Outra',0,'2026-10-01','now','now'),('empty','ch','Vazia',0,'2026-10-01','now','now');
    INSERT INTO media_assets(id,content_hash,path,title,kind,duration_frames,rate_num,rate_den,created_at) VALUES('asset','hash','C:/video.mp4','VT','VIDEO',250,25,1,'now');
    INSERT INTO rundown_items(id,rundown_id,sort_order,type,title,media_id,min_duration,anchor,on_overrun,locked,auto_next,loop) VALUES('item','rd',0,'FILE','VT','asset',0,'{"kind":"FLOW"}','PUSH',0,1,0),('foreign','other',0,'FILE','VT','asset',0,'{"kind":"FLOW"}','PUSH',0,1,0);
    INSERT INTO graphic_templates(id,channel_id,name,svg,fields,fade_ms,created_at) VALUES('tpl','ch','Nome','<svg/>','[]',300,'now');`)
  const versions=new EditorialVersions(sqlite)
  return {...value,versions,pair:(rid='rd',iid='item')=>[versions.read(rid),versions.read(rid,iid)]}
}
const file=()=>{const dir=mkdtempSync(join(tmpdir(),'RPlayout-revisions-'));dirs.push(dir);return join(dir,'grade.db')}

describe('revisões editoriais duráveis e atômicas para todos os escritores',()=>{
  it('QC global invalida todos os donos, inclusive ao mudar global para canal específico',()=>{
    const f=fixture(),a=f.pair(),b=f.pair('other','foreign')
    f.sqlite.exec("INSERT INTO qc_decisions(id,asset_id,content_hash,channel_id,status,checks,created_at) VALUES('global','asset','hash','@all','BLOCKED','{}','now')")
    expect(f.pair()).toEqual(a.map(v=>v+1));expect(f.pair('other','foreign')).toEqual(b.map(v=>v+1))
    f.sqlite.exec("UPDATE qc_decisions SET channel_id='ch' WHERE id='global'")
    expect(f.pair()).toEqual(a.map(v=>v+2));expect(f.pair('other','foreign')).toEqual(b.map(v=>v+2))
    f.sqlite.exec("DELETE FROM qc_decisions WHERE id='global'")
    expect(f.pair()).toEqual(a.map(v=>v+3));expect(f.pair('other','foreign')).toEqual(b.map(v=>v+2))
  })
  it('backup 17 é válido antes do upgrade 18; upgrade invalida ETag sem mudar dados e não se repete',async()=>{
    const path=file(),f=fixture(path),before=f.pair()
    for(const row of f.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'editorial_qc_%'").all() as {name:string;sql:string}[]){
      const old=row.sql.replaceAll("(r.channel_id=NEW.channel_id OR NEW.channel_id='@all')",'r.channel_id=NEW.channel_id').replaceAll("(r.channel_id=OLD.channel_id OR OLD.channel_id='@all')",'r.channel_id=OLD.channel_id')
      f.sqlite.exec(`DROP TRIGGER ${row.name}; ${old}`)
    }
    f.sqlite.exec('DELETE FROM schema_migrations WHERE version=18');validateEditorialRevisions(f.sqlite);f.sqlite.close()
    expect(await validateBackupRestore(path)).toMatchObject({integrity:'ok'})
    const upgrade=openDatabase(path);opened.push(upgrade.sqlite)
    const reader=new EditorialVersions(upgrade.sqlite)
    expect([reader.read('rd'),reader.read('rd','item')]).toEqual(before.map(v=>v+1))
    expect(upgrade.sqlite.prepare("SELECT title FROM rundown_items WHERE id='item'").get()).toEqual({title:'VT'})
    upgrade.sqlite.close();const again=openDatabase(path);opened.push(again.sqlite)
    expect(new EditorialVersions(again.sqlite).read('rd')).toBe(before[0]!+1)
    expect(await validateBackupRestore(path)).toMatchObject({integrity:'ok'})
  })
  it('invalida somente as grades/linhas dependentes na escrita de item, mídia e QC por canal',()=>{
    const f=fixture(),before=f.pair(),foreign=f.pair('other','foreign')
    f.sqlite.prepare('UPDATE rundown_items SET title=? WHERE id=?').run('Editado','item')
    expect(f.pair()).toEqual(before.map(v=>v+1));expect(f.pair('other','foreign')).toEqual(foreign)
    f.sqlite.exec("UPDATE media_assets SET title='Reprobe' WHERE id='asset'")
    expect(f.pair()).toEqual(before.map(v=>v+2));expect(f.pair('other','foreign')).toEqual(foreign.map(v=>v+1))
    f.sqlite.exec("INSERT INTO qc_decisions(id,asset_id,content_hash,channel_id,status,checks,created_at) VALUES('qc','asset','hash','ch','APPROVED','{}','now')")
    expect(f.pair()).toEqual(before.map(v=>v+3));expect(f.pair('other','foreign')).toEqual(foreign.map(v=>v+1))
    f.sqlite.exec("UPDATE qc_decisions SET channel_id='other' WHERE id='qc'")
    expect(f.pair()).toEqual(before.map(v=>v+4));expect(f.pair('other','foreign')).toEqual(foreign.map(v=>v+2))
    f.sqlite.exec("DELETE FROM qc_decisions WHERE id='qc'")
    expect(f.pair('other','foreign')).toEqual(foreign.map(v=>v+3))
  })
  it('invalida grafismos, templates, eventos secundários e configuração de canal',()=>{
    const f=fixture(),before=f.pair(),foreign=f.pair('other','foreign'),empty=f.versions.read('empty')
    f.sqlite.exec("INSERT INTO item_graphics(id,item_id,template_id,field_values,at_seconds,created_at) VALUES('cue','item','tpl','{}',0,'now'); UPDATE item_graphics SET at_seconds=5 WHERE id='cue'; UPDATE graphic_templates SET name='Novo' WHERE id='tpl'; DELETE FROM item_graphics WHERE id='cue'")
    expect(f.pair()).toEqual(before.map(v=>v+4))
    // The trigger does not decrypt or depend on the JSON shape.
    f.sqlite.exec("INSERT INTO secondary_events(id,channel_id,item_id,definition,created_at,updated_at) VALUES('event','ch','item','ciphertext','now','now'); UPDATE secondary_events SET definition='new-ciphertext' WHERE id='event'; UPDATE graphic_templates SET name='Atualizado' WHERE id='tpl'; DELETE FROM secondary_events WHERE id='event'; UPDATE channels SET name='Canal' WHERE id='ch'")
    expect(f.pair()).toEqual(before.map(v=>v+9));expect(f.pair('other','foreign')).toEqual(foreign)
    expect(f.versions.read('empty')).toBe(empty+1)
  })
  it('movimento de item invalida vínculo antigo e novo sem reutilizar revisão',()=>{
    const f=fixture(),before=f.pair(),other=f.versions.read('other')
    f.sqlite.exec("UPDATE rundown_items SET rundown_id='other' WHERE id='item'")
    expect(f.pair()).toEqual(before.map(v=>v+1));expect(f.versions.read('other')).toBe(other+1)
    expect(f.versions.read('other','item')).toBe(1)
    f.sqlite.exec("UPDATE rundown_items SET rundown_id='rd' WHERE id='item'")
    expect(f.versions.read('rd','item')).toBe(before[1]!+2)
  })
  it('rollback devolve dados e revisões; proteção de limite também é atômica',()=>{
    const f=fixture(),before=f.pair()
    expect(()=>f.sqlite.transaction(()=>{f.sqlite.exec("UPDATE rundown_items SET title='Perdido' WHERE id='item'");throw new Error('falha simulada')})()).toThrow('falha simulada')
    expect(f.pair()).toEqual(before);expect(f.sqlite.prepare("SELECT title FROM rundown_items WHERE id='item'").get()).toEqual({title:'VT'})
    f.sqlite.prepare("UPDATE editorial_revision_counters SET version=? WHERE rundown_id='rd' AND scope='ITEM'").run(Number.MAX_SAFE_INTEGER)
    expect(()=>f.sqlite.exec("UPDATE rundown_items SET title='Overflow' WHERE id='item'")).toThrow()
    expect(f.versions.read('rd')).toBe(before[0]);expect(f.versions.read('rd','item')).toBe(Number.MAX_SAFE_INTEGER)
    expect(f.sqlite.prepare("SELECT title FROM rundown_items WHERE id='item'").get()).toEqual({title:'VT'})
  })
  it('undo de exclusão/reinserção de linha e grade conserva tombstones',()=>{
    const f=fixture(),before=f.pair()
    f.sqlite.exec("CREATE TEMP TABLE saved_item AS SELECT * FROM rundown_items WHERE id='item'; DELETE FROM rundown_items WHERE id='item'; INSERT INTO rundown_items SELECT * FROM saved_item")
    expect(f.pair()).toEqual(before.map(v=>v+2))
    const restored=f.pair()
    f.sqlite.exec("CREATE TEMP TABLE saved_grade AS SELECT * FROM rundowns WHERE id='rd'; DELETE FROM rundowns WHERE id='rd'; INSERT INTO rundowns SELECT * FROM saved_grade; INSERT INTO rundown_items SELECT * FROM saved_item")
    expect(f.versions.read('rd')).toBeGreaterThan(restored[0]!)
    expect(f.versions.read('rd','item')).toBeGreaterThan(restored[1]!)
    validateEditorialRevisions(f.sqlite)
  })
  it('duas conexões e reabertura leem os mesmos contadores; nenhuma memória reinicia o ETag',()=>{
    const path=file(),f=fixture(path),before=f.pair(),second=openDatabase(path);opened.push(second.sqlite)
    second.sqlite.exec("UPDATE rundown_items SET title='Estação 2' WHERE id='item'")
    expect(f.pair()).toEqual(before.map(v=>v+1))
    const versions=f.pair();f.sqlite.close();second.sqlite.close()
    const restart=openDatabase(path);opened.push(restart.sqlite)
    const reader=new EditorialVersions(restart.sqlite)
    expect([reader.read('rd'),reader.read('rd','item')]).toEqual(versions)
  })
  it('migração legada invalida ETags antigos sem reinterpretar a grade',()=>{
    const path=file(),f=fixture(path)
    for(const row of f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'editorial_%'").all() as {name:string}[])f.sqlite.exec(`DROP TRIGGER ${row.name}`)
    f.sqlite.exec('DROP TABLE editorial_revision_counters; DELETE FROM schema_migrations WHERE version IN (17,18)');f.sqlite.close()
    const upgrade=openDatabase(path);opened.push(upgrade.sqlite)
    expect(new EditorialVersions(upgrade.sqlite).read('rd')).toBeGreaterThan(2**40-1)
    expect(upgrade.sqlite.prepare("SELECT title,sort_order FROM rundown_items WHERE id='item'").get()).toEqual({title:'VT',sort_order:0})
    validateEditorialRevisions(upgrade.sqlite)
  })
  it.each(['trigger','changed-trigger','table','changed-table','grade-counter','item-counter'])('recusa backup e reabertura atuais sem proteção íntegra: %s',async mode=>{
    const path=file(),f=fixture(path)
    if(mode==='trigger')f.sqlite.exec('DROP TRIGGER editorial_item_update')
    if(mode==='changed-trigger')f.sqlite.exec('DROP TRIGGER editorial_item_update; CREATE TRIGGER editorial_item_update AFTER UPDATE ON rundown_items BEGIN SELECT 1; END')
    if(mode==='table')f.sqlite.exec('DROP TABLE editorial_revision_counters')
    if(mode==='changed-table')f.sqlite.exec('DROP TABLE editorial_revision_counters; CREATE TABLE editorial_revision_counters(scope TEXT,rundown_id TEXT,item_id TEXT,version INTEGER)')
    if(mode==='grade-counter')f.sqlite.exec("DELETE FROM editorial_revision_counters WHERE scope='RUNDOWN' AND rundown_id='rd'")
    if(mode==='item-counter')f.sqlite.exec("DELETE FROM editorial_revision_counters WHERE scope='ITEM' AND rundown_id='rd'")
    expect(()=>validateEditorialRevisions(f.sqlite)).toThrow(/revis|editorial_revision/i)
    f.sqlite.close()
    await expect(validateBackupRestore(path)).rejects.toThrow(/revis|editorial_revision/i)
    expect(()=>openDatabase(path)).toThrow(/revis|editorial_revision/i)
  })
})

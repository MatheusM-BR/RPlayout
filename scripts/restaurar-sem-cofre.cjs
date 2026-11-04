#!/usr/bin/env node
// Restaura um backup do RPlayout quando a chave do cofre original se perdeu
// (máquina formatada, outro usuário do Windows). Gera um banco NOVO a partir do
// backup, sem tocar no original:
//   - apaga o que só existe cifrado e não pode mais ser lido: auditoria de
//     decisões (e seus selos), grades publicadas, saídas, entradas ao vivo e os
//     itens ao vivo da grade;
//   - mantém os alertas, mas sem o texto cifrado;
//   - remove a impressão da chave antiga, para o servidor criar um cofre novo na
//     primeira partida.
// Grade em edição (itens de VT), acervo, QC, usuários, AIRED, categorias e artes
// ficam como estavam.
//
// A partir da r88-37 (migração 58) só credencial fica cifrada: grade, auditoria
// nova, alertas e snapshots sem credencial estão em claro e são mantidos. Só o
// que ainda é envelope sai. Se o backup tem senha de recuperação cadastrada,
// prefira restore-rplayout-backup.ps1 -RecoveryPasswordFile: ele recupera tudo.
//
// Uso: node restaurar-sem-cofre.cjs <backup.db> <novo.db> [--relatorio <arquivo.json>]
// O better-sqlite3 vem da instalação do RPlayout (apps/server/node_modules) ou do
// repositório; informe RPLAYOUT_SQLITE_MODULE com o caminho, se precisar.
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const PREFIX = 'rplayout-secret:v1:'
const PROTECTED = [
  ['output_profiles', 'target'], ['transmission_presets', 'target'],
  ['channel_project_snapshots', 'payload'], ['operational_playlist_revisions', 'payload'],
  ['integrations', 'url'], ['rundown_items', 'source_ref'], ['rundown_items', 'live_endpoint'],
  ['operator_decisions', 'payload'], ['guest_keys', 'stream_key'], ['destinations', 'url'],
  ['live_sources', 'target_url'], ['live_sources', 'srt_config'], ['multiview_configs', 'cells'],
  ['integration_deliveries', 'target'], ['integration_deliveries', 'payload'],
  ['secondary_events', 'definition'], ['health_events', 'message'], ['health_events', 'context'],
  ['channel_cadence_conversions', 'snapshot'],
]
// Colunas que aceitam NULL: limpa o valor e mantém a linha.
const NULLABLE_KEEP_ROW = new Set(['health_events.message', 'health_events.context'])
// Índice de comandos de grafismo pendentes (migração 49): o mesmo predicado de
// "aceito e não resolvido" de apps/server/src/db/graphic-command-pending.ts. O
// servidor recusa partir se o índice divergir do histórico (o teste confere que
// os dois textos são iguais).
const GRAPHIC_TERMINAL = `SELECT 1 FROM operator_decisions t INDEXED BY graphic_command_phase_identity WHERE t.id IN (
  substr(a.id,1,length(a.id)-9)||':CONFIRMED',substr(a.id,1,length(a.id)-9)||':SIMULATED',
  substr(a.id,1,length(a.id)-9)||':REJECTED',substr(a.id,1,length(a.id)-9)||':REVIEWED')
  AND t.rundown_id=a.rundown_id AND t.kind='GRAPHIC_COMMAND_'||substr(t.id,length(a.id)-7)`
const GRAPHIC_UNRESOLVED = `a.kind='GRAPHIC_COMMAND_ACCEPTED' AND NOT EXISTS(${GRAPHIC_TERMINAL})`
const GRAPHIC_PENDING_EXPECTED = `SELECT a.id,a.rundown_id AS scope FROM operator_decisions a WHERE ${GRAPHIC_UNRESOLVED}`

function loadSqlite() {
  const candidates = [process.env.RPLAYOUT_SQLITE_MODULE,
    path.join(__dirname, '..', 'apps', 'server', 'node_modules', 'better-sqlite3'),
    path.join(process.cwd(), 'apps', 'server', 'node_modules', 'better-sqlite3'), 'better-sqlite3'].filter(Boolean)
  for (const candidate of candidates) { try { return require(candidate) } catch { /* próximo */ } }
  throw new Error('better-sqlite3 não encontrado; informe RPLAYOUT_SQLITE_MODULE.')
}

function main(argv) {
  const [source, target, flag, reportPath] = argv
  if (!source || !target || (flag && flag !== '--relatorio')) throw new Error('Uso: restaurar-sem-cofre.cjs <backup.db> <novo.db> [--relatorio <arquivo.json>]')
  if (!fs.existsSync(source)) throw new Error('Backup não encontrado: ' + source)
  if (fs.existsSync(target)) throw new Error('O destino já existe; escolha um arquivo novo: ' + target)
  const Database = loadSqlite()
  const original = new Database(source, { readonly: true, fileMustExist: true })
  if (original.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup corrompido (integrity_check).')
  original.close()
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true })
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  const db = new Database(target)
  const report = { source: path.resolve(source), target: path.resolve(target), at: new Date().toISOString(), removed: {}, cleared: {}, kept: {} }
  try {
    db.pragma('journal_mode = DELETE')
    db.pragma('foreign_keys = OFF')
    const tableExists = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
    const count = (sql, ...args) => db.prepare(sql).get(...args).n
    // Gatilhos de proteção (auditoria imutável, revisões) bloqueiam a limpeza.
    // São guardados com o texto exato e recriados no fim: o servidor confere o
    // DDL da auditoria byte a byte na partida.
    const triggers = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY rowid").all()
    db.transaction(() => {
      for (const { name } of triggers) db.exec(`DROP TRIGGER "${name}"`)
      // 1. Auditoria: payload cifrado ilegível (até a r88-36 era tudo; depois só o
      // histórico antigo). Os selos cobrem essas linhas, então saem juntos; as
      // linhas em claro que ficam são seladas de novo pelo servidor.
      const auditRemoved = tableExists('operator_decisions') ? db.prepare('DELETE FROM operator_decisions WHERE payload LIKE ?').run(PREFIX + '%').changes : 0
      if (tableExists('operator_decisions')) report.removed.operator_decisions = auditRemoved
      if (auditRemoved) {
        for (const table of ['audit_sealed_rows', 'audit_seals', 'graphic_command_pending']) if (tableExists(table)) report.removed[table] = db.prepare(`DELETE FROM "${table}"`).run().changes
        if (tableExists('sqlite_sequence')) db.prepare("DELETE FROM sqlite_sequence WHERE name='audit_seals'").run()
      }
      // 2. Itens ao vivo da grade (fonte cifrada) e seus dependentes.
      const liveItems = db.prepare(`SELECT id FROM rundown_items WHERE source_ref LIKE '${PREFIX}%' OR live_endpoint LIKE '${PREFIX}%'`).all().map(row => row.id)
      for (const table of ['item_graphics', 'secondary_events']) if (tableExists(table) && liveItems.length) report.removed[table + ' (itens ao vivo)'] = db.prepare(`DELETE FROM "${table}" WHERE item_id IN (${liveItems.map(() => '?').join(',')})`).run(...liveItems).changes
      if (liveItems.length) report.removed['rundown_items (ao vivo)'] = db.prepare(`DELETE FROM rundown_items WHERE id IN (${liveItems.map(() => '?').join(',')})`).run(...liveItems).changes
      // 3. Demais colunas protegidas: linha some se a coluna é obrigatória; senão o valor vira NULL.
      for (const [table, column] of PROTECTED) {
        if (!tableExists(table)) continue
        if (!db.prepare(`PRAGMA table_info("${table}")`).all().some(col => col.name === column)) continue
        const key = `${table}.${column}`
        const n = count(`SELECT count(*) n FROM "${table}" WHERE "${column}" LIKE ?`, PREFIX + '%')
        if (!n) continue
        if (NULLABLE_KEEP_ROW.has(key)) report.cleared[key] = db.prepare(`UPDATE "${table}" SET "${column}"=NULL WHERE "${column}" LIKE ?`).run(PREFIX + '%').changes
        else report.removed[key] = db.prepare(`DELETE FROM "${table}" WHERE "${column}" LIKE ?`).run(PREFIX + '%').changes
      }
      // 3b. Registros assinados com a chave antiga (HMAC): instâncias do servidor,
      // admissão do armazenamento e histórico de restaurações/ativações. Com a
      // chave nova a assinatura não confere e o servidor recusa partir.
      for (const table of ['server_instances', 'restoration_records', 'restored_activation_runs'])
        if (tableExists(table)) report.removed[table + ' (assinado)'] = db.prepare(`DELETE FROM "${table}"`).run().changes
      // A admissão do armazenamento exige exatamente uma linha assinada: a tabela
      // sai junto com o registro da migração 42, que a recria assinada pela chave nova.
      if (tableExists('storage_admission')) {
        db.exec('DROP TABLE storage_admission')
        db.prepare('DELETE FROM schema_migrations WHERE version=42').run()
        report.removed['storage_admission (recriada na partida)'] = 1
      }
      // Posse da execução (migração 32) e da distribuição (33): assinadas pela chave
      // antiga e presas à máquina antiga. As tabelas saem e o servidor as recria vazias.
      const recreated = { 32: ['execution_owner_asrun', 'execution_owner_slots', 'execution_owner_runs'], 33: ['distribution_owner_slot', 'distribution_owner_runs'] }
      for (const [version, tables] of Object.entries(recreated)) {
        for (const table of tables) if (tableExists(table)) { report.removed[table + ' (recriada na partida)'] = count(`SELECT count(*) n FROM "${table}"`); db.exec(`DROP TABLE "${table}"`) }
        db.prepare('DELETE FROM schema_migrations WHERE version=?').run(Number(version))
      }
      // Ponto de retomada da grade e as-run aberto da máquina antiga: sem dono
      // verificável, o servidor (corretamente) recusa abrir o canal. A grade volta
      // do início e o item que estava no ar é encerrado no último registro do banco.
      if (tableExists('channel_checkpoints')) report.removed.channel_checkpoints = db.prepare('DELETE FROM channel_checkpoints').run().changes
      if (tableExists('as_run')) {
        const last = db.prepare('SELECT max(started_at) t FROM as_run').get().t
        report.cleared['as_run aberto (encerrado em ' + last + ')'] = db.prepare("UPDATE as_run SET ended_at=?, ended_by='STOP' WHERE ended_at IS NULL").run(last).changes
      }
      // Tabelas de origem de restaurações anteriores guardam só o envelope cifrado.
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'restored_origin_%'").all()) {
        db.exec(`DROP TABLE "${name}"`); report.removed['tabelas restored_origin_*'] = (report.removed['tabelas restored_origin_*'] || 0) + 1
      }
      // 3c. Varredura geral: qualquer outro valor cifrado em qualquer tabela.
      const known = new Set(PROTECTED.map(([t, c]) => `${t}.${c}`))
      for (const { name: table } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
        for (const col of db.prepare(`PRAGMA table_info("${table}")`).all()) {
          if (known.has(`${table}.${col.name}`)) continue
          const n = count(`SELECT count(*) n FROM "${table}" WHERE typeof("${col.name}")='text' AND "${col.name}" LIKE ?`, PREFIX + '%')
          if (!n) continue
          const key = `${table}.${col.name}`
          if (!col.notnull && !col.pk) report.cleared[key] = db.prepare(`UPDATE "${table}" SET "${col.name}"=NULL WHERE "${col.name}" LIKE ?`).run(PREFIX + '%').changes
          else report.removed[key] = db.prepare(`DELETE FROM "${table}" WHERE "${col.name}" LIKE ?`).run(PREFIX + '%').changes
        }
      }
      // 4. Chave antiga esquecida: o servidor cria um cofre novo na primeira partida.
      // A chave antiga embrulhada pela senha de recuperação não serve à chave nova.
      if (tableExists('vault_metadata')) db.prepare('DELETE FROM vault_metadata').run()
      if (tableExists('vault_recovery')) report.removed['vault_recovery (chave antiga)'] = db.prepare('DELETE FROM vault_recovery').run().changes
      // 5. Dependentes órfãos das linhas apagadas.
      for (let pass = 0; pass < 5; pass++) {
        const orphans = db.prepare('PRAGMA foreign_key_check').all()
        if (!orphans.length) break
        for (const row of orphans) {
          db.prepare(`DELETE FROM "${row.table}" WHERE rowid=?`).run(row.rowid)
          report.removed[row.table + ' (órfãos)'] = (report.removed[row.table + ' (órfãos)'] || 0) + 1
        }
      }
      // 6. Índice de comandos de grafismo pendentes: reconstruído a partir do que
      // ficou em operator_decisions. Apagá-lo inteiro deixaria de fora os
      // comandos aceitos em claro ainda sem resolução, e o servidor recusa a
      // partida ("Índice de comandos pendentes diverge do histórico").
      if (tableExists('graphic_command_pending') && tableExists('operator_decisions') && db.prepare('SELECT 1 FROM schema_migrations WHERE version=49').get()) {
        const indexed = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='graphic_command_phase_identity'").get()
        const expected = indexed ? GRAPHIC_PENDING_EXPECTED : GRAPHIC_PENDING_EXPECTED.replace(' INDEXED BY graphic_command_phase_identity', '')
        db.prepare('DELETE FROM graphic_command_pending').run()
        report.rebuilt = { graphic_command_pending: db.prepare(`INSERT INTO graphic_command_pending(id,scope) ${expected}`).run().changes }
      }
      for (const { tbl_name, sql } of triggers) if (tableExists(tbl_name)) db.exec(sql)
    })()
    // Conferências finais: nenhum valor cifrado sobrou, chaves estrangeiras e integridade.
    const leftovers = PROTECTED.filter(([table, column]) => tableExists(table) && db.prepare(`PRAGMA table_info("${table}")`).all().some(col => col.name === column))
      .map(([table, column]) => [`${table}.${column}`, count(`SELECT count(*) n FROM "${table}" WHERE "${column}" LIKE ?`, PREFIX + '%')]).filter(([, n]) => n)
    if (leftovers.length) throw new Error('Sobraram valores cifrados: ' + JSON.stringify(leftovers))
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Chaves estrangeiras inconsistentes depois da limpeza.')
    const expected = triggers.filter(t => tableExists(t.tbl_name)).length
    const triggersAfter = count("SELECT count(*) n FROM sqlite_master WHERE type='trigger'")
    if (triggersAfter !== expected) throw new Error(`Gatilhos não recriados (${triggersAfter} de ${expected}).`)
    db.exec('VACUUM')
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Banco novo falhou no integrity_check.')
    for (const table of ['media_assets', 'rundowns', 'rundown_items', 'channels', 'users', 'as_run', 'categories', 'graphic_templates', 'qc_decisions', 'health_events'])
      if (tableExists(table)) report.kept[table] = count(`SELECT count(*) n FROM "${table}"`)
    report.triggers = expected
  } catch (error) {
    db.close(); fs.rmSync(target, { force: true }); throw error
  }
  db.close()
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  return report
}

if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)) }
  catch (error) { console.error('ERRO: ' + error.message); process.exit(1) }
}
module.exports = { main, GRAPHIC_PENDING_EXPECTED }

import type Database from 'better-sqlite3'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'

/** Acknowledgement is not resolution: preserve unresolved PGM incidents even
 * after the operator acknowledges or the signal can no longer be observed. */
export function pruneHealthHistory(sqlite:Database.Database,days:number,now=Date.now(),batch=5000):number{
  if(!Number.isFinite(days)||days<=0||!Number.isFinite(now)||isRecoveryRehearsal(sqlite))return 0
  const cutoffTime=now-days*86400000
  if(!Number.isFinite(cutoffTime)||Math.abs(cutoffTime)>8640000000000000)return 0
  const cutoff=new Date(cutoffTime).toISOString()
  // INFO não pede ciente (não entra em pendências nem em notificações): sem
  // esta cláusula, todo INFO -- inclusive as repetições agrupadas de uma
  // condição que se repete o dia todo -- ficava para sempre. Aviso e crítico
  // sem ciente continuam preservados até alguém reconhecer.
  // Em lotes, como a auditoria HTTP: o primeiro expurgo de um banco grande não
  // segura o armazenamento por segundos.
  return sqlite.prepare(`DELETE FROM health_events WHERE rowid IN (SELECT rowid FROM health_events WHERE occurred_at<?
    AND (acknowledged_at<? OR (acknowledged_at IS NULL AND severity='INFO'))
    AND (NOT((component='SIGNAL' AND id LIKE 'pgm-signal:%:active') OR id LIKE 'runtime-signal:%:active') OR resolved_at<?) LIMIT ?)`).run(cutoff,cutoff,cutoff,batch).changes
}

/** HTTP request audit (route, actor, status; one row per mutation) is not an
 * operational decision record. Unbounded, it reached 56 thousand rows and
 * 15 MB in two days of monitor heartbeats. Keep a window; operational
 * decisions, as-run and incidents are untouched. Batched so one call never
 * holds the storage lock for long. */
export function pruneHttpAudit(sqlite:Database.Database,days:number,now=Date.now(),batch=5000):number{
  if(!Number.isFinite(days)||days<=0||!Number.isFinite(now)||isRecoveryRehearsal(sqlite))return 0
  const cutoffTime=now-days*86400000
  if(!Number.isFinite(cutoffTime)||Math.abs(cutoffTime)>8640000000000000)return 0
  const cutoff=new Date(cutoffTime).toISOString()
  return sqlite.prepare(`DELETE FROM operator_decisions WHERE rowid IN (SELECT rowid FROM operator_decisions WHERE rundown_id='@http' AND kind='API_MUTATION' AND created_at<? LIMIT ?)`).run(cutoff,batch).changes
}

/** Incidentes já RESOLVIDOS que ninguém reconheceu. A regra acima só tira o
 * que tem ciente (ou INFO), então todo crítico que se recupera sozinho --
 * um VT mudo em loop abre e fecha SILÊNCIO a cada volta -- ficava para
 * sempre (3 088 linhas em 14 dias, ~2 kB cada, na produção r88-35). A
 * resolução gravada é o fim do incidente; depois da janela ele sai. O que
 * não tem resolução continua preservado, com ou sem ciente. Em lotes. */
export function pruneResolvedHealth(sqlite:Database.Database,days:number,now=Date.now(),batch=5000):number{
  if(!Number.isFinite(days)||days<=0||!Number.isFinite(now)||isRecoveryRehearsal(sqlite))return 0
  const cutoffTime=now-days*86400000
  if(!Number.isFinite(cutoffTime)||Math.abs(cutoffTime)>8640000000000000)return 0
  const cutoff=new Date(cutoffTime).toISOString()
  return sqlite.prepare(`DELETE FROM health_events WHERE rowid IN (SELECT rowid FROM health_events WHERE occurred_at<?
    AND acknowledged_at IS NULL AND resolved_at IS NOT NULL AND resolved_at<? LIMIT ?)`).run(cutoff,cutoff,batch).changes
}

import type Database from 'better-sqlite3'
import {isAbsolute} from 'node:path'
import type {ScanBatchDiagnostic} from '@rplayout/protocol'
import {executionHostIdentity} from './execution-host.js'
export interface ScanOwnerRow {id:string;state:string;roots:string;measure:number;owner_host:string|null;owner_pid:number|null;owner_boot:string|null}
export function validScanIntent(row:Pick<ScanOwnerRow,'roots'|'measure'>):boolean{
  let roots:unknown;try{roots=JSON.parse(row.roots)}catch{return false}
  return [0,1].includes(row.measure)&&Array.isArray(roots)&&roots.length>0&&roots.every(path=>typeof path==='string'&&path.trim()===path&&!path.includes('\0')&&isAbsolute(path))
}
export function diagnoseScan(row:ScanOwnerRow,canRecover=false):ScanBatchDiagnostic{
  const result=(ownership:ScanBatchDiagnostic['ownership'],message:string,recover=false)=>({id:row.id,state:row.state,ownership,message,canRecover:recover&&canRecover})
  if(!validScanIntent(row))return result('INVALID','Raízes ou modo do lote são inválidos. Lote preservado; não será executado nem substituído silenciosamente.')
  if(row.state==='PENDING'){
    if(row.owner_host!==null||row.owner_pid!==null||row.owner_boot!==null)return result('UNKNOWN','Lote pendente ainda registra um responsável. Não presumir liberação; solicite diagnóstico da instância anterior.')
    return result('WAITING','Pedido registrado e aguardando sua vez. Não é uma leitura concluída.')
  }
  if(row.state!=='RUNNING')return result('INVALID','Estado não executável; nenhuma posse presumida.')
  if(!row.owner_host||!row.owner_boot||!Number.isSafeInteger(row.owner_pid)||row.owner_pid!<1)return result('UNKNOWN','Responsável legado ou não identificável. Confirme a situação da instalação anterior; retomada automática bloqueada.')
  if(row.owner_host!==executionHostIdentity())return result('REMOTE','Responsável de outra máquina ou identidade não comparável. Verificar o nó anterior; um PID local não prova encerramento remoto.')
  try{process.kill(row.owner_pid!,0);return result('LOCAL_ALIVE','Processo local ainda existe. A leitura está protegida; não retomar nem matar por PID presumido.')}
  catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return result('LOCAL_DEAD','O sistema confirmou que o processo local encerrou. É possível solicitar retomada do mesmo lote.',true);return result('UNCERTAIN','Não foi possível comprovar encerramento do processo local. Posse preservada; não retomar por timeout.')}
}
export function readScanDiagnostics(sqlite:Database.Database,canRecover=false):ScanBatchDiagnostic[]{
  const rows=sqlite.prepare("SELECT id,state,roots,measure,owner_host,owner_pid,owner_boot FROM ingest_batches WHERE state IN('PENDING','RUNNING') ORDER BY created_at,id").all() as ScanOwnerRow[]
  return rows.map(row=>diagnoseScan(row,canRecover))
}

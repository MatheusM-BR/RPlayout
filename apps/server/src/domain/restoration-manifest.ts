import type Database from 'better-sqlite3'
import {lstat,open} from 'node:fs/promises'
import {z} from 'zod'
import {restoreReportSchema} from './restore-report.js'
import {installationVault} from './secret-vault.js'
import {assertCurrentRestorationReport,restorationRecordSignature} from '../db/restoration-records.js'
const manifestSchema=z.object({report:restoreReportSchema,protectedProvenance:z.string().min(1)}).strict()
/** Read-only identity check, not activation. Never trusts an external JSON
 * report alone, an older restoration receipt or an unauthenticated origin. */
export async function verifyRestorationManifest(sqlite:Database.Database,path:string){
  const before=await lstat(path)
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>1024*1024)throw new Error('Manifesto de restauração deve ser arquivo regular, sem links, até 1 MB.')
  const file=await open(path,'r')
  let input:unknown
  try{
    const actual=await file.stat()
    if(actual.dev!==before.dev||actual.ino!==before.ino||actual.size!==before.size)throw new Error('Manifesto mudou durante a leitura.')
    input=JSON.parse(await file.readFile('utf8'))
    const after=await file.stat()
    if(after.size!==actual.size||after.mtimeMs!==actual.mtimeMs)throw new Error('Manifesto mudou durante a leitura.')
  }finally{await file.close()}
  const manifest=manifestSchema.parse(input)
  const protectedReport=restoreReportSchema.parse(JSON.parse(installationVault(false).decrypt(manifest.protectedProvenance,'backup-restore:v1:report')))
  if(restorationRecordSignature(manifest.report)!==restorationRecordSignature(protectedReport))throw new Error('Relatório público não corresponde ao manifesto protegido.')
  return assertCurrentRestorationReport(sqlite,protectedReport)
}

import {mkdtempSync,rmSync,writeFileSync,utimesSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it} from 'vitest'
import {backupDue} from './backup.js'

const dirs:string[]=[]
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
const folder=()=>{const d=mkdtempSync(join(tmpdir(),'rplayout-backup-due-'));dirs.push(d);return d}

it('sem cópia na pasta (ou pasta ausente) a cópia periódica é devida; só a de atualização não conta',async()=>{
  const d=folder()
  expect(await backupDue(join(d,'nao-existe'),24)).toBe(true)
  mkdirSync(join(d,'upgrade'));writeFileSync(join(d,'upgrade','rplayout-2026-10-27T00-00-00-000Z-x.db'),'x')
  expect(await backupDue(d,24)).toBe(true)
})
it('mede pela cópia mais nova no disco, não pela partida do processo',async()=>{
  const d=folder(),now=Date.parse('2026-10-27T12:00:00Z')
  const old=join(d,'rplayout-2026-10-26T00-00-00-000Z-a.db'),recent=join(d,'rplayout-2026-10-27T06-00-00-000Z-b.db')
  writeFileSync(old,'a');utimesSync(old,new Date(now-36*3600e3),new Date(now-36*3600e3))
  expect(await backupDue(d,24,now)).toBe(true)
  writeFileSync(recent,'b');utimesSync(recent,new Date(now-6*3600e3),new Date(now-6*3600e3))
  expect(await backupDue(d,24,now)).toBe(false)
  expect(await backupDue(d,0,now)).toBe(false)
})

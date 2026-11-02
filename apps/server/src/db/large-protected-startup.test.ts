import {existsSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {openDatabase} from './client.js'
import {operatorDecisions} from './schema.js'
import {validateDatabaseSecrets} from './vault-migration.js'

// Regression r88-17 (22/10): one audit row per HTTP mutation grew
// operator_decisions.payload past the storage process reply buffer (16 MiB)
// and the server stopped starting: "Resposta de banco excede o limite privado".
const dist=resolve(__dirname,'../../dist')
const available=existsSync(join(dist,'storage-bridge.cjs'))&&existsSync(join(dist,'storage-service.cjs'))
let directory='',saved:Record<string,string|undefined>={}
beforeAll(()=>{saved={bin:process.env.RPLAYOUT_STORAGE_BIN_DIR,mode:process.env.RPLAYOUT_STORAGE_MODE};process.env.RPLAYOUT_STORAGE_BIN_DIR=dist;directory=mkdtempSync(join(tmpdir(),'rplayout-large-'))})
afterAll(()=>{for(const [key,name] of [['bin','RPLAYOUT_STORAGE_BIN_DIR'],['mode','RPLAYOUT_STORAGE_MODE']] as const){if(saved[key]===undefined)delete process.env[name];else process.env[name]=saved[key]}rmSync(directory,{recursive:true,force:true})})
it.skipIf(!available)('banco com mais de 16 MiB de auditoria cifrada abre no processo de armazenamento',()=>{
  const file=join(directory,'big.db')
  process.env.RPLAYOUT_STORAGE_MODE='INLINE'
  const seed=openDatabase(file)
  const filler='x'.repeat(8_000),now=new Date().toISOString()
  seed.sqlite.transaction(()=>{for(let i=0;i<3_000;i++)seed.db.insert(operatorDecisions).values({id:randomUUID(),rundownId:'@http',itemId:null,kind:'API_MUTATION',payload:{i,filler},actorUsername:null,createdAt:now}).run()})()
  const bytes=(seed.sqlite.prepare("SELECT sum(length(payload)) AS b FROM operator_decisions").get() as {b:number}).b
  seed.sqlite.close()
  expect(bytes).toBeGreaterThan(17*2**20)
  process.env.RPLAYOUT_STORAGE_MODE='PROCESS'
  const reopened=openDatabase(file)
  try{
    expect((reopened.sqlite.prepare("SELECT count(*) AS n FROM operator_decisions WHERE kind='API_MUTATION'").get() as {n:number}).n).toBe(3_000)
    expect(validateDatabaseSecrets(reopened.sqlite).protectedSecrets).toBe('verified')
  }finally{reopened.sqlite.close()}
},120_000)

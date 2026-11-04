import {afterEach,expect,it,vi} from 'vitest'
const calls:Array<{file:string;args:string[];options:{env?:NodeJS.ProcessEnv;input?:string}}>=[]
vi.mock('node:child_process',async original=>({...await original<Record<string,unknown>>(),execFileSync:(file:string,args:string[],options:{env?:NodeJS.ProcessEnv;input?:string})=>{calls.push({file,args,options});return Buffer.from('protegido').toString('base64')}}))
const {windowsProtect,windowsHelperEnvironment}=await import('./secret-vault.js')
const saved={...process.env}
afterEach(()=>{process.env={...saved};calls.length=0})

it('o PowerShell do DPAPI recebe um ambiente mínimo, sem senha de recuperação nem chave do cofre',()=>{
  process.env.RPLAYOUT_RECOVERY_PASSWORD='senha-de-recuperacao-vazada'
  process.env.RPLAYOUT_VAULT_KEY='a'.repeat(64)
  process.env.RPLAYOUT_AUTH_PASSWORD='outra'
  process.env.SystemRoot='C:\\Windows';process.env.USERPROFILE='C:\\Users\\op';process.env.PATH='C:\\Windows\\System32'
  expect(windowsProtect(Buffer.from('chave'),false).toString()).toBe('protegido')
  expect(calls).toHaveLength(1)
  const env=calls[0]!.options.env
  expect(env).toBeDefined()
  expect(Object.keys(env!).filter(name=>name.startsWith('RPLAYOUT_'))).toEqual([])
  expect(JSON.stringify(env)).not.toContain('senha-de-recuperacao-vazada')
  expect(env).toMatchObject({SystemRoot:'C:\\Windows',USERPROFILE:'C:\\Users\\op'})
  // A chave vai pelo stdin, nunca por argumento nem ambiente.
  expect(calls[0]!.args.join(' ')).not.toContain(Buffer.from('chave').toString('base64'))
})
it('lista fechada, sem diferenciar maiúsculas (Path no Windows)',()=>{
  expect(windowsHelperEnvironment({Path:'x',systemroot:'C:\\W',RPLAYOUT_VAULT_FILE:'v',SECRET:'s',HTTPS_PROXY:'http://u:p@proxy'})).toEqual({Path:'x',systemroot:'C:\\W'})
})

import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
vi.mock('node:child_process',()=>({execFileSync:vi.fn()}))
vi.mock('node:fs',()=>({readFileSync:vi.fn()}))
const descriptor=Object.getOwnPropertyDescriptor(process,'platform')!
const platform=(value:string)=>Object.defineProperty(process,'platform',{...descriptor,value})
const guid='01234567-89ab-cdef-0123-456789abcdef'
beforeEach(()=>{vi.resetModules();vi.mocked(execFileSync).mockReset();vi.mocked(readFileSync).mockReset()})
afterEach(()=>{Object.defineProperty(process,'platform',descriptor);vi.unstubAllEnvs()})
describe('identidade local opaca, nunca nome de computador ou consulta de rede',()=>{
  it('Windows usa identidade do SO, sem shell, e mantém o cache por processo',async()=>{
    platform('win32');vi.stubEnv('SystemRoot','C:\\Windows')
    vi.mocked(execFileSync).mockReturnValue('    MachineGuid    REG_SZ    '+guid.toUpperCase()+'\r\n')
    const {executionHostIdentity}=await import('./execution-host.js'),id=executionHostIdentity()
    expect(id).toBe(createHash('sha256').update('rplayout-execution-host:v1:win32:'+guid).digest('hex'))
    expect(id).not.toContain(guid);expect(executionHostIdentity()).toBe(id)
    expect(execFileSync).toHaveBeenCalledTimes(1)
    expect(execFileSync).toHaveBeenCalledWith(expect.stringMatching(/System32[\\/]reg\.exe$/),['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid','/reg:64'],{windowsHide:true,timeout:1500,encoding:'utf8',stdio:['ignore','pipe','pipe']})
    expect(readFileSync).not.toHaveBeenCalled()
  })
  it.each(['ACCESS_DENIED','bad-format','hyphens-only'])('identidade indisponível mantém somente confiança neste processo: %s',kind=>{
    platform('win32')
    if(kind==='ACCESS_DENIED')vi.mocked(execFileSync).mockImplementation(()=>{throw new Error(kind)})
    else vi.mocked(execFileSync).mockReturnValue('MachineGuid REG_SZ '+(kind==='hyphens-only'?'-'.repeat(36):guid+'extra'))
    return import('./execution-host.js').then(({executionHostIdentity})=>{const id=executionHostIdentity();expect(id).toMatch(/^unknown-process:[a-f0-9-]{36}$/);expect(executionHostIdentity()).toBe(id);expect(execFileSync).toHaveBeenCalledTimes(1)})
  })
  it('Linux valida machine-id, sem hostname nem registro Windows',async()=>{
    platform('linux');vi.mocked(readFileSync).mockReturnValue('A'.repeat(32)+'\n')
    const {executionHostIdentity}=await import('./execution-host.js')
    expect(executionHostIdentity()).toBe(createHash('sha256').update('rplayout-execution-host:v1:linux:'+ 'a'.repeat(32)).digest('hex'))
    expect(execFileSync).not.toHaveBeenCalled();expect(readFileSync).toHaveBeenCalledWith('/etc/machine-id','utf8')
  })
  it('fallback muda em outra vida de processo; nunca presume que seja a mesma máquina',async()=>{
    platform('unsupported');const first=(await import('./execution-host.js')).executionHostIdentity()
    vi.resetModules();const second=(await import('./execution-host.js')).executionHostIdentity()
    expect(second).not.toBe(first);expect(execFileSync).not.toHaveBeenCalled();expect(readFileSync).not.toHaveBeenCalled()
  })
})

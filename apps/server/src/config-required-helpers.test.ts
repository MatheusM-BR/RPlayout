import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
let directory:string|undefined
afterEach(async()=>{vi.unstubAllEnvs();vi.resetModules();if(directory)await rm(directory,{recursive:true,force:true});directory=undefined})
async function install(){directory=await mkdtemp(join(tmpdir(),'RPlayout-helper-install-'));vi.stubEnv('RPLAYOUT_INSTALL_ROOT',directory);vi.stubEnv('RPLAYOUT_HOST_GUARD',undefined);vi.stubEnv('RPLAYOUT_FILE_SECURITY',undefined);vi.resetModules();return directory}
it('instalação declarada sem auxiliares não empresta binários do workspace de desenvolvimento',async()=>{
  await install();const config=await import('./config.js');expect(config.HOST_GUARD_BINARY).toBe('');expect(config.FILE_SECURITY_BINARY).toBe('')
})
it('resolve somente os auxiliares incluídos na instalação mesmo durante VITEST',async()=>{
  const root=await install(),bin=join(root,'apps/engine/target/release');await mkdir(bin,{recursive:true})
  for(const name of['rplayout-host-guard','rplayout-file-security'])await writeFile(join(bin,name+'.exe'),'FIXTURE_NOT_EXECUTABLE',{flag:'wx'})
  const config=await import('./config.js');expect(config.HOST_GUARD_BINARY).toBe(join(bin,'rplayout-host-guard.exe'));expect(config.FILE_SECURITY_BINARY).toBe(join(bin,'rplayout-file-security.exe'))
})
it('configuração explícita de caminho permanece explícita, sem presumir admissão do auxiliar',async()=>{
  await install();vi.stubEnv('RPLAYOUT_HOST_GUARD','explicit-guard.exe');vi.stubEnv('RPLAYOUT_FILE_SECURITY','explicit-file.exe')
  const config=await import('./config.js');expect(config.HOST_GUARD_BINARY).toBe('explicit-guard.exe');expect(config.FILE_SECURITY_BINARY).toBe('explicit-file.exe')
})

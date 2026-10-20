import {it,expect,vi} from 'vitest'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {PassThrough} from 'node:stream'
import {execFile} from 'node:child_process'
import {protectGeneratedHaDirectory} from './private-config-file.js'
// NOT_RUN: helper invocation/refusal fixtures, NOT a Windows ACL proof.
vi.mock('../config.js',()=>({FILE_SECURITY_BINARY:'MOCK_FILE_SECURITY'}))
vi.mock('node:child_process',()=>({execFile:vi.fn((_binary:unknown,_args:unknown,_options:unknown,callback:(error:null,result:string)=>void)=>{
  queueMicrotask(()=>callback(null,'PROTECTED'));return {stdin:new PassThrough()}
})}))
it('only generated empty HA directories can request protection',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ha-private-directory-'));try{
    const user=join(root,'user-folder');await mkdir(user)
    await expect(protectGeneratedHaDirectory(user)).rejects.toThrow('gerado novo e vazio')
    const generated=join(root,'.ha-execution.private-'+randomUUID());await mkdir(generated)
    await protectGeneratedHaDirectory(generated)
    if(process.platform==='win32')expect(vi.mocked(execFile)).toHaveBeenCalledWith('MOCK_FILE_SECURITY',['--private-directory-stdin'],expect.any(Object),expect.any(Function))
    await writeFile(join(generated,'existing'),'PRESERVE')
    await expect(protectGeneratedHaDirectory(generated)).rejects.toThrow('gerado novo e vazio')
  }finally{await rm(root,{recursive:true,force:true})}
})

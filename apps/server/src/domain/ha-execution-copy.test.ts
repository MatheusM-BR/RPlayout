import {it,expect,vi} from 'vitest'
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {stageHaExecutionCopy,verifyStagedHaExecutionCopy} from './ha-execution-copy.js'
import type {HaRecovery} from './ha-recovery.js'
// NOT_RUN: byte-copy fixtures, NOT schema admission or Windows ACL evidence.
vi.mock('./private-config-file.js',()=>({protectGeneratedHaDirectory:async()=>{},writePrivateConfig:async(path:string,content:string)=>{
  const {writeFile}=await import('node:fs/promises');await writeFile(path,content,{flag:'wx',mode:0o600})
}}))
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'ha-execution-copy-')),file=join(root,'prepared.db')
  const bytes=Buffer.from('COPY_CONTRACT_FIXTURE_NOT_AN_ADMITTED_SQLITE_DATABASE')
  await writeFile(file,bytes,{flag:'wx',mode:0o600})
  const sha=createHash('sha256').update(bytes).digest('hex')
  const candidate={databaseFile:file,databaseHash:sha,verifyCurrent:async()=>{},candidate:{request:{requestId:randomUUID()},channel:{id:'ch'}}} as unknown as Awaited<ReturnType<HaRecovery['activationCandidate']>>
  return {root,file,bytes,candidate,cleanup:()=>rm(root,{recursive:true,force:true})}
}
it('creates a distinct byte-identical copy and preserves the original',async()=>{
  const f=await fixture();try{
    const copy=await stageHaExecutionCopy(f.candidate,join(f.root,'executions'),randomUUID(),async()=>{},new AbortController().signal)
    expect(copy.file).not.toBe(f.file);expect(await readFile(copy.file)).toEqual(f.bytes);expect(await readFile(f.file)).toEqual(f.bytes)
    const manifest=JSON.parse(await readFile(join(copy.file,'..','origin.json'),'utf8'))
    expect(manifest.version).toBe(1);expect(typeof manifest.ciphertext).toBe('string');expect(manifest.file).toBeUndefined()
    await verifyStagedHaExecutionCopy(copy,f.candidate,join(f.root,'executions'),async()=>{},new AbortController().signal)
  }finally{await f.cleanup()}
})
it('same UUID refuses overwrite rather than copying/replaying into an existing execution',async()=>{
  const f=await fixture();try{
    const id=randomUUID(),root=join(f.root,'executions'),signal=new AbortController().signal
    const copy=await stageHaExecutionCopy(f.candidate,root,id,async()=>{},signal)
    await expect(stageHaExecutionCopy(f.candidate,root,id,async()=>{},signal)).rejects.toThrow()
    expect(await readFile(copy.file)).toEqual(f.bytes);expect(await readFile(f.file)).toEqual(f.bytes)
  }finally{await f.cleanup()}
})
it('wrong source hash preserves partial isolated copy without changing the preparation',async()=>{
  const f=await fixture();try{
    const id=randomUUID(),root=join(f.root,'executions')
    await expect(stageHaExecutionCopy({...f.candidate,databaseHash:'00'.repeat(32)},root,id,async()=>{},new AbortController().signal)).rejects.toThrow('mudou durante')
    expect(await readFile(f.file)).toEqual(f.bytes)
    await access(join(root,'.ha-execution.private-'+id,'operational.db'))
    await expect(access(join(root,'.ha-execution.private-'+id,'origin.json'))).rejects.toThrow()
  }finally{await f.cleanup()}
})
it('refuses changed bytes, mismatched UUID and an opened staged copy',async()=>{
  const f=await fixture();try{
    const root=join(f.root,'executions'),signal=new AbortController().signal
    const copy=await stageHaExecutionCopy(f.candidate,root,randomUUID(),async()=>{},signal)
    await expect(verifyStagedHaExecutionCopy({...copy,id:randomUUID()},f.candidate,root,async()=>{},signal)).rejects.toThrow()
    await writeFile(copy.file+'-wal','NOT_AN_ADMITTED_WAL')
    await expect(verifyStagedHaExecutionCopy(copy,f.candidate,root,async()=>{},signal)).rejects.toThrow('aberta/alterada')
    await rm(copy.file+'-wal');await writeFile(copy.file,'CHANGED')
    await expect(verifyStagedHaExecutionCopy(copy,f.candidate,root,async()=>{},signal)).rejects.toThrow('diverge')
    expect(await readFile(f.file)).toEqual(f.bytes)
  }finally{await f.cleanup()}
})

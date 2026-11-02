import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect,it,vi} from 'vitest'
// Explicit missing-helper fixture, not a grant or test-mode production bypass.
vi.mock('../config.js',()=>({FILE_SECURITY_BINARY:''}))
import {writePrivateConfig} from './private-config-file.js'

it.skipIf(process.platform!=='win32')('auxiliar Windows ausente recusa publicação e preserva configuração anterior',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'RPlayout-file-helper-missing-'))
  try{
    const target=join(directory,'mediamtx.yml');await writeFile(target,'ORIGINAL_BYTES')
    await expect(writePrivateConfig(target,'PRIVATE_NEW_KEY')).rejects.toThrow('Auxiliar de proteção de arquivos ausente')
    expect(await readFile(target,'utf8')).toBe('ORIGINAL_BYTES');expect(await readdir(directory)).toEqual(['mediamtx.yml'])
  }finally{await rm(directory,{recursive:true,force:true})}
})

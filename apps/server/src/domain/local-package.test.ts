import {afterEach,it,expect} from 'vitest'
import {mkdtemp,writeFile,mkdir,rm,link,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {verifyLocalPackage} from './local-package.js'
const roots:string[]=[]
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true})})
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
async function fixture(){const root=await mkdtemp(join(tmpdir(),'rplayout-package-integrity-'));roots.push(root);await writeFile(join(root,'server.cjs'),'fixture');return root}
async function manifest(root:string,files:any[]=[{file:'server.cjs',bytes:7,sha256:hash('fixture')}]){await writeFile(join(root,'package-manifest.json'),JSON.stringify({version:1,files}))}
it('confere bytes e ferramentas declaradas sem executar o arquivo',async()=>{const root=await fixture();await manifest(root);const report=await verifyLocalPackage(root,['server.cjs']);expect(report.files.get('server.cjs')).toBe(join(root,'server.cjs'));await expect(verifyLocalPackage(root,['unknown.exe'])).rejects.toThrow('não consta')})
it.each(['../outside.cjs','/root.cjs','C:/server.cjs','dir/./server.cjs','dir//file','NUL','CON.txt','file.'])('recusa catálogo inseguro %s',async file=>{const root=await fixture();await manifest(root,[{file,bytes:7,sha256:hash('fixture')}]);await expect(verifyLocalPackage(root,[])).rejects.toThrow('caminho inválido')})
it('recusa duplicata sem distinção de caixa e conteúdo alterado',async()=>{const root=await fixture();await manifest(root,[{file:'server.cjs',bytes:7,sha256:hash('fixture')},{file:'SERVER.CJS',bytes:7,sha256:hash('fixture')}]);await expect(verifyLocalPackage(root,[])).rejects.toThrow('repetido');await manifest(root);await writeFile(join(root,'server.cjs'),'changed');await expect(verifyLocalPackage(root,[])).rejects.toThrow('Integridade')})
it('recusa hardlink de arquivo e junction em ancestral do pacote',async()=>{const root=await fixture();await manifest(root);await link(join(root,'server.cjs'),join(root,'linked'));await expect(verifyLocalPackage(root,[])).rejects.toThrow('sem links');const outer=await mkdtemp(join(tmpdir(),'rplayout-package-junction-'));roots.push(outer);await mkdir(join(root,'child'));await symlink(root,join(outer,'package'),process.platform==='win32'?'junction':'dir');await expect(verifyLocalPackage(join(outer,'package'),[])).rejects.toThrow('links/junções')})

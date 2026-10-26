import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {lstat,readFile} from 'node:fs/promises'
import {dirname,isAbsolute,resolve,join,sep} from 'node:path'
import {z} from 'zod'

const manifestSchema=z.object({version:z.literal(1),files:z.array(z.object({file:z.string().min(1),bytes:z.number().int().nonnegative().max(100*1024**3),sha256:z.string().regex(/^[a-fA-F0-9]{64}$/)}).strict()).min(1).max(100000)}).passthrough()
export async function regularFileStamp(file:string){const info=await lstat(file,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n)throw new Error('Arquivo deve ser regular, sem links.');return [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':')}
export async function fileSha256(file:string){const digest=createHash('sha256');for await(const bytes of createReadStream(file))digest.update(bytes);return digest.digest('hex')}
export async function physicalDirectory(path:string){let current=resolve(path);while(true){const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Pasta física sem links/junções é obrigatória.');const parent=dirname(current);if(parent===current)return;current=parent}}
/** Integrity, not publisher authenticity. A package writable by the same local
 * account is not a sandbox for hostile executable code. No process is started. */
export async function verifyLocalPackage(directory:string,required:readonly string[]){
  if(!isAbsolute(directory))throw new Error('Instalação exige caminho absoluto.')
  const root=resolve(directory),prefix=root.toLowerCase()+sep
  await physicalDirectory(root)
  const manifestFile=join(root,'package-manifest.json'),before=await regularFileStamp(manifestFile),manifestSha256=await fileSha256(manifestFile)
  const manifest=manifestSchema.parse(JSON.parse(await readFile(manifestFile,'utf8'))),files=new Map<string,string>(),parents=new Set<string>()
  let total=0
  for(const entry of manifest.files){
    const name=entry.file.replaceAll('\\','/'),parts=name.split('/')
    if(parts.some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f:<>"|?*]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))||files.has(name.toLowerCase()))throw new Error('Manifesto com caminho inválido ou repetido.')
    const file=resolve(root,...parts)
    if(!file.toLowerCase().startsWith(prefix))throw new Error('Arquivo fora da instalação.')
    if(!parents.has(dirname(file))){await physicalDirectory(dirname(file));parents.add(dirname(file))}
    const stamp=await regularFileStamp(file),info=await lstat(file);total+=info.size
    if(total>100*1024**3||info.size!==entry.bytes||await fileSha256(file)!==entry.sha256.toLowerCase()||await regularFileStamp(file)!==stamp)throw new Error('Integridade do pacote não confirmada; arquivos preservados.')
    files.set(name.toLowerCase(),file)
  }
  for(const name of required)if(!files.has(name.toLowerCase()))throw new Error('Ferramenta exigida não consta no pacote: '+name)
  if(await regularFileStamp(manifestFile)!==before||await fileSha256(manifestFile)!==manifestSha256)throw new Error('Manifesto mudou durante a conferência.')
  return {root,manifestSha256,files}
}

import { randomUUID } from 'node:crypto'
import {lstatSync,renameSync} from 'node:fs'
import { execFile } from 'node:child_process'
import { lstat, open, rename, unlink,chmod,readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { mediaProcessEnvironment } from './media-process-environment.js'
import { FILE_SECURITY_BINARY } from '../config.js'

async function restrictFile(path: string,directory=false): Promise<void> {
  if (process.platform !== 'win32') return
  if (!FILE_SECURITY_BINARY) throw new Error('Auxiliar de proteção de arquivos ausente. Nenhuma nova chave foi publicada.')
  await new Promise<void>((resolvePromise, reject) => {
    const child = execFile(FILE_SECURITY_BINARY, [directory?'--private-directory-stdin':'--private-file-stdin'], {
      windowsHide: true, timeout: 5_000, maxBuffer: 8192, encoding: 'utf8',
      env: mediaProcessEnvironment(),
    }, (error, stdout) => {
      if (error || stdout.trim() !== 'PROTECTED') reject(new Error('Não foi possível restringir o arquivo de configuração ao usuário do servidor. Nenhuma nova chave foi publicada.'))
      else resolvePromise()
    })
    child.stdin?.on('error', () => {})
    // Only the path crosses the helper pipe; it never receives the secret.
    child.stdin?.end(JSON.stringify({ path }))
  })
}

/** Only a new, empty generated HA directory. No recursion, inherited broad
 * ACL fallback or permission change on the installation/user workspace root. */
export async function protectGeneratedHaDirectory(path:string):Promise<void>{
  const target=resolve(path),initial=await lstat(target)
  if(!/^\.ha-execution\.private-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(basename(target))||!initial.isDirectory()||initial.isSymbolicLink()||(await readdir(target)).length)throw new Error('Proteção HA exige diretório gerado novo e vazio.')
  if(process.platform==='win32')await restrictFile(target,true)
  else await chmod(target,0o700)
  const final=await lstat(target)
  if(!final.isDirectory()||final.isSymbolicLink()||final.dev!==initial.dev||final.ino!==initial.ino||(await readdir(target)).length||process.platform!=='win32'&&(final.mode&0o777)!==0o700)throw new Error('Diretório HA mudou durante a proteção.')
}

async function checkTarget(path: string): Promise<void> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Destino da configuração deve ser um arquivo regular, não um link ou diretório.')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

/** Protect an EMPTY temporary file before writing credentials. Rename keeps
 * the previous config intact on any failure and cannot mutate its hardlinks.
 * This is scoped to one generated configuration, not recursive ACL changes. */
export async function writePrivateConfig(path: string, content: string,authorize?:()=>void,verifyNative?:()=>Promise<void>): Promise<void> {
  authorize?.()
  const target = resolve(path)
  await checkTarget(target)
  const temporary = join(dirname(target), `.${basename(target)}.private-${randomUUID()}`)
  const handle = await open(temporary, 'wx', 0o600)
  const created = await handle.stat()
  let closed = false
  try {
    // Close the empty handle before Windows ACL manipulation.
    await handle.close(); closed = true
    await restrictFile(temporary)
    await verifyNative?.()
    authorize?.()
    const output = await open(temporary, 'r+')
    try {
      const actual = await output.stat(), name = await lstat(temporary)
      if (!name.isFile() || name.isSymbolicLink() || actual.dev !== created.dev || actual.ino !== created.ino
        || name.dev !== actual.dev || name.ino !== actual.ino || actual.nlink !== 1 || actual.size !== 0) {
        throw new Error('Arquivo temporário mudou antes da gravação. Nenhuma nova chave foi publicada.')
      }
      await output.writeFile(content, 'utf8'); await output.sync()
    }
    finally { await output.close() }
    await checkTarget(target)
    await verifyNative?.()
    const finalFile=lstatSync(temporary)
    if(!finalFile.isFile()||finalFile.isSymbolicLink()||finalFile.dev!==created.dev||finalFile.ino!==created.ino
      ||finalFile.nlink!==1||finalFile.size!==Buffer.byteLength(content,'utf8')){
      throw new Error('Arquivo temporário mudou antes da publicação. Configuração anterior preservada.')
    }
    if(authorize){authorize();renameSync(temporary,target)}
    else await rename(temporary, target)
  } finally {
    if (!closed) await handle.close()
    // Only our newly created temporary file is cleaned up, never the target.
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
  }
}

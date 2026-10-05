import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { mediaProcessEnvironment } from './media-process-environment.js'

const restrictWindowsFile = [
  "$ErrorActionPreference='Stop'",
  '[Console]::InputEncoding=[Text.Encoding]::UTF8',
  '$inputData=ConvertFrom-Json ([Console]::In.ReadToEnd())',
  '$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User',
  "$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')",
  '$acl=New-Object Security.AccessControl.FileSecurity',
  '$acl.SetOwner($owner)',
  '$acl.SetAccessRuleProtection($true,$false)',
  "$rule=New-Object Security.AccessControl.FileSystemAccessRule($owner,'FullControl','Allow'); $acl.AddAccessRule($rule)",
  "if($owner.Value -ne $system.Value) { $rule=New-Object Security.AccessControl.FileSystemAccessRule($system,'FullControl','Allow'); $acl.AddAccessRule($rule) }",
  '[IO.File]::SetAccessControl($inputData.path,$acl)',
  '$actual=[IO.File]::GetAccessControl($inputData.path)',
  "if(!$actual.AreAccessRulesProtected) { throw 'Permissions not protected' }",
  "$rules=@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))",
  "$expected=if($owner.Value -eq $system.Value) { 1 } else { 2 }; if($rules.Count -ne $expected) { throw 'Unexpected permissions' }",
  "foreach($rule in $rules) { if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($owner.Value,$system.Value) -or $rule.FileSystemRights -ne 'FullControl') { throw 'Unexpected permission' } }",
  "[Console]::Out.Write('PROTECTED')",
].join('; ')

async function restrictFile(path: string): Promise<void> {
  if (process.platform !== 'win32') return
  await new Promise<void>((resolvePromise, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', restrictWindowsFile], {
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

async function checkTarget(path: string): Promise<void> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Destino da configuração deve ser um arquivo regular, não um link ou diretório.')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

/** Protect an EMPTY temporary file before writing credentials. Rename keeps
 * the previous config intact on any failure and cannot mutate its hardlinks.
 * This is scoped to one generated configuration, not recursive ACL changes. */
export async function writePrivateConfig(path: string, content: string): Promise<void> {
  const target = resolve(path)
  await checkTarget(target)
  const temporary = join(dirname(target), `.${basename(target)}.private-${randomUUID()}`)
  const handle = await open(temporary, 'wx', 0o600)
  let closed = false
  try {
    // Close the empty handle before Windows ACL manipulation.
    await handle.close(); closed = true
    await restrictFile(temporary)
    const output = await open(temporary, 'r+')
    try { await output.writeFile(content, 'utf8'); await output.sync() }
    finally { await output.close() }
    await checkTarget(target)
    await rename(temporary, target)
  } finally {
    if (!closed) await handle.close()
    // Only our newly created temporary file is cleaned up, never the target.
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
  }
}

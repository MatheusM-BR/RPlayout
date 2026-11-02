import {win32} from 'node:path'

/** Resolve the OS component directly; never search an inherited PATH. */
export function windowsPowerShellExecutable(systemRoot:string|undefined):string{
  if(!systemRoot||! /^[A-Za-z]:[\\/]/.test(systemRoot))throw new Error('Diretório do Windows indisponível.')
  return win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe')
}

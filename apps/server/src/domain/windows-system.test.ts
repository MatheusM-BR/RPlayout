import {describe,it,expect} from 'vitest'
import {windowsPowerShellExecutable} from './windows-system.js'
describe('DPAPI uses an absolute Windows component, not PATH lookup',()=>{
  it('resolves standard and alternate OS directories',()=>{
    expect(windowsPowerShellExecutable('C:\\Windows')).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(windowsPowerShellExecutable('D:/Windows')).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })
  it.each([undefined,'','Windows','C:Windows','\\\\remote\\Windows'])('fails closed for unknown/nonlocal OS root %s',root=>{
    expect(()=>windowsPowerShellExecutable(root)).toThrow('Windows')
  })
})

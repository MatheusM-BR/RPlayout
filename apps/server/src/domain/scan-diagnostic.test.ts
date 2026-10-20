import {it,expect,vi,afterEach} from 'vitest'
import {resolve} from 'node:path'
import {diagnoseScan,type ScanOwnerRow} from './scan-diagnostic.js'
import {executionHostIdentity} from './execution-host.js'
afterEach(()=>vi.restoreAllMocks())
const row:ScanOwnerRow={id:'a',state:'RUNNING',roots:JSON.stringify([resolve('media')]),measure:0,owner_host:executionHostIdentity(),owner_pid:process.pid,owner_boot:'PRIVATE_BOOT'}
it('processo local existente nunca liberado; diagnóstico público não revela host/PID/boot',()=>{
  const result=diagnoseScan(row,true);expect(result.ownership).toBe('LOCAL_ALIVE');expect(result.canRecover).toBe(false)
  expect(JSON.stringify(result)).not.toContain('PRIVATE_BOOT');expect(JSON.stringify(result)).not.toContain(row.owner_host!);expect(Object.keys(result)).not.toContain('owner_pid')
})
it('somente ESRCH permite retomada; falta de permissão mantém incerteza',()=>{
  const kill=vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('dead'),{code:'ESRCH'})})
  expect(diagnoseScan(row,true).canRecover).toBe(true);expect(diagnoseScan(row,false).canRecover).toBe(false)
  kill.mockImplementation(()=>{throw Object.assign(new Error('denied'),{code:'EPERM'})});expect(diagnoseScan(row,true).ownership).toBe('UNCERTAIN');expect(diagnoseScan(row,true).canRecover).toBe(false)
})
it('dono remoto ou legado não é sondado pelo PID local nem declarado livre',()=>{
  const kill=vi.spyOn(process,'kill');expect(diagnoseScan({...row,owner_host:'remote'},true).ownership).toBe('REMOTE');expect(diagnoseScan({...row,owner_boot:null},true).ownership).toBe('UNKNOWN');expect(kill).not.toHaveBeenCalled()
})
it('PENDING contraditório e intenção inválida não são considerados fila liberada',()=>{
  expect(diagnoseScan({...row,state:'PENDING'},true).ownership).toBe('UNKNOWN')
  expect(diagnoseScan({...row,state:'PENDING',owner_host:null,owner_pid:null,owner_boot:null},true).ownership).toBe('WAITING')
  for(const patch of [{roots:'[]'},{roots:'broken'},{roots:'["relative"]'},{measure:2}])expect(diagnoseScan({...row,...patch},true).ownership).toBe('INVALID')
})

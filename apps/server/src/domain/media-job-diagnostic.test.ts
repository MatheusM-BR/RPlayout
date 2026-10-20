import {describe,it,expect} from 'vitest'
import {mediaJobDiagnostic,mediaJobNeedsOwnerConfirmation} from './media-job-diagnostic.js'
import {executionHostIdentity} from './execution-host.js'
const base={state:'RUNNING',error:null,owner_host:executionHostIdentity(),owner_pid:process.pid,owner_boot:'boot'}
describe('diagnóstico de jobs sem revelar host/PID ou presumir morte',()=>{
  it('distingue proprietário local, outra instância, remoto e legado',()=>{
    expect(mediaJobDiagnostic(base).ownershipMessage).toBeNull()
    expect(mediaJobDiagnostic({...base,owner_pid:2147483647}).ownershipMessage).toContain('outra instância local')
    expect(mediaJobDiagnostic({...base,owner_host:'b'.repeat(64)}).ownershipMessage).toContain('outra máquina')
    expect(mediaJobDiagnostic({...base,owner_host:'same-hostname'}).ownershipMessage).toContain('legado')
    expect(mediaJobDiagnostic({...base,owner_host:null}).ownershipMessage).toContain('não identificado')
  })
  it('somente falha por proprietário desconhecido exige confirmação; erro de proxy normal não',()=>{
    const error='Trabalho legado sem responsável identificável. Confira se o servidor anterior encerrou antes de solicitar nova tentativa.'
    expect(mediaJobDiagnostic({...base,state:'FAILED',error}).retryRequiresConfirmation).toBe(true)
    expect(mediaJobNeedsOwnerConfirmation('Gerador de proxy não disponível no pacote.')).toBe(false)
  })
})

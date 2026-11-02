import {it,expect,vi,afterEach} from 'vitest'
import {diagnoseIntegrationOwner} from './integration-diagnostic.js'
import {executionHostIdentity} from './execution-host.js'
afterEach(()=>vi.restoreAllMocks())
const row=()=>({state:'SENDING',lastError:null,ownerHost:executionHostIdentity(),ownerPid:process.pid,ownerBoot:'owned'})
it('diagnóstico vivo não revela coordenadas nem confirma POST',()=>{
 const result=diagnoseIntegrationOwner(row());expect(result.ownership).toBe('LOCAL_ALIVE')
 expect(Object.keys(result).sort()).toEqual(['message','ownership']);expect(result.message).not.toContain(String(process.pid))
})
it.each(['remote','unknown'] as const)('%s não consulta PID local nem toma envio',mode=>{
 const kill=vi.spyOn(process,'kill'),source={...row(),ownerHost:mode==='remote'?'remote':null}
 expect(diagnoseIntegrationOwner(source).ownership).toBe(mode==='remote'?'REMOTE':'UNKNOWN');expect(kill).not.toHaveBeenCalled()
})
it.each(['ESRCH','EPERM'] as const)('somente ESRCH comprova morte; %s',code=>{
 vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('kernel'),{code})})
 expect(diagnoseIntegrationOwner(row()).ownership).toBe(code==='ESRCH'?'LOCAL_DEAD':'UNCERTAIN')
 expect(vi.mocked(process.kill).mock.calls).toEqual([[process.pid,0]])
})
it('FAILED legado é inconclusivo, não evidência de liberação/entrega',()=>{
 const kill=vi.spyOn(process,'kill');expect(diagnoseIntegrationOwner({...row(),state:'FAILED',lastError:'Envio legado sem responsável identificável. Confirmar.'}).ownership).toBe('UNKNOWN')
 expect(diagnoseIntegrationOwner({...row(),state:'FAILED',lastError:'HTTP503'}).ownership).toBe('INACTIVE');expect(kill).not.toHaveBeenCalled()
})

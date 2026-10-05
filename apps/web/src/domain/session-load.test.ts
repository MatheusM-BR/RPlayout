import {describe,expect,it,vi} from 'vitest'
import {loadSessionOperation} from './session-load.js'

function fixture(){
  const callbacks={onSession:vi.fn(),onState:vi.fn(),onSnapshot:vi.fn(),onEmpty:vi.fn(),onError:vi.fn(),onDone:vi.fn()}
  const service={session:vi.fn(async()=>({role:'OPERATOR',label:'Operador',required:true,authenticated:true})),state:vi.fn(async()=>({channels:[],rundowns:[]})),rundown:vi.fn()}
  return {callbacks,options:{service,refreshLibrary:vi.fn(async()=>{}),active:()=>true,...callbacks}}
}
describe('inicialização vinculada à sessão',()=>{
  it('conta sem canal autorizado limpa a operação anterior, sem buscar grade',async()=>{
    const {options,callbacks}=fixture();await loadSessionOperation(options)
    expect(callbacks.onState).toHaveBeenCalledWith({channels:[],rundowns:[]})
    expect(callbacks.onEmpty).toHaveBeenCalledOnce();expect(options.service.rundown).not.toHaveBeenCalled()
    expect(callbacks.onDone).toHaveBeenCalledOnce()
  })
  it('sessão não autenticada não consulta estado ou acervo',async()=>{
    const {options,callbacks}=fixture();options.service.session.mockResolvedValue({role:'OPERATOR',label:'Operador',required:true,authenticated:false})
    await loadSessionOperation(options)
    expect(options.service.state).not.toHaveBeenCalled();expect(options.refreshLibrary).not.toHaveBeenCalled()
    expect(callbacks.onSession).toHaveBeenCalledOnce();expect(callbacks.onDone).toHaveBeenCalledOnce()
  })
  it('resposta atrasada de sessão superada não reinstala permissões nem operação',async()=>{
    const {options,callbacks}=fixture();let active=true,release!:()=>void
    options.active=()=>active
    options.service.session.mockImplementation(async()=>{await new Promise<void>(resolve=>{release=resolve});return {role:'OPERATOR',label:'Operador',required:true,authenticated:true}})
    const pending=loadSessionOperation(options);active=false;release();await pending
    for(const callback of Object.values(callbacks))expect(callback).not.toHaveBeenCalled()
    expect(options.service.state).not.toHaveBeenCalled()
  })
  it('snapshot atrasado após troca de sessão é descartado',async()=>{
    const {options,callbacks}=fixture();let active=true,release!:(value:unknown)=>void
    options.active=()=>active
    options.service.state.mockResolvedValue({channels:[],rundowns:[{id:'old'}] as never[]})
    options.service.rundown.mockImplementation(()=>new Promise(resolve=>{release=resolve}))
    const pending=loadSessionOperation(options)
    await vi.waitFor(()=>expect(options.service.rundown).toHaveBeenCalledWith('old'))
    active=false;release({privateOldView:true});await pending
    expect(callbacks.onSnapshot).not.toHaveBeenCalled();expect(callbacks.onDone).not.toHaveBeenCalled()
  })
})

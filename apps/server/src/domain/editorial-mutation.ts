import type {Db} from '../db/client.js'
import type {ConcurrencyManager} from './concurrency.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {readEditorialState} from './editorial-state.js'
import {sealHistoryCapture} from './history.js'

type Transaction=Parameters<Parameters<Db['transaction']>[0]>[0]
type State=NonNullable<ReturnType<typeof readEditorialState>>
export function requireEditorialRevision(manager:ConcurrencyManager,rundownId:string,header:string|string[]|undefined,currentRundownVersion:number,itemId?:string):void{
  if(!header)throw new CollaborativeEditError(428,{error:'Atualize a grade e informe a revisão If-Match antes de editar. Nenhum dado foi alterado.'})
  if(Array.isArray(header))throw new CollaborativeEditError(400,{error:'Informe apenas uma revisão If-Match.'})
  const version=manager.parseETag(header)
  if(!version)throw new CollaborativeEditError(400,{error:'Revisão If-Match inválida.'})
  if(version.lineVersion!==undefined && !itemId)throw new CollaborativeEditError(400,{error:'Esta operação exige a revisão da grade inteira.'})
  if(version.rundownVersion!==currentRundownVersion || version.lineVersion!==undefined && version.lineVersion!==manager.getLineVersion(rundownId,itemId!))throw new CollaborativeEditError(409,{
    error:'OPTIMISTIC_LOCK_CONFLICT',message:'A grade mudou depois que você abriu esta edição. Suas alterações não foram gravadas. Atualize a grade, confira as diferenças e tente novamente.',rundownId,currentRundownVersion,
  })
}
/** The If-Match belongs to the rows actually shown when editing began.
 * Never fetch/replace it with the latest revision immediately before writing. */
export function mutateEditorial<T>(db:Db,manager:ConcurrencyManager,rundownId:string,header:string|string[]|undefined,work:(tx:Transaction,state:State)=>{value:T;remember?:()=>void},itemId?:string):T{
  const committed=db.transaction(tx=>{
    const state=readEditorialState(db,rundownId)
    if(!state)throw new CollaborativeEditError(404,{error:'Grade ativa não encontrada.'})
    if(itemId && !state.items.some(item=>item.id===itemId))throw new CollaborativeEditError(404,{error:'Item não pertence mais a esta grade; atualize a seleção.'})
    requireEditorialRevision(manager,rundownId,header,state.editorialRevision,itemId)
    const committed=work(tx,state)
    sealHistoryCapture(committed.remember)
    return committed
  },{behavior:'immediate'})
  committed.remember?.()
  return committed.value
}

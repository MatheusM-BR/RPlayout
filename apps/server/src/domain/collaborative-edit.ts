import {eq} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {rundownItems} from '../db/schema.js'
import {toItem} from '../db/repo.js'
import type {ConcurrencyManager} from './concurrency.js'
import type {RundownItem} from '@rplayout/protocol'

export class CollaborativeEditError extends Error {
  constructor(readonly status:number,readonly payload:Record<string,unknown>){super(String(payload.message??payload.error))}
}
const fields=['title','durationOverride','minDuration','trimmable','optional','protected','notes'] as const
type Preconditions={expectedRundownVersion?:number;expectedLineVersion?:number;ifMatchHeader?:string}
export function applyCollaborativeEdit(db:Db,manager:ConcurrencyManager,rundownId:string,itemId:string,patch:Record<string,unknown>,preconditions:Preconditions,valid:(item:RundownItem)=>boolean,discard=false){
  return db.transaction(tx=>{
    const row=tx.select().from(rundownItems).where(eq(rundownItems.id,itemId)).get()
    if(!row || row.rundownId!==rundownId)throw new CollaborativeEditError(404,{error:'Item não encontrado nesta grade.'})
    const item=toItem(row)
    const updates=discard ? {} : Object.fromEntries(fields.filter(field=>Object.hasOwn(patch,field)).map(field=>[field,patch[field]]))
    if(!valid({...item,...updates}))throw new CollaborativeEditError(400,{error:'Duração inválida; revise os limites do item.'})
    if(preconditions.ifMatchHeader && !manager.parseETag(preconditions.ifMatchHeader))throw new CollaborativeEditError(400,{error:'Revisão If-Match inválida.'})
    if(preconditions.expectedRundownVersion===undefined && preconditions.expectedLineVersion===undefined && !preconditions.ifMatchHeader)throw new CollaborativeEditError(428,{error:'Informe a revisão lida antes de editar. Atualize a grade ou consulte /api/v1/rundowns/:id/revisions; nenhum dado foi alterado.'})
    const validation=manager.validateOptimisticLock({rundownId,itemId,...preconditions,serverItemState:item as unknown as Record<string,unknown>,clientPatch:patch})
    if(!validation.valid)throw new CollaborativeEditError(409,validation.errorPayload as unknown as Record<string,unknown>)
    if(Object.keys(updates).length)tx.update(rundownItems).set(updates).where(eq(rundownItems.id,itemId)).run()
    const newRundownVersion=manager.getRundownVersion(rundownId),newLineVersion=manager.getLineVersion(rundownId,itemId)
    return {success:true,newRundownVersion,newLineVersion,item:{...item,...updates},eTag:manager.generateETag(rundownId,itemId)}
  },{behavior:'immediate'})
}

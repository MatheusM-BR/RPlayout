import type {Snapshot} from '../types.js'

/** Publication already committed. Loading another rundown is a separate write:
 * check the captured selection before requesting it and before installing any
 * response. Never describe a missing snapshot as a failed publication. */
export async function publicationSnapshot(options:{revision:number;rundownId:string;loadedRundownId:string;current:()=>boolean;read:()=>Promise<Snapshot>;load:()=>Promise<Snapshot>}):Promise<Snapshot>{
  const {revision,current}=options
  const changed=()=>new Error(`Revisão ${revision} gravada na grade original. A seleção mudou; a resposta não foi aplicada à tela atual. Confira o Master antes de outra decisão.`)
  if(!current())throw changed()
  let snapshot:Snapshot
  try{snapshot=await (options.rundownId===options.loadedRundownId?options.read():options.load())}
  catch(cause){throw new Error(`Revisão ${revision} gravada; sincronização com o Master não confirmada: ${cause instanceof Error?cause.message:'consulta ou carga indisponível'}. Confira o canal antes de outra decisão.`)}
  if(!current())throw changed()
  return snapshot
}

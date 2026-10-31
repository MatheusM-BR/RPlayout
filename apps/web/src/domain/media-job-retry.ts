export interface RetryableMediaJob {id:string;retryRequiresConfirmation:boolean}
/** Settle the entire batch before unlocking the UI; failed replies do not
 * establish rejection, and successful jobs must not be resent by this batch. */
export async function retryMediaJobs(jobs:readonly RetryableMediaJob[],send:(id:string,confirmed:boolean)=>Promise<{ok:boolean}>){
  const outcomes=await Promise.allSettled(jobs.map(async job=>{
    const response=await send(job.id,job.retryRequiresConfirmation)
    if(!response.ok)throw new Error('Servidor não confirmou a nova tentativa.')
  }))
  const unresolved=jobs.filter((_,index)=>outcomes[index]?.status!=='fulfilled')
  const confirmed=jobs.length-unresolved.length
  const message=unresolved.length
    ? `${confirmed} de ${jobs.length} trabalhos recolocados na fila. ${unresolved.length} sem confirmação; confira o estado atualizado antes de tentar novamente. Falha de resposta não comprova rejeição.`
    : 'Trabalhos recolocados na fila…'
  return {unresolved,confirmed,message}
}

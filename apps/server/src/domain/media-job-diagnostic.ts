import {executionHostIdentity} from './execution-host.js'
export function mediaJobNeedsOwnerConfirmation(error:string|null):boolean{
  return Boolean(error&&(/Trabalho legado sem responsável identificável\./.test(error)||/Trabalho sem responsável identificável;/.test(error)))
}
export function mediaJobDiagnostic(row:{state:string;error:string|null;owner_host:string|null;owner_pid:number|null;owner_boot:string|null}){
  const retryRequiresConfirmation=row.state==='FAILED'&&mediaJobNeedsOwnerConfirmation(row.error)
  let ownershipMessage:string|null=null
  if(row.state==='RUNNING'){
    if(!row.owner_host||!row.owner_boot||!Number.isSafeInteger(row.owner_pid)||row.owner_pid!<1)ownershipMessage='Responsável não identificado. Nenhuma retomada automática será autorizada.'
    else if(row.owner_host!==executionHostIdentity())ownershipMessage=/^[a-f0-9]{64}$/i.test(row.owner_host)?'Trabalho de outra máquina. Confirme o estado naquela estação; não será tomado por este servidor.':'Responsável legado ou identidade indisponível. Verifique a estação anterior; não há prova segura para retomar.'
    else if(row.owner_pid!==process.pid)ownershipMessage='Trabalho de outra instância local. A fila aguarda comprovação de encerramento antes de retomar.'
  }
  return {retryRequiresConfirmation,ownershipMessage}
}

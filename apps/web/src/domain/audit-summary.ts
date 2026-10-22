export function auditActionLabel(kind:string){
  return kind==='MEDIA_JOB_RETRY_REQUESTED'?'Recuperação de mídia solicitada':kind
}
export function auditDetails(kind:string,payload:Record<string,unknown>){
  if(kind!=='MEDIA_JOB_RETRY_REQUESTED')return JSON.stringify(payload)
  const text=(key:string)=>typeof payload[key]==='string'?payload[key]:'não informado'
  const attempts=Number.isSafeInteger(payload.previousAttempts)&&Number(payload.previousAttempts)>=0?String(payload.previousAttempts):'não informado'
  const confirmation=payload.ownerConfirmationRequired===true
    ? payload.confirmedPreviousStopped===true?'encerramento anterior confirmado pelo operador':'confirmação não registrada'
    : payload.ownerConfirmationRequired===false?'confirmação de responsável não exigida':'política de confirmação não informada'
  return `Trabalho ${text('jobId')} · versão ${text('versionId')} · tipo ${text('kind')} · tentativas anteriores ${attempts} · ${confirmation}. Pedido recolocado na fila; não comprova conclusão nem aprova QC ou executa TAKE.`
}

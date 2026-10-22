import type {ScanReview,ScanCommandResult} from '@rplayout/protocol'

export type ScanOperation={kind:'SCAN';review:ScanReview;measure:boolean;root?:string}|{kind:'RECOVER';review:ScanReview;batchId:string}
/** Retry retains the original identity, mode and roots, not a later refresh. */
export function captureScanOperation(review:ScanReview,measure:boolean,root?:string,batchId?:string):ScanOperation{
  if(batchId!==undefined){
    if(!review.activeBatches.some(batch=>batch.id===batchId&&batch.canRecover))throw new Error('Lote sem retomada conferida; nenhum comando enviado.')
    return {kind:'RECOVER',review:structuredClone(review),batchId}
  }
  if(!review.canEdit||!review.canStart||!review.available||!review.roots.length||root!==undefined&&!review.roots.some(folder=>folder.path===root))throw new Error('Pastas ou disponibilidade não conferidas; nenhum comando enviado.')
  return {kind:'SCAN',review:structuredClone(review),measure,...root===undefined?{}:{root}}
}
export function scanOperationKey(operation:ScanOperation){
  return JSON.stringify([operation.kind,operation.review.operationId,operation.review.revision,operation.review.batchRevision,
    operation.kind==='SCAN'?operation.measure:null,operation.kind==='SCAN'?operation.root??null:operation.batchId])
}
export function validateScanResult(operation:ScanOperation,result:ScanCommandResult){
  if(result?.accepted!==true||typeof result.batchId!=='string'||!result.batchId||typeof result.state!=='string'||!result.state||typeof result.deduplicated!=='boolean'||typeof result.measure!=='boolean'||!Array.isArray(result.roots)||!result.roots.length||result.roots.some(root=>typeof root!=='string'||!root))throw new Error('Registro sem confirmação válida; confira antes de repetir o mesmo pedido.')
  if(operation.kind==='RECOVER'){
    if(result.batchId!==operation.batchId)throw new Error('A resposta corresponde a outro lote; retomada não confirmada.')
  }else{
    const expected=operation.root?[operation.root]:operation.review.roots.map(root=>root.path)
    if(result.measure!==operation.measure||result.roots.length!==expected.length||new Set(result.roots).size!==expected.length||!expected.every(root=>result.roots.includes(root)))throw new Error('A resposta diverge das pastas ou medição conferidas; registro não confirmado.')
  }
  return result
}
export function scanResultNotice(result:ScanCommandResult){
  const status=result.state==='COMPLETED'?'Servidor informa varredura concluída; isso não aprova a mídia no QC.'
    :result.state==='UNKNOWN'?'Estado atual do lote indisponível; não presumir conclusão nem criar outro pedido.'
    :result.state==='FAILED'?'Servidor informa falha do lote; confira o diagnóstico antes de criar outro pedido.'
    :'Registro não significa leitura concluída nem aprovação QC.'
  return result.startError?`${status} ${result.startError}`:status
}

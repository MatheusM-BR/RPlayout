import type {GraphicCommandReceipt,ReviewedGraphicCommand} from '../api.js'
export function graphicReviewMatches(command:ReviewedGraphicCommand,commands:ReviewedGraphicCommand[]|null,canReview:boolean){
  return canReview&&Boolean(command.reviewToken)&&['ACCEPTED','SENDING','UNCERTAIN'].includes(command.state)&&Boolean(commands?.some(row=>row.id===command.id&&row.state===command.state&&row.reviewToken===command.reviewToken))
}
export function graphicReviewKey(channelId:string,command:ReviewedGraphicCommand,note:string){
  return JSON.stringify([channelId,command.id,command.state,command.reviewToken,note.trim()])
}
export function graphicCommandFeedback(receipt:GraphicCommandReceipt,label:string){
  if(!receipt?.id||receipt.physicalOutputValidated!==false)throw new Error('Comando sem recibo válido; confira o histórico antes de outra ação.')
  const messages={CONFIRMED:'engine confirmou o comando; confira a imagem no PGM.',SIMULATED:'ação simulada; não confirma saída física.',ACCEPTED:'pedido registrado, ainda sem confirmação de execução.',SENDING:'envio sem conclusão; não repetir automaticamente.',UNCERTAIN:'resultado incerto; confira o engine e a imagem antes de outra ação.',REJECTED:'pedido recusado; não confirma alteração do grafismo.',REVIEWED:'pendência conferida sem reenvio; não confirma sinal recuperado.'}
  const message=messages[receipt.state]
  if(!message)throw new Error('Estado de comando desconhecido; confira o histórico antes de outra ação.')
  return `${label}: ${message}`
}

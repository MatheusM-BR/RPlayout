import type {IntegrationDeliverySummary} from '@rplayout/protocol'
const labels={QUEUED:'AGENDADA',SENDING:'ENVIANDO',DELIVERED:'CONFIRMADA',FAILED:'FALHOU',CANCELLED:'CANCELADA'}
export function IntegrationDeliveryStatus({delivery}:{delivery:Pick<IntegrationDeliverySummary,'state'|'diagnostic'>}){
 const ownership=delivery.diagnostic.ownership
 const label=ownership==='UNKNOWN'||ownership==='UNCERTAIN'?'INCONCLUSIVA · REENVIO BLOQUEADO':ownership==='REMOTE'?'EM OUTRO NÓ · CONFIRMAÇÃO PENDENTE':ownership==='LOCAL_DEAD'?'INTERROMPIDA · RETOMADA PENDENTE':labels[delivery.state]
 return <><span>{label}</span><div className="detalhe" role="status">{delivery.diagnostic.message}</div></>
}

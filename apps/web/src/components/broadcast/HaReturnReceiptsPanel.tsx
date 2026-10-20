import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnReceipt} from '../../api.js'
import {HaReturnReviewPanel} from './HaReturnReviewPanel.js'
import {HaReturnRekeyPanel} from './HaReturnRekeyPanel.js'
import {HaReturnPendingJobsPanel} from './HaReturnPendingJobsPanel.js'
export function HaReturnReceiptsPanel({stale}:{stale:boolean}){
  const [channels,setChannels]=useState<Array<{id:string;name:string}>>([]),[channelId,setChannelId]=useState(''),[receipts,setReceipts]=useState<HaReturnReceipt[]|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false)
  const active=useRef(true),loading=useRef(false)
  useEffect(()=>{active.current=true;void Promise.all([api.state(),api.archivedChannels()]).then(([state,archived])=>{if(active.current){const channels=[...new Map([...state.channels,...archived.channels].map(channel=>[channel.id,{id:channel.id,name:channel.name}])).values()];setChannels(channels)}}).catch(()=>{if(active.current)setError('Lista de canais indisponível.')});return()=>{active.current=false}},[])
  const inspect=async()=>{
    if(loading.current||!channelId||stale)return;loading.current=true;setBusy(true);setError(null)
    try{const value=await api.haReturnReceipts(channelId)
      if(value.publicationAuthorized!==false||!Array.isArray(value.receipts)||value.receipts.length>128||new Set(value.receipts.map(row=>row.transferId)).size!==value.receipts.length||value.receipts.some(row=>row.channelId!==channelId||row.version!==1||row.primaryApproved!==false||row.publicationAuthorized!==false||row.authorityTransferred!==false||row.physicalOutputValidated!==false||row.confirmationIsHistorical!==true||!['ALLOCATING','RECEIVING','RECEIVED_QUARANTINE'].includes(row.phase)||!Number.isSafeInteger(row.offset)||!Number.isSafeInteger(row.databaseBytes)||row.offset<0||row.databaseBytes<=0||row.offset>row.databaseBytes||row.phase==='RECEIVED_QUARANTINE'&&row.offset!==row.databaseBytes))throw new Error()
      if(active.current)setReceipts(value.receipts)
    }catch{if(active.current)setError('Consulta indisponível. Dados anteriores podem estar desatualizados; nada foi instalado.')}
    finally{loading.current=false;if(active.current)setBusy(false)}
  }
  return <section aria-label="Quarentena de retorno da reserva" className="border rounded p-2 text-xs space-y-2">
    <h3>Dados devolvidos pela reserva</h3>
    <select aria-label="Canal da quarentena" disabled={busy} value={channelId} onChange={event=>{setChannelId(event.target.value);setReceipts(null);setError(null)}}><option value="">Selecione o canal</option>{channels.map(channel=><option key={channel.id} value={channel.id}>{channel.name}</option>)}</select>
    <button disabled={busy||stale||!channelId} onClick={()=>void inspect()} className="underline ml-2">Consultar recebimentos</button>
    {channelId&&<HaReturnPendingJobsPanel key={channelId} channelId={channelId} stale={stale||busy}/>}
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {receipts?.length===0&&<p>Nenhum recebimento registrado neste canal.</p>}
    {receipts?.map(row=><div key={row.transferId} className="border rounded p-2 space-y-1"><p>{row.phase==='RECEIVED_QUARANTINE'?'Recebido e conferido por SHA — em quarentena':row.phase==='ALLOCATING'?'Alocação ainda não confirmada':'Cópia parcial'} · {row.offset} / {row.databaseBytes} bytes</p><p>Execução {row.promotionId} · exportação {row.exportId}</p><p>Registro histórico em {new Date(row.checkedAt).toLocaleString('pt-BR')}{!row.ownedHere&&' · outra instância: sem adoção automática'}</p><HaReturnReviewPanel receipt={row} stale={stale||!!error}/></div>)}
    <p className="text-outline">Recebimento não aprova SQLite, edição, mídia ou histórico. Consulta não substitui o banco do canal, não resolve comandos incertos e não devolve autoridade.</p>
    {receipts?.map(row=>(row.hasProtectedBridge||row.rekeyRequestId)&&<HaReturnRekeyPanel key={'rekey:'+row.transferId} receipt={row} stale={stale||!!error}/>)}
  </section>
}

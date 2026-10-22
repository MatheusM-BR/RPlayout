import {useEffect,useRef,useState} from 'react'
import {api,type HaReturnPendingJobs} from '../../api.js'
import {HaReturnJobRecoveryPanel} from './HaReturnJobRecoveryPanel.js'
import {returnJobActivePhase} from '../../domain/ha-return-job-kind.js'
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export function HaReturnPendingJobsPanel({channelId,stale}:{channelId:string;stale:boolean}){
  const [kind,setKind]=useState<HaReturnPendingJobs['kind']>('MEDIA_REVIEW'),[page,setPage]=useState<HaReturnPendingJobs|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
  const generation=useRef(0),running=useRef(false)
  useEffect(()=>{generation.current++;setPage(null);setBusy(false);setError(null);return()=>{generation.current++}},[channelId,kind,stale])
  const load=async(afterId:string|null)=>{
    if(running.current||stale||!channelId)return
    running.current=true;setBusy(true);setError(null);setPage(null);const stamp=generation.current
    try{
      const value=await api.haReturnPendingJobs(channelId,kind,afterId)
      if(value.version!==1||value.channelId!==channelId||value.kind!==kind||value.afterId!==afterId||value.snapshot!==false||value.processStoppedProven!==false||value.operationalReady!==false||value.publicationAuthorized!==false||!Number.isSafeInteger(value.scanned)||value.scanned<0||value.scanned>25||!Array.isArray(value.rows)||value.rows.length>value.scanned||value.nextCursor!==null&&(typeof value.nextCursor!=='string'||!uuid.test(value.nextCursor)||value.nextCursor<=(afterId??'')||value.scanned!==25)||new Set(value.rows.map(row=>row.id)).size!==value.rows.length||value.rows.some((row,index)=>!row||typeof row.id!=='string'||!uuid.test(row.id)||row.id<=(afterId??'')||index>0&&row.id<=value.rows[index-1]!.id||value.nextCursor!==null&&row.id>value.nextCursor||row.channelId!==channelId||row.kind!==kind||!['ACCEPTED',returnJobActivePhase(kind),...(['HISTORY_IMPORT','HISTORY_VARIANT'].includes(kind)?['COMMITTING']:[])].includes(row.phase)||typeof row.ownerRecorded!=='boolean'||typeof row.ownedHere!=='boolean'||typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt))))throw new Error()
      if(stamp===generation.current)setPage(value)
    }catch{if(stamp===generation.current)setError('Consulta de pedidos indisponível; nenhuma operação repetida ou encerrada.')}
    finally{running.current=false;if(stamp===generation.current)setBusy(false)}
  }
  return <section aria-label="Pedidos de retorno sem conclusão" className="border rounded p-2 space-y-2">
    <h4>Pedidos sem conclusão registrada</h4>
    <p>Consulta por canal, inclusive de outra execução. Estado pendente não prova interrupção. A lista não acompanha mudanças automaticamente e não representa uma fotografia única entre páginas.</p>
    <select aria-label="Tipo de pedido de retorno" disabled={busy||stale} value={kind} onChange={event=>setKind(event.target.value as HaReturnPendingJobs['kind'])}><option value="HISTORY_IMPORT">Importação de histórico</option><option value="HISTORY_VARIANT">Variantes de histórico</option><option value="DATABASE_REVIEW">Revisão técnica do banco</option><option value="REKEY">Reproteção de credenciais</option><option value="CANDIDATE">Criação de candidatos</option><option value="BINDING_APPLICATION">Aplicação de vínculos locais</option><option value="MEDIA_REVIEW">Revisões de mídia</option><option value="MEDIA_APPLICATION">Criação de cópias</option><option value="POSTGAIN_REVIEW">Medições pós-ganho</option><option value="BUS_REVIEW">Medições de áudio completo</option></select>
    <button className="underline ml-2" disabled={busy||stale} onClick={()=>void load(null)}>Consultar desde o início</button>
    {error&&<p role="alert" className="text-armed-amber">{error}</p>}
    {page&&<><p>{page.scanned} registros históricos percorridos nesta página · {page.rows.length} sem conclusão registrada.</p>{!page.rows.length&&<p>Nenhum pedido pendente nesta página.{page.nextCursor?' Ainda há outras páginas do histórico.':' Fim desta consulta; não é confirmação de recuperação do canal.'}</p>}{page.rows.map(row=><div key={row.id} className="border rounded p-2"><p>{row.id} · {row.phase} · {row.updatedAt}{!row.ownedHere?' · outra execução; sem adoção automática':''}</p>{!row.ownerRecorded&&<p>Histórico sem processo responsável registrado; encerramento não permitido.</p>}{row.phase==='COMMITTING'?<p>Gravação operacional sem confirmação. Atualize a consulta; não encerrar como falha nem repetir.</p>:<HaReturnJobRecoveryPanel target={{kind:row.kind,id:row.id,channelId:row.channelId,phase:row.phase,updatedAt:row.updatedAt}} stale={stale||busy||!!error||!row.ownerRecorded} onClosed={()=>void load(page.afterId)}/>}</div>)}<button className="underline" disabled={busy||stale} onClick={()=>void load(page.afterId)}>Atualizar esta página — somente consulta</button>{page.nextCursor&&<button className="underline" disabled={busy||stale} onClick={()=>void load(page.nextCursor)}>Consultar próxima página do histórico</button>}</>}
  </section>
}

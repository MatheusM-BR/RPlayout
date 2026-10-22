import {useEffect,useRef,useState} from 'react'
import type {OwnershipStatusView} from '@rplayout/protocol'
import {api} from '../api.js'
import {nativeQueryFailureMessage} from '../domain/native-query-diagnostic.js'
export function currentOwnershipViews<T extends {channelId:string;channel:OwnershipStatusView|null;distribution:OwnershipStatusView|null}>(views:T,channelId:string){return views.channelId===channelId?views:{channelId,channel:null,distribution:null}}
export function OwnershipStatusCard({label,status}:{label:string;status:OwnershipStatusView}){
 return <section aria-label={label}><h4>{label}: {status.blocked?'PROTEGIDA / BLOQUEADA':status.diagnostic.code==='LOCAL_STOPPED_CHECKPOINT_UNCERTAIN'?'AVISO DE RETOMADA':status.diagnostic.repairRequired?'REVISÃO NECESSÁRIA':status.ownedHere?'DESTA INSTÂNCIA':'SEM BLOQUEIO CONSTATADO'}</h4><p role={status.diagnostic.repairRequired?'alert':'status'}>{status.diagnostic.message}</p>{status.nativeQueryFailure&&<p role="alert">Última falha nativa observada: {nativeQueryFailureMessage(status.nativeQueryFailure)} <span>Registro: {status.nativeQueryFailure.observedAt}.</span></p>}<p className="detalhe">Consulta não abre, encerra ou libera processos; não comprova sinal físico nem autoriza promoção.</p></section>
}
/** Explicit read only. No polling, lease acquisition or recovery controls. */
export function OwnershipDiagnosticsPanel({channelId}:{channelId:string}){
 const [views,setViews]=useState<{channelId:string;channel:OwnershipStatusView|null;distribution:OwnershipStatusView|null}>({channelId,channel:null,distribution:null}),[errors,setErrors]=useState<string[]>([]),[busy,setBusy]=useState(false)
 const shown=currentOwnershipViews(views,channelId),currentErrors=views.channelId===channelId?errors:[]
 const generation=useRef(0),busyRef=useRef(false)
 useEffect(()=>{++generation.current;busyRef.current=false;setViews({channelId,channel:null,distribution:null});setErrors([]);setBusy(false);return()=>{++generation.current}},[channelId])
 const read=async()=>{
  if(busyRef.current)return;busyRef.current=true;setBusy(true);setViews({channelId,channel:null,distribution:null});setErrors([]);const expected=generation.current
  try{
   const responses=await Promise.allSettled([api.executionOwnership(channelId),api.distributionOwnership()])
   if(generation.current!==expected)return
   setViews({channelId,channel:responses[0].status==='fulfilled'?responses[0].value:null,distribution:responses[1].status==='fulfilled'?responses[1].value:null})
   setErrors(responses.flatMap((result,index)=>result.status==='rejected'?[(index===0?'Canal':'Distribuição')+': '+(result.reason instanceof Error?result.reason.message:'Consulta indisponível; nenhuma liberação presumida.')]:[]))
  }finally{if(generation.current===expected){busyRef.current=false;setBusy(false)}}
 }
 return <div className="field"><h3>Reservas de execução e distribuição</h3><p className="detalhe">Diagnóstico somente leitura. Prazo vencido ou confirmação manual não comprovam que outra instância parou.</p><button className="btn small" disabled={busy} onClick={()=>void read()}>Consultar reservas</button>
 {!shown.channel&&!shown.distribution&&!busy&&currentErrors.length===0&&<p role="status">Reservas ainda não consultadas; não é confirmação de canal livre.</p>}
 {busy&&<p role="status">Consultando reservas…</p>}{currentErrors.map(error=><p role="alert" key={error}>{error}</p>)}
 {shown.channel&&<OwnershipStatusCard label="Execução do canal" status={shown.channel}/>}{shown.distribution&&<OwnershipStatusCard label="Distribuição do computador" status={shown.distribution}/>}</div>
}

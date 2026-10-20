import {useEffect,useState} from 'react'
import type {Live} from '../../types.js'
export function PreviewFrameStatus({sample}:{sample:Live['transport']['previewFrame']}){
 const [,redraw]=useState(0)
 useEffect(()=>{
  if(!sample||!Number.isFinite(sample.sampledAt))return
  const timer=window.setTimeout(()=>redraw(value=>value+1),Math.max(0,2001-(Date.now()-sample.sampledAt)))
  return()=>window.clearTimeout(timer)
 },[sample?.sampledAt])
 const age=sample?Date.now()-sample.sampledAt:Infinity
 const valid=sample&&age>=0&&age<=2000&&sample.delivered
 return <p role="status" className="text-[10px] text-on-surface-variant mt-1">{valid?(sample.pausedFile?'PVW · quadro entregue pelo decoder (arquivo pausado)':'PVW · vídeo entregue pelo decoder'):'PVW · entrega de vídeo não confirmada nesta observação'} · não comprova imagem no navegador ou transmissão.</p>
}

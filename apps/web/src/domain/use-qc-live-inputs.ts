import {useCallback,useEffect,useRef,useState} from 'react'
import type {ManagedLiveSource,SrtTelemetry} from '@rplayout/protocol'
import {api} from '../api.js'
import {RetainedPoll,type RetainedPollState} from './retained-poll.js'

type Catalog=RetainedPollState<ManagedLiveSource[]>&{channelId:string}
type Telemetry=RetainedPollState<Record<string,SrtTelemetry>>&{channelId:string}
export function useQcLiveInputs(channelId:string){
  const [catalog,setCatalog]=useState<Catalog>({channelId,value:null,pending:true,error:null})
  const [telemetry,setTelemetry]=useState<Telemetry>({channelId,value:null,pending:true,error:null})
  const reload=useRef<()=>void>(()=>{})
  useEffect(()=>{
    const sources=new RetainedPoll<ManagedLiveSource[]>(state=>setCatalog({...state,channelId}),'Não foi possível conferir as entradas ao vivo. A última lista, quando disponível, foi mantida; reconsulte antes de selecionar outra fonte.')
    const measurements=new RetainedPoll<Record<string,SrtTelemetry>>(state=>setTelemetry({...state,channelId}),'Telemetria SRT não conferida; isso não significa perda do vídeo.')
    const refresh=()=>{void sources.refresh(signal=>api.liveSources(channelId,signal));void measurements.refresh(signal=>api.srtTelemetry(signal))}
    reload.current=refresh;refresh()
    const timer=window.setInterval(refresh,3000)
    return()=>{window.clearInterval(timer);sources.close();measurements.close();if(reload.current===refresh)reload.current=()=>{}}
  },[channelId])
  const visible=catalog.channelId===channelId?catalog:null,currentTelemetry=telemetry.channelId===channelId?telemetry:null
  const refresh=useCallback(()=>reload.current(),[])
  return {sources:visible?.value??[],loaded:visible?.value!==null&&visible!==null,pending:visible?.pending??true,error:visible?.error??null,
    canSelect:Boolean(visible?.value!==null&&visible&&!visible.error),refresh,
    // Stale transport metrics must not look like fresh measurements. Unlike
    // source identity, do not render retained telemetry while its read failed.
    telemetry:currentTelemetry?.error?{}:currentTelemetry?.value??{},telemetryError:currentTelemetry?.error??null}
}

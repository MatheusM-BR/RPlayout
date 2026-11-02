import {useEffect,useState} from 'react'
import {api} from '../api.js'
import {commandRequestId} from './request-id.js'
import {documentHidden} from './live-topics.js'

/** A separate viewer identity per activation; cleanup cannot cancel a newer activation. */
/** Engine reply while the QC decoder is still opening the source. */
export function qcOpeningMessage(message:string):boolean{return /aguardando (o primeiro )?quadro/i.test(message)}

export function useQcLiveInspection(channelId:string,sourceRef:string|null,requested:boolean,activationId?:string){
  const [state,setState]=useState<{key:string;ready:boolean;error:string|null}|null>(null)
  const key=JSON.stringify([channelId,sourceRef,activationId])
  useEffect(()=>{
    if(!requested || !sourceRef){setState(null);return}
    const viewerId=commandRequestId(),source=sourceRef
    let active=true,busy=false
    setState({key,ready:false,error:null})
    const renew=async()=>{
      if(!active||busy)return
      busy=true
      try {
        await api.qcLiveInspection(channelId,viewerId,source,true)
        if(active){readyRef.ready=true;setState(current=>current?.key===key && current.ready && !current.error?current:{key,ready:true,error:null})}
      }catch(error){
        // The QC decoder answers "waiting for the first frame" while it opens:
        // that is progress ("Abrindo…"), not a failure to show the operator.
        const message=error instanceof Error?error.message:'Inspeção em qualidade indisponível.'
        if(active)setState({key,ready:false,error:qcOpeningMessage(message)?null:message})
      }finally{busy=false}
    }
    // While opening, ask again every 500 ms: the first answer is always
    // "waiting for the first frame", and a 5 s renew made every live input
    // look stuck on "Abrindo…" for 5–10 s. Once ready, renew the lease every 5 s.
    // Aba oculta não renova: ninguém vê a inspeção e o servidor solta o
    // decodificador quando a concessão vence. Volta na hora ao ficar visível.
    // Abrindo, a espera cresce até 2 s (500, 500, 750, 1125…): o primeiro
    // aviso é imediato, mas uma fonte que não abre não fica em laço de 500 ms.
    let opened=false,timer=0,openingTries=0
    const tick=async()=>{
      if(!documentHidden())await renew()
      if(!active)return
      opened=opened||readyRef.ready
      timer=window.setTimeout(()=>void tick(),opened?5000:Math.min(2000,Math.round(500*1.5**Math.max(0,openingTries++-1))))
    }
    const resume=()=>{if(!documentHidden()&&active){window.clearTimeout(timer);void tick()}}
    document.addEventListener('visibilitychange',resume)
    const readyRef={ready:false}
    void tick()
    return ()=>{
      active=false;window.clearTimeout(timer);document.removeEventListener('visibilitychange',resume)
      // Queued after the opening request; the server serializes and owns the
      // lease per session/viewer, not by a global "off" toggle.
      void api.qcLiveInspection(channelId,viewerId,source,false).catch(()=>{})
    }
  },[channelId,sourceRef,requested,key])
  return state?.key===key && requested?state:{ready:false,error:null}
}

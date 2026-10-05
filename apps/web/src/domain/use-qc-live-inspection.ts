import {useEffect,useState} from 'react'
import {api} from '../api.js'
import {commandRequestId} from './request-id.js'

/** A separate viewer identity per activation; cleanup cannot cancel a newer activation. */
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
        if(active)setState(current=>current?.key===key && current.ready && !current.error?current:{key,ready:true,error:null})
      }catch(error){
        if(active)setState({key,ready:false,error:error instanceof Error?error.message:'Inspeção em qualidade indisponível.'})
      }finally{busy=false}
    }
    void renew()
    const timer=window.setInterval(()=>void renew(),5000)
    return ()=>{
      active=false;window.clearInterval(timer)
      // Queued after the opening request; the server serializes and owns the
      // lease per session/viewer, not by a global "off" toggle.
      void api.qcLiveInspection(channelId,viewerId,source,false).catch(()=>{})
    }
  },[channelId,sourceRef,requested,key])
  return state?.key===key && requested?state:{ready:false,error:null}
}

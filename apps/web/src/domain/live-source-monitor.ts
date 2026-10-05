import type {ManagedLiveSource,SrtTelemetry} from '@rplayout/protocol'
import type {Live,Monitors} from '../types.js'
import type {MultiviewSourceItem} from '../components/broadcast/OperationalMultiview.js'
import {canonicalLiveSourceRef,sameLiveSource} from '../liveSource.js'

/** A registered input is not a measured signal. Bind only to the current
 * engine bus, including ITEM CUE and protected references after restart. */
export function liveSourceMonitor(source:ManagedLiveSource,live:Live|null,monitors:Monitors|null,telemetry?:SrtTelemetry,now=Date.now()):MultiviewSourceItem {
  const reference=canonicalLiveSourceRef(source),transport=live?.transport
  const matching=transport?.liveSources.filter(row=>sameLiveSource(row.source,reference)) ?? []
  const pgm=transport?.onAir ? matching.find(row=>(row.busItemIds?.pgm ?? row.itemId)===transport.onAir!.itemId) : undefined
  const preview=transport?.preview
  const pvw=preview?.kind==='ITEM' ? matching.find(row=>(row.busItemIds?.pvw ?? row.itemId)===preview.id) :
    preview?.kind==='SOURCE' && sameLiveSource(preview.source,reference) ? matching.find(row=>row.busStates?.pvw && row.busStates.pvw!=='IDLE') : undefined
  const bus=pgm?'pgm':pvw?'pvw':null,row=pgm ?? pvw
  const state=bus ? row?.busStates?.[bus] ?? row?.state : undefined
  const sample=bus ? row?.measurements?.[bus] : undefined
  const sampledAt=sample ? Date.parse(sample.sampledAt) : NaN
  const fresh=Number.isFinite(sampledAt) && now>=sampledAt && now-sampledAt<=2500
  const native=transport?.mode==='NATIVE'
  const measuredVideo=!!(native && fresh && sample?.videoPresent && sample.videoAgeMs!==null && Number.isFinite(sample.videoAgeMs) && sample.videoAgeMs>=0 && sample.videoAgeMs<=2000)
  const confirmed=measuredVideo && ['ON_PGM','PVW_READY','TAKE_PENDING'].includes(state ?? '')
  const measuredAudio=!!(native && fresh && sample?.audioPresent && sample.audioAgeMs!==null && sample.audioAgeMs>=0 && sample.audioAgeMs<=2000)
  let signalLabel:string,signalMessage:string
  if(transport?.mode==='SIMULATED'){
    signalLabel='SIMULADO';signalMessage='O transporte simulado não confirma vídeo, áudio ou saída física.'
  }else if(!bus){
    signalLabel=source.enabled?'NÃO MONITORADA':'DESATIVADA'
    signalMessage='Cadastro e descoberta não confirmam sinal. Faça CUE no Master ou abra a fonte no QC; este painel não sintoniza nem executa TAKE.'
  }else if(state==='FAILED'){
    signalLabel='FALHA DE ABERTURA';signalMessage=row?.message ?? 'O engine recusou a abertura. Confira o diagnóstico da entrada.'
  }else if(state==='CUEING' || state==='TAKE_PENDING' && !confirmed){
    signalLabel='AGUARDANDO QUADRO';signalMessage='O engine está preparando a entrada; isso ainda não confirma sinal disponível.'
  }else if(confirmed){
    signalLabel='VÍDEO PRESENTE';signalMessage=measuredAudio ? 'Vídeo e áudio recebidos pelo engine. Não comprova a saída física.' : 'Vídeo recebido pelo engine; áudio ausente ou sem medição recente.'
  }else if(state==='LOST' || fresh && sample && !sample.videoPresent){
    signalLabel='SEM VÍDEO RECENTE';signalMessage='A entrada aberta não está entregando quadros recentes ao engine.'
  }else{
    signalLabel='MEDIÇÃO INDISPONÍVEL';signalMessage='Sem medição recente deste barramento. Não é possível afirmar presença ou ausência de sinal.'
  }
  const fps=sample?.rateNum && sample.rateDen && fresh && native ? sample.rateNum/sample.rateDen : 0
  const format=native && fresh && sample?.width && sample.height ? `${sample.width}×${sample.height}${sample.interlaceMode ? ` · ${sample.interlaceMode}`:''}` : 'Formato não medido'
  const monitorBus=bus==='pgm'?'mon':'pvw'
  return {
    id:source.id,name:source.name,role:source.role==='BACKUP'?'BACKUP':'PRIMARY',kind:source.kind,targetUrl:source.targetUrl,
    format,fps,tally:native && bus==='pgm'?'ON_AIR':native && bus==='pvw'?'CUED':'OFFLINE',
    syncState:confirmed?'LOCKED':state==='CUEING' || state==='TAKE_PENDING'?'DRIFT':'LOST',
    signalLabel,signalMessage,srtTelemetry:telemetry,monitorBus,
    whepPath:confirmed ? bus==='pgm'?monitors?.program:monitors?.preview : null,whepPort:monitors?.port,
  }
}

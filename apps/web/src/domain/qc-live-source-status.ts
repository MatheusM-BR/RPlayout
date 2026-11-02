import {assessLiveSignal,type LiveSignalPolicy,type ManagedLiveSource} from '@rplayout/protocol'
import type {Live} from '../types.js'
import {canonicalLiveSourceRef,sameLiveSource} from '../liveSource.js'

type Signal=Live['transport']['liveSources'][number]
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0
const nonnegative=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0

/** Cached format is useful history, never evidence of present video/audio. */
export function qcLiveSourceStatus(source:ManagedLiveSource,signal:Signal|undefined,preview:Live['transport']['preview']|undefined,mode:Live['transport']['mode']|undefined,now:number,policy?:LiveSignalPolicy){
  if(signal&&!sameLiveSource(signal.source,canonicalLiveSourceRef(source)))signal=undefined
  const previewMatches=preview?.kind==='SOURCE'?sameLiveSource(preview.source,canonicalLiveSourceRef(source)):
    preview?.kind==='ITEM'&&signal?(signal.busItemIds?.pvw??signal.itemId)===preview.id:false
  const pvwState=previewMatches?(signal?.busStates?signal.busStates.pvw:signal?.state):undefined
  const pgmState=signal?.busStates?.pgm
  const bus=pvwState&&pvwState!=='IDLE'?'pvw':pgmState&&pgmState!=='IDLE'?'pgm':null
  const lifecycle=bus==='pvw'?pvwState:bus==='pgm'?pgmState:undefined
  const sample=bus?signal?.measurements?.[bus]:undefined
  const assessment=assessLiveSignal({mode,active:source.enabled&&!!bus,lifecycle,sample,policy},now)
  const ready=source.enabled&&assessment.videoRecent&&(lifecycle==='PVW_READY'||lifecycle==='ON_PGM')
  const label=!source.enabled?'DESATIVADA':mode==='SIMULATED'?'SIMULADO':
    lifecycle==='FAILED'?'FALHOU':lifecycle==='LOST'?'SINAL PERDIDO':
    !bus?signal?'NÃO SINTONIZADA':'CADASTRADA · SINAL N/D':
    ready?assessment.status==='NO_AUDIO'?'VÍDEO SEM ÁUDIO':assessment.status==='UNSTABLE'?'SINAL INSTÁVEL':bus==='pgm'?'NO PGM':'PVW PRONTO':
    lifecycle==='CUEING'?'SINTONIZANDO':lifecycle==='TAKE_PENDING'?'AGUARDANDO QUADRO':
    assessment.status==='NO_VIDEO'?'SEM VÍDEO RECENTE':'SEM MEDIÇÃO RECENTE'
  const tone=!source.enabled||lifecycle==='FAILED'||lifecycle==='LOST'?'error':ready&&assessment.status==='SIGNAL_OK'?'ok':'warning'
  const historical=[signal?.measurements?.pvw,signal?.measurements?.pgm].filter((entry):entry is NonNullable<typeof entry>=>!!entry)
    .sort((a,b)=>(Date.parse(b.sampledAt)||0)-(Date.parse(a.sampledAt)||0))[0]
  const current=source.enabled&&mode==='NATIVE'&&!!bus&&lifecycle!=='FAILED'&&assessment.sampleAgeMs!==null
  const measured=current?sample:historical
  if(!measured)return {label,tone,details:null,detailsTitle:'Sem medição; cadastro ou conexão de rede não confirmam vídeo.'}
  const format=positive(measured.width)&&positive(measured.height)?`${measured.width}×${measured.height}`:'Formato N/D'
  const fps=positive(measured.rateNum)&&positive(measured.rateDen)?`${(measured.rateNum/measured.rateDen).toFixed(2)} fps`:'FPS N/D'
  const audio=current?(assessment.audioRecent?`áudio ${measured.audioChannels??'?'} ch`:'SEM ÁUDIO RECENTE'):
    measured.audioPresent?`áudio informado ${measured.audioChannels??'?'} ch`:'áudio ausente na coleta'
  const age=nonnegative(measured.videoAgeMs)?Math.round(measured.videoAgeMs+(current?assessment.sampleAgeMs!:0)):null
  const frame=current?`quadro ${age??'N/D'} ms${assessment.videoRecent?'':' · SEM VÍDEO RECENTE'}`:`idade do quadro na coleta: ${age??'N/D'} ms`
  const jitter=nonnegative(measured.arrivalJitterMs)?` · variação ${measured.arrivalJitterMs.toFixed(1)} ms`:''
  const details=`${current?`Medição ${bus!.toUpperCase()}`:'Última amostra (histórica)'} · ${format} · ${fps} · ${audio} · ${frame}${jitter}`
  const detailsTitle=current?'Formato antes da escala; idade inclui o tempo desde a coleta. Variação de chegada no decoder, não jitter de pacotes.':
    `Histórico coletado em ${measured.sampledAt}. Não confirma vídeo ou áudio atuais; idade do quadro e formato pertencem à coleta.`
  return {label,tone,details,detailsTitle}
}

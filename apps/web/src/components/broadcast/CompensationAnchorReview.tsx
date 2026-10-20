import type {Anchor,OperationalCompensationReview,Rate} from '@rplayout/protocol'
import {clock,dur} from '../../format.js'
function label(anchor:Anchor,rate:Rate):string{
  if(anchor.kind==='SOFT')return clock(anchor.at,rate)
  if(anchor.kind==='WINDOW')return `${clock(anchor.from,rate)}–${clock(anchor.to,rate)}`
  return 'Horário flexível não informado'
}
export function CompensationAnchorReview({review,rate}:{review:OperationalCompensationReview;rate:Rate}){
  if(review.input.action!=='ACCEPT_DELAY')return null
  const change=review.anchorChange
  return <p>{change?`${change.before.kind==='SOFT'?'Horário-alvo flexível':'Janela flexível'}: ${label(change.before,rate)} → ${label(change.after,rate)} · atraso ${dur(review.input.deltaFrames,rate)}${change.before.kind==='SOFT'?` · tolerância ${dur(change.before.tolerance,rate)} (início executável pode diferir do alvo)`:''}`:'Servidor não forneceu horário antes/depois nesta conferência. Atualize a integração antes de aprovar pelo horário.'}</p>
}

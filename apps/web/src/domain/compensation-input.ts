import type {OperationalCompensationInput,Rate,RundownItem} from '@rplayout/protocol'
type Action=OperationalCompensationInput['action']
/** Changing an action changes only the required sign, never silently replaces
 * a comma-decimal value with a default or rounds away the operator's precision. */
export function compensationSecondsForAction(action:Action,text:string):string{
  const magnitude=text.trim().replace(/^[+-]/,'')||'30'
  return action==='TRIM'?`-${magnitude}`:action==='ACCEPT_DELAY'?magnitude:text
}
/** Advisory editorial metadata only. The server reviews the frozen revision,
 * PGM/CUE, protected zones and media bounds; this is not an authorization. */
export function compensationActionHint(item:RundownItem,action:Action):string|null{
  if(item.locked||(item.timingFlags?.protected??item.protected??false))return 'O item está marcado como protegido.'
  if(action==='FILLER'&&(!item.elastic||item.loop||!(item.type==='FILLER'||item.eventType==='FILLER')))return 'Escolha filler finito com limites elásticos.'
  if(action==='TRIM'&&(!(item.timingFlags?.trimmable??item.trimmable??item.onOverrun==='TRIM_PREV')||item.type==='LIVE'||item.sourceRef||item.liveEndpoint||!item.mediaId))return 'Escolha VT com mídia e corte permitido, não uma entrada ao vivo.'
  if(action==='DROP_OPTIONAL'&&(!(item.timingFlags?.optional??item.optional??(item.onOverrun==='DROP_FILLER'||item.onOverrun==='SKIP'))||['FIXED','HARD_TIME'].includes(item.anchor.kind)))return 'Somente item opcional sem horário obrigatório pode ser removido.'
  if(action==='ACCEPT_DELAY'&&!['SOFT','WINDOW'].includes(item.anchor.kind))return 'Aceitar atraso exige horário flexível; FIXED/HARD_TIME não são deslocados.'
  return null
}
export function compensationDeltaFrames(action:Action,text:string,rate:Rate):number{
  if(action==='DROP_OPTIONAL')return 0
  if(!text.trim())throw new Error('Informe o ajuste em segundos.')
  // Portuguese operators commonly enter comma decimals. Do not accept
  // grouping separators, exponent syntax or mixed punctuation as seconds.
  const normalized=text.trim()
  if(!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(normalized))throw new Error('Informe segundos numéricos, com ponto ou vírgula decimal, sem separador de milhar.')
  const seconds=Number(normalized.replace(',','.'))
  if(!Number.isFinite(seconds)||seconds===0||Math.abs(seconds)>600)throw new Error('Informe um ajuste diferente de zero, de até 600 segundos.')
  if(action==='TRIM'&&seconds>=0)throw new Error('Para reduzir VT, informe segundos negativos.')
  if(action==='ACCEPT_DELAY'&&seconds<=0)throw new Error('Para aceitar atraso, informe segundos positivos.')
  if(!Number.isFinite(rate.num)||!Number.isFinite(rate.den)||rate.num<=0||rate.den<=0)throw new Error('Cadência do canal inválida.')
  // Round half a frame away from zero, identically for adding/removing time.
  const frames=Math.sign(seconds)*Math.round(Math.abs(seconds)*rate.num/rate.den)
  if(!Number.isSafeInteger(frames)||frames===0)throw new Error('O ajuste deve corresponder a pelo menos um quadro.')
  return frames
}
export function compensationPresets(action:Action):readonly number[]{
  if(action==='DROP_OPTIONAL')return []
  const values=[5,15,30,120,180]
  return action==='TRIM'?values.map(value=>-value):action==='ACCEPT_DELAY'?values:[...values.map(value=>-value),...values]
}

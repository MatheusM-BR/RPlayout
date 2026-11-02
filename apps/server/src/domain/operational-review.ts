import {timingSafeEqual} from 'node:crypto'
import type {OperationalReview} from '@rplayout/protocol'
import {installationVault} from './secret-vault.js'
import {CollaborativeEditError} from './collaborative-edit.js'

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical)
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]))
  return value
}
export function operationalReview(provenance:Omit<OperationalReview,'token'>,snapshot:unknown):OperationalReview {
  return {...provenance,token:installationVault().reviewIdentity(JSON.stringify(canonical({provenance,snapshot})),'operational-review:v1')}
}
export function requireOperationalReview(review:OperationalReview,supplied:string|undefined):void {
  if(!supplied)throw new CollaborativeEditError(428,{error:'OPERATIONAL_REVIEW_REQUIRED',message:'Confira a simulação desta publicação ou rollback antes de confirmar. Nenhuma revisão foi ativada.'})
  const expected=Buffer.from(review.token),actual=Buffer.from(supplied)
  if(expected.length!==actual.length || !timingSafeEqual(expected,actual))throw new CollaborativeEditError(409,{error:'OPERATIONAL_REVIEW_SUPERSEDED',message:'A grade, mídia, QC, equipamento ou revisão operacional mudou depois da conferência. Revise novamente; nenhuma revisão foi ativada.'})
}

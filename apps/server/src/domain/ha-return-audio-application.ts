import type {z} from 'zod'
import type {MediaAsset} from '@rplayout/protocol'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import type {LocalMountCheck} from './ha-local-payload.js'
import {planReturnAudioMounts,returnAudioMountKey} from './ha-return-audio-mounts.js'
import {returnAudioEvidenceSchema} from './ha-return-audio-review.js'

type Evidence=z.infer<typeof returnAudioEvidenceSchema>
/** Recompute from original frozen editorial state/local decoded versions.
 * A signed receipt key alone cannot stand in for its cut/track/pair contents. */
export function bindReturnAudioEvidence(origin:ReturnType<typeof readReturnCandidateOrigin>,assets:ReadonlyMap<string,MediaAsset>,raw:unknown){
  if(raw===undefined)return null
  const evidence=returnAudioEvidenceSchema.parse(raw),plan=planReturnAudioMounts(origin,assets),byRevision=new Map<string,Evidence['entries']>()
  if(plan.mounts.length!==evidence.entries.length||JSON.stringify(plan.issues)!==JSON.stringify(evidence.issues))throw new Error('Plano de áudio difere do recibo selecionado.')
  for(let index=0;index<plan.mounts.length;index++){
    const expected=plan.mounts[index]!,saved=evidence.entries[index]!
    if(saved.mount.key!==expected.key||returnAudioMountKey(saved.mount)!==expected.key)throw new Error('Recibo não corresponde à edição/corte/trilha/mix/par selecionados.')
    const rows=byRevision.get(expected.revisionId)??[];rows.push(saved);byRevision.set(expected.revisionId,rows)
  }
  return {evidence,byRevision}
}
/** Applies evidence, never overwrites audio/measured/analysisId or turns AUTO on.
 * Full bus/post-gain/limiter and missing AUTO decision remain separate gates. */
export function applyReturnAudioMounts(checks:LocalMountCheck[],entries:Evidence['entries'],issues:Evidence['issues']){
  const targets=new Map<string,LocalMountCheck[]>()
  for(const check of checks){const rows=targets.get(check.itemId)??[];rows.push(check);targets.set(check.itemId,rows)}
  const target=(itemId:string)=>{const rows=targets.get(itemId);if(rows?.length!==1)throw new Error('Montagem de áudio ausente/ambígua na derivada.');return rows[0]!}
  const groups=new Map<string,Evidence['entries']>()
  for(const entry of entries){const rows=groups.get(entry.mount.itemId)??[];rows.push(entry);groups.set(entry.mount.itemId,rows)}
  for(const [itemId,rows] of groups){
    const mount=target(itemId)
    if(rows.every(row=>row.status==='MEASURED')){
      mount.warnings=mount.warnings.filter(warning=>warning!=='LOCAL_SELECTED_MIX_RENDER_PENDING')
      mount.warnings.push('LOCAL_SELECTED_AUDIO_POSTGAIN_BUS_QUALIFICATION_PENDING')
    }else for(const row of rows){if(row.status==='FAILED')mount.errors.push('LOCAL_SELECTED_AUDIO_RENDER_FAILED');else if(row.status==='UNAVAILABLE')mount.warnings.push('LOCAL_SELECTED_AUDIO_RUNTIME_UNAVAILABLE')}
  }
  for(const issue of issues){const mount=target(issue.itemId);mount.errors.push(...issue.errors);mount.warnings.push(...issue.warnings)}
  for(const check of checks){check.errors=[...new Set(check.errors)];check.warnings=[...new Set(check.warnings)]}
}

import type {z} from 'zod'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
import {inspectHaLocalGraphics,type LocalMountCheck} from './ha-local-payload.js'
import {returnGraphicEvidenceSchema,returnGraphicIdentity} from './ha-return-graphics-review.js'

type Evidence=z.infer<typeof returnGraphicEvidenceSchema>
/** Bind exact frozen references, including repeated cue/template combinations.
 * No positional fallback or adoption from a different selected edition. */
export function bindReturnGraphicEvidence(origin:ReturnType<typeof readReturnCandidateOrigin>,raw:unknown){
  if(raw===undefined)return null // Legacy stays without graphic evidence.
  const evidence=returnGraphicEvidenceSchema.parse(raw),byRevision=new Map<string,Evidence['entries']>()
  let index=0
  for(const entry of origin.entries){
    const rows:Evidence['entries']=[]
    inspectHaLocalGraphics(entry.payload,entry.revision.id,(check,svg)=>{
      const saved=evidence.entries[index],expected=returnGraphicIdentity(entry.revision.id,index,check.itemId,svg)
      if(!saved||saved.revisionId!==entry.revision.id||saved.itemId!==check.itemId||saved.key!==expected.key||saved.compositionHash!==expected.compositionHash||saved.status==='RENDERED'&&check.errors.length)throw new Error('Recibo gráfico não corresponde à edição/composição selecionada.')
      rows.push(saved);index++
    })
    if(byRevision.has(entry.revision.id))throw new Error('Edição gráfica duplicada.')
    byRevision.set(entry.revision.id,rows)
  }
  if(index!==evidence.entries.length)throw new Error('Recibos gráficos excedem as composições selecionadas.')
  return {evidence,byRevision}
}
/** Pixel evidence is not visual approval, layers/transitions qualification or
 * a command receipt. These gates remain explicit in the derived mount. */
export function applyReturnGraphicMounts(checks:LocalMountCheck[],entries:Evidence['entries']){
  const mounts=new Map<string,LocalMountCheck[]>()
  for(const check of checks)if(check.warnings.includes('LOCAL_GRAPHIC_RENDER_PENDING')||check.errors.includes('LOCAL_GRAPHIC_TEMPLATE_MISSING')){
    const rows=mounts.get(check.itemId)??[];rows.push(check);mounts.set(check.itemId,rows)
  }
  for(const entry of entries){
    const mount=mounts.get(entry.itemId)?.shift()
    if(!mount)throw new Error('Recibo gráfico sem montagem correspondente na derivada.')
    if(entry.status==='RENDERED'){
      if(mount.errors.length||!entry.frame)throw new Error('Render gráfico incompatível com montagem.')
      mount.warnings=mount.warnings.filter(warning=>warning!=='LOCAL_GRAPHIC_RENDER_PENDING')
      mount.warnings.push('LOCAL_GRAPHIC_VISUAL_APPROVAL_PENDING','LOCAL_GRAPHIC_COMPOSITION_QUALIFICATION_PENDING')
    }else if(entry.status==='UNAVAILABLE')mount.warnings.push('LOCAL_GRAPHIC_RUNTIME_UNAVAILABLE')
    else if(entry.status==='FAILED')mount.errors.push('LOCAL_GRAPHIC_RENDER_FAILED')
  }
  if([...mounts.values()].some(rows=>rows.length))throw new Error('Montagem gráfica sem recibo na derivada.')
}

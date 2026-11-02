// NOT_RUN: pure receipt-binding fixtures; no pixels rendered or runtime opened.
import {it,expect} from 'vitest'
import {bindReturnGraphicEvidence,applyReturnGraphicMounts} from './ha-return-graphics-application.js'
import {returnGraphicIdentity} from './ha-return-graphics-review.js'
import {inspectHaLocalGraphics,type LocalMountCheck} from './ha-local-payload.js'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
const origin=()=>({entries:[{
  revision:{id:'rev'},
  payload:{version:1,rundown:{id:'r',channelId:'ch'},items:[],schedule:{},graphics:{
    templates:[{id:'logo',name:'Marca',svg:'<svg><text>{{title}}</text></svg>',fields:[{key:'title',defaultValue:'Default'}]}],
    cues:[{itemId:'item',templateId:'logo',values:{title:'A'}},{itemId:'item',templateId:'logo',values:{title:'B'}}],
  }},
}]} as unknown as ReturnType<typeof readReturnCandidateOrigin>)
function evidence(source=origin()){
  const entries:unknown[]=[]
  inspectHaLocalGraphics(source.entries[0]!.payload,'rev',(check,svg)=>{
    const identity=returnGraphicIdentity('rev',entries.length,check.itemId,svg)
    entries.push({...identity,revisionId:'rev',itemId:check.itemId,status:'RENDERED',frame:{version:1,ok:true,width:1920,height:1080,format:'RGBA',decodedFrames:1,pixelBytes:1920*1080*4,pixelHash:'b'.repeat(64),nonBlackPixels:1,compositionHash:identity.compositionHash,runtimeHash:'a'.repeat(64),checkedAt:new Date().toISOString(),editorialApproved:false,publicationAuthorized:false,nativePrepared:false,authorityTransferred:false}})
  })
  return {version:1,runtimeHash:'a'.repeat(64),entries}
}
it('ties duplicate item/template references individually and preserves original payload — NOT_RUN',()=>{
  const source=origin(),before=JSON.stringify(source),bound=bindReturnGraphicEvidence(source,evidence(source))!
  const checks=inspectHaLocalGraphics(source.entries[0]!.payload)
  applyReturnGraphicMounts(checks,bound.byRevision.get('rev')!)
  expect(checks).toHaveLength(2)
  for(const check of checks){expect(check.warnings).not.toContain('LOCAL_GRAPHIC_RENDER_PENDING');expect(check.warnings).toContain('LOCAL_GRAPHIC_VISUAL_APPROVAL_PENDING');expect(check.warnings).toContain('LOCAL_GRAPHIC_COMPOSITION_QUALIFICATION_PENDING')}
  expect(JSON.stringify(source)).toBe(before)
})
it('different edition, order, filled content or excess receipt is refused — NOT_RUN',()=>{
  const source=origin(),receipt=evidence(source)
  expect(()=>bindReturnGraphicEvidence(source,{...receipt,entries:[...receipt.entries].reverse()})).toThrow('composição')
  const changed=origin();changed.entries[0]!.revision.id='other';expect(()=>bindReturnGraphicEvidence(changed,receipt)).toThrow()
  const value=origin();value.entries[0]!.payload.graphics!.cues[0]!.values.title='Different';expect(()=>bindReturnGraphicEvidence(value,receipt)).toThrow()
  expect(()=>bindReturnGraphicEvidence(source,{...receipt,entries:receipt.entries.slice(0,1)})).toThrow()
})
it('legacy stays without proof; unavailable stays pending; no positional fallback — NOT_RUN',()=>{
  const source=origin();expect(bindReturnGraphicEvidence(source,undefined)).toBeNull()
  const raw=evidence(source),receipt={...raw,runtimeHash:null,entries:raw.entries.map(entry=>({...entry as Record<string,unknown>,status:'UNAVAILABLE',frame:null}))}
  const bound=bindReturnGraphicEvidence(source,receipt)!,checks=inspectHaLocalGraphics(source.entries[0]!.payload)
  applyReturnGraphicMounts(checks,bound.byRevision.get('rev')!)
  expect(checks[0]?.warnings).toContain('LOCAL_GRAPHIC_RENDER_PENDING')
  expect(checks[0]?.warnings).toContain('LOCAL_GRAPHIC_RUNTIME_UNAVAILABLE')
  expect(()=>applyReturnGraphicMounts([] as LocalMountCheck[],bound.byRevision.get('rev')!)).toThrow('correspondente')
})

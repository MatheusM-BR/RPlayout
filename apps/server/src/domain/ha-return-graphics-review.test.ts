// NOT_RUN: contract fixtures only. No renderer, process, disk or hardware used.
import {it,expect} from 'vitest'
import {returnGraphicEvidenceSchema,summarizeReturnGraphics,reviewReturnGraphics} from './ha-return-graphics-review.js'
import type {LocalMountCheck} from './ha-local-payload.js'
const check=():LocalMountCheck=>({revisionId:'rev',itemId:'item:graphic:logo',errors:[],warnings:['LOCAL_GRAPHIC_RENDER_PENDING'],livePending:false})
it('missing runtime is explicit, persists no SVG/path and does not clear render/visual gates — NOT_RUN',async()=>{
  const mount=check(),result=await reviewReturnGraphics([{check:mount,svg:'<svg><rect fill="red"/></svg>'}],null,new AbortController().signal,()=>{})
  expect(result.summary).toEqual({required:1,rendered:0,failed:0,unavailable:1,blocked:0,visualApprovalPending:1,publicationAuthorized:false})
  expect(mount.warnings).toContain('LOCAL_GRAPHIC_RUNTIME_UNAVAILABLE')
  expect(mount.warnings).toContain('LOCAL_GRAPHIC_RENDER_PENDING')
  expect(JSON.stringify(result.evidence)).not.toContain('<svg>')
})
it('external/missing compositions remain blocked before invoking any renderer — NOT_RUN',async()=>{
  const first={...check(),errors:['GRAPHIC_EXTERNAL_RESOURCE_LOCAL_BINDING_REQUIRED']},second={...check(),errors:['LOCAL_GRAPHIC_TEMPLATE_MISSING']}
  const result=await reviewReturnGraphics([{check:first,svg:'<svg><image href="file:///PRIVATE.png"/></svg>'},{check:second,svg:null}],null,new AbortController().signal,()=>{})
  expect(result.summary).toMatchObject({required:2,blocked:2,rendered:0,visualApprovalPending:2})
  expect(new Set(result.evidence.entries.map(row=>row.key)).size).toBe(2)
  expect(JSON.stringify(result)).not.toContain('PRIVATE')
})
it('success without frame or frame tied to another composition cannot count as rendered — NOT_RUN',()=>{
  const entry={key:'a'.repeat(64),revisionId:'rev',itemId:'item',compositionHash:'b'.repeat(64),status:'RENDERED',frame:null}
  expect(returnGraphicEvidenceSchema.safeParse({version:1,runtimeHash:'c'.repeat(64),entries:[entry]}).success).toBe(false)
  expect(()=>summarizeReturnGraphics({version:1,runtimeHash:null,entries:[entry]})).toThrow()
})

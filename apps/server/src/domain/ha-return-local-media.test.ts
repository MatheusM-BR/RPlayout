// NOT_RUN: requirements contracts only; no filesystem/probe/native execution.
import {it,expect} from 'vitest'
import {returnRequiredMedia,returnLocalMediaOptions,selectReturnLocalMedia,type HaReturnMediaInventory} from './ha-return-local-media.js'
import type {MediaAsset} from '@rplayout/protocol'
import type {readReturnCandidateOrigin} from './ha-return-candidate-origin.js'
function origin(){return {entries:[{payload:{items:[{id:'live',liveFallbackMediaId:'backup',liveConfig:{fallbackMediaId:'backup'}},{id:'vt',mediaId:'vt'}],assets:[{id:'backup',kind:'VIDEO',contentHash:'a'.repeat(64),path:'C:/FOREIGN/backup.mp4'},{id:'vt',kind:'VIDEO',contentHash:'b'.repeat(64),path:'C:/FOREIGN/vt.mp4'},{id:'unused',kind:'VIDEO',contentHash:'c'.repeat(64),path:'C:/FOREIGN/unused.mp4'}]}}]} as unknown as ReturnType<typeof readReturnCandidateOrigin>}
it('VT e contingência têm SHA exigido; metadado não utilizado não vira arquivo — NOT_RUN',()=>{
  const source=origin(),before=JSON.stringify(source),required=returnRequiredMedia(source)
  expect([...required.keys()]).toEqual(['backup:'+ 'a'.repeat(64),'vt:'+ 'b'.repeat(64)])
  expect(required.size).toBe(2);expect(JSON.stringify(source)).toBe(before)
})
it('mídia faltante, SHA inválido e metadados duplicados recusados — NOT_RUN',()=>{
  const missing=origin();missing.entries[0]!.payload.assets=[];expect(()=>returnRequiredMedia(missing)).toThrow('ausente')
  const invalid=origin();invalid.entries[0]!.payload.assets![0]={...invalid.entries[0]!.payload.assets![0]!,contentHash:'invalid'};expect(()=>returnRequiredMedia(invalid)).toThrow('inválida')
  const duplicate=origin();duplicate.entries[0]!.payload.assets!.push(duplicate.entries[0]!.payload.assets![0]!);expect(()=>returnRequiredMedia(duplicate)).toThrow('duplicadas')
})
it('mesma versão publicada com tipo conflitante não é reinterpretada — NOT_RUN',()=>{
  const source=origin(),entry=structuredClone(source.entries[0]!)
  entry.payload.assets![0]={...entry.payload.assets![0]!,kind:'AUDIO'};source.entries.push(entry)
  expect(()=>returnRequiredMedia(source)).toThrow('conflitante')
})
it('escolha explícita resolve duplicidade sem adotar path estrangeiro — NOT_RUN',()=>{
  const rows=[{asset:{id:'local-a',title:'Cópia A',kind:'VIDEO',contentHash:'a'.repeat(64),path:'C:/LOCAL_PRIVATE_PATH/a.mp4'} as MediaAsset,qcStatus:'APPROVED'},{asset:{id:'local-b',title:'Cópia B',kind:'VIDEO',contentHash:'a'.repeat(64),path:'C:/LOCAL_PRIVATE_PATH/b.mp4'} as MediaAsset,qcStatus:'BLOCKED'}]
  expect(selectReturnLocalMedia(rows,'a'.repeat(64),'VIDEO')).toHaveLength(2)
  expect(selectReturnLocalMedia(rows,'a'.repeat(64),'VIDEO','local-b').map(row=>row.asset.id)).toEqual(['local-b'])
  expect(selectReturnLocalMedia(rows,'a'.repeat(64),'VIDEO','foreign-id')).toEqual([])
  expect(selectReturnLocalMedia(rows,'a'.repeat(64),'AUDIO','local-a')).toEqual([])
  const inventory:HaReturnMediaInventory={profile:undefined,assets:rows},view=returnLocalMediaOptions({...origin(),channel:{id:'ch'}} as ReturnType<typeof readReturnCandidateOrigin>,inventory,'application','b'.repeat(64))
  expect(JSON.stringify(view)).not.toContain('LOCAL_PRIVATE_PATH');expect(JSON.stringify(view)).not.toContain('FOREIGN');expect(view.physicalBytesValidated).toBe(false);expect(view.operationalReady).toBe(false)
  const changed=returnLocalMediaOptions({...origin(),channel:{id:'ch'}} as ReturnType<typeof readReturnCandidateOrigin>,{...inventory,assets:rows.map(row=>({...row,qcStatus:'REJECTED'}))},'application','b'.repeat(64))
  expect(changed.inventoryMac).not.toBe(view.inventoryMac)
})

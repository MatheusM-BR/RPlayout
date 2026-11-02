import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,it,expect} from 'vitest'
import {PreviewFrameStatus} from '../components/broadcast/PreviewFrameStatus.js'
describe('PVW decoder delivery is not browser/transmission proof',()=>{
 const sample={itemId:'vt',decoderId:1,delivered:true,ageMs:10,pausedFile:false,sampledAt:Date.now()}
 it('labels delivery with scope caveat',()=>{
  const html=renderToStaticMarkup(createElement(PreviewFrameStatus,{sample:{...sample,sampledAt:Date.now()}}))
  expect(html).toContain('vídeo entregue pelo decoder');expect(html).toContain('não comprova imagem no navegador')
 })
 it('missing, stale and future telemetry cannot claim delivery',()=>{
  for(const value of [null,{...sample,sampledAt:Date.now()-3000},{...sample,sampledAt:Date.now()+3000},{...sample,delivered:false}]){
   expect(renderToStaticMarkup(createElement(PreviewFrameStatus,{sample:value}))).toContain('não confirmada')
  }
 })
})

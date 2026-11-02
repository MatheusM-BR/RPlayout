// NOT_RUN: prepared contracts only; no native child, renderer or image opened.
import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {readLocalGraphicFrame} from './ha-local-graphic-probe.js'
import {graphicProbeComposition,fitGraphicViewport} from './graphic-viewport.js'
const pixels=Buffer.from([255,0,0,255,0,0,0,255,0,255,0,255,0,0,0,255])
const header={version:1,ok:true,width:2,height:2,format:'RGBA',decodedFrames:1,pixelBytes:16}
const packet=(value=header,data=pixels)=>Buffer.concat([Buffer.from(JSON.stringify(value)+'\n'),data])
it('accepts exact decoded pixel bytes with independent hash and no editorial/PGM grant — NOT_RUN',()=>{
  expect(readLocalGraphicFrame(packet(),2,2)).toMatchObject({pixelHash:createHash('sha256').update(pixels).digest('hex'),nonBlackPixels:2,editorialApproved:false,publicationAuthorized:false})
})
it('JSON success alone, truncated/extra pixels and mismatched geometry are refused — NOT_RUN',()=>{
  for(const bytes of [packet(header,Buffer.alloc(0)),packet(header,pixels.subarray(0,15)),packet(header,Buffer.concat([pixels,Buffer.from([0])])),Buffer.from(JSON.stringify(header))])expect(()=>readLocalGraphicFrame(bytes,2,2)).toThrow()
  expect(()=>readLocalGraphicFrame(packet(),4,2)).toThrow()
  expect(()=>readLocalGraphicFrame(packet({...header,pixelBytes:15}),2,2)).toThrow()
})
it('empty picture is explicitly counted, not converted into editorial approval — NOT_RUN',()=>{
  expect(readLocalGraphicFrame(packet(header,Buffer.alloc(16)),2,2)).toMatchObject({nonBlackPixels:0,editorialApproved:false,publicationAuthorized:false})
})
it('probe uses the canonical on-air viewport and full-opacity wrapper — NOT_RUN',()=>{
  const svg='<svg width="640" height="360"><rect width="640" height="360" fill="red"/></svg>'
  expect(graphicProbeComposition(svg)).toContain(fitGraphicViewport(svg))
  expect(graphicProbeComposition(svg)).toContain('preserveAspectRatio="none"><g opacity="1.000">')
})

import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,it,expect} from 'vitest'
import type {OperationalCompensationReview} from '@rplayout/protocol'
import {CompensationAnchorReview} from '../components/broadcast/CompensationAnchorReview.js'
const review:OperationalCompensationReview={input:{itemId:'soft',expectedFrames:75,action:'ACCEPT_DELAY',deltaFrames:3000},reviewToken:'token',sourceRevisionId:'rev',title:'Soft',beforeFrames:75,afterFrames:75,beforeEffectiveFrames:75,afterEffectiveFrames:75,conflicts:[],notice:'Review'}
const markup=(overrides:Partial<OperationalCompensationReview>)=>renderToStaticMarkup(createElement(CompensationAnchorReview,{review:{...review,...overrides},rate:{num:25,den:1}}))
describe('delay review shows server-calculated anchor changes',()=>{
 it('shows SOFT before/after rather than unchanged clip duration',()=>{
  const html=markup({anchorChange:{before:{kind:'SOFT',at:90000,tolerance:0,priority:1},after:{kind:'SOFT',at:93000,tolerance:0,priority:1}}})
  expect(html).toContain('01:00:00');expect(html).toContain('01:02:00');expect(html).toContain('atraso 02:00')
  expect(html).toContain('Horário-alvo flexível');expect(html).toContain('início executável pode diferir')
 })
 it('shows both bounds of WINDOW',()=>{
  const html=markup({anchorChange:{before:{kind:'WINDOW',from:90000,to:91500,priority:1},after:{kind:'WINDOW',from:93000,to:94500,priority:1}}})
  for(const time of ['01:00:00','01:01:00','01:02:00','01:03:00'])expect(html).toContain(time)
 })
 it('does not invent legacy missing timing or show anchors for trim',()=>{
  expect(markup({})).toContain('Servidor não forneceu')
  expect(markup({input:{...review.input,action:'TRIM'}})).toBe('')
 })
})

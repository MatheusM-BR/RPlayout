import {it,expect} from 'vitest'
import type {RundownItem,Rate} from '@rplayout/protocol'
import type {ItemView} from '../types.js'
import {compensationConflictMeasures,compensationMeasuredDelta} from './compensation-conflicts.js'
import {CompensationConflictMeasures} from '../components/broadcast/CompensationConflictMeasures.js'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const rate={num:25,den:1}
const row=(id:string,change:Partial<RundownItem>={}):ItemView=>({item:{id,title:id,type:'VT',locked:false,protected:false,mediaId:'asset',trimmable:true,onOverrun:'PUSH',anchor:{kind:'FLOW'},...change}} as ItemView)
const items=[row('live',{type:'LIVE',sourceRef:'ndi:fixture'}),row('filler',{type:'FILLER',elastic:{min:25,max:10000}}),row('vt'),row('soft',{anchor:{kind:'SOFT',at:10000,tolerance:500,priority:1}}),row('hard',{anchor:{kind:'HARD_TIME',at:20000}})]
const measure=(kind='OVERRUN',frames=3350,target='vt',action:'TRIM'|'FILLER'|'ACCEPT_DELAY'='TRIM',cadence:Rate=rate)=>compensationConflictMeasures(items,target,action,[{kind,itemId:kind==='ANCHOR_MISSED'?'soft':'hard',frames}],cadence)

it('copies a 2m14s overrun as a negative exact-frame cut, not a TAKE or automatic commit',()=>{
 const [value]=measure()
 expect(value).toMatchObject({itemId:'vt',anchorItemId:'hard',conflictFrames:3350,deltaFrames:-3350,secondsText:'-134',action:'TRIM'})
 expect(compensationMeasuredDelta('vt','TRIM',value!.secondsText,rate,value!)).toBe(-3350)
})
it('copies GAP for filler expansion and excess for filler reduction',()=>{
 expect(measure('GAP',4500,'filler','FILLER')[0]).toMatchObject({deltaFrames:4500,secondsText:'180'})
 expect(measure('OVERRUN',4500,'filler','FILLER')[0]).toMatchObject({deltaFrames:-4500,secondsText:'-180'})
 expect(measure('GAP',4500)).toEqual([])
})
it('accepting delay targets only its missed flexible anchor, never a hard/fixed anchor or another item',()=>{
 expect(measure('ANCHOR_MISSED',63,'soft','ACCEPT_DELAY')[0]).toMatchObject({deltaFrames:63,secondsText:'2.52'})
 expect(measure('ANCHOR_MISSED',63,'vt','ACCEPT_DELAY')).toEqual([])
 expect(measure('OVERRUN',63,'hard','ACCEPT_DELAY')).toEqual([])
 const fixed=items.map(value=>value.item.id==='soft'?row('soft',{anchor:{kind:'FIXED',at:10000}}):value)
 expect(compensationConflictMeasures(fixed,'soft','ACCEPT_DELAY',[{kind:'ANCHOR_MISSED',itemId:'soft',frames:63}],rate)).toEqual([])
})
it('cannot use an item at or after the conflicting anchor to fill/cut the preceding interval',()=>{
 const conflict=[{kind:'OVERRUN',itemId:'vt',frames:25}]
 for(const target of ['vt','soft','hard'])expect(compensationConflictMeasures(items,target,'TRIM',conflict,rate)).toEqual([])
})
it('protected/live/continuous filler and unknown rows are not offered as candidates',()=>{
 const conflict=[{kind:'OVERRUN',itemId:'hard',frames:25}]
 for(const item of[row('vt',{protected:true}),row('vt',{locked:true}),row('vt',{trimmable:false}),row('vt',{type:'LIVE'}),row('vt',{sourceRef:'omt:fixture'})]){
  expect(compensationConflictMeasures([item,items[4]!],'vt','TRIM',conflict,rate)).toEqual([])
 }
 expect(compensationConflictMeasures([row('filler',{type:'FILLER',loop:true,elastic:{min:25,max:10000}}),items[4]!],'filler','FILLER',conflict,rate)).toEqual([])
 expect(measure('OVERRUN',25,'unknown')).toEqual([])
 expect(compensationConflictMeasures(items,'vt','TRIM',[{kind:'OVERRUN',itemId:'unknown',frames:25}],rate)).toEqual([])
})
it.each(['MEDIA_UNAVAILABLE','ANCHOR_PAST','PROTECTED_ZONE_OVERRIDDEN','UNKNOWN'])('does not turn %s into a timing adjustment',kind=>{
 expect(measure(kind,25)).toEqual([])
})
it.each([0,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,15001])('refuses invalid or over-600s measurement %s',frames=>{
 expect(measure('OVERRUN',frames)).toEqual([])
})
it.each([{num:0,den:1},{num:25,den:0},{num:NaN,den:1},{num:25.5,den:1}])('invalid cadence is not guessed: %j',cadence=>{
 expect(measure('OVERRUN',25,'vt','TRIM',cadence)).toEqual([])
})
it('keeps exact frames at fractional cadence while a subsequent timing tick changes the available measurement',()=>{
 const cadence={num:30000,den:1001},original=measure('OVERRUN',3597,'vt','TRIM',cadence)[0]!
 const changed=measure('OVERRUN',3627,'vt','TRIM',cadence)[0]!
 expect(changed.deltaFrames).not.toBe(original.deltaFrames)
 expect(compensationMeasuredDelta('vt','TRIM',original.secondsText,cadence,original)).toBe(-3597)
 expect(compensationMeasuredDelta('vt','TRIM','-2,5',cadence,original)).toBe(-75)
 expect(compensationMeasuredDelta('filler','FILLER',original.secondsText,cadence,original)).toBe(-3597)
 expect(()=>compensationMeasuredDelta('vt','ACCEPT_DELAY',original.secondsText,cadence,original)).toThrow('positivos')
 expect(()=>compensationMeasuredDelta('vt','TRIM',original.secondsText,rate,original)).toThrow('cadência mudou')
})
it('deduplicates measurements without changing the input schedule or inventing DROP_OPTIONAL durations',()=>{
 const conflict={kind:'OVERRUN',itemId:'hard',frames:25},before=JSON.stringify(items)
 expect(compensationConflictMeasures(items,'vt','TRIM',[conflict,conflict],rate)).toHaveLength(1)
 expect(compensationConflictMeasures(items,'vt','DROP_OPTIONAL',[conflict],rate)).toEqual([])
 expect(JSON.stringify(items)).toBe(before)
})
it('markup only copies measurements, remains disabled in flight and escapes source titles',()=>{
 const [value]=measure();value!.anchorTitle='<img src=x onerror=alert(1)>'
 const html=renderToStaticMarkup(createElement(CompensationConflictMeasures,{measures:[value!],rate,disabled:true,onCopy:()=>{throw new Error('Rendering must not act')}}))
 expect(html).toContain('Usar medida de conflito calculado');expect(html).toContain('Somente preenche o valor')
 expect(html).toContain('disabled=""');expect(html).toContain('type="button"');expect(html).toContain('&lt;img')
 expect(html).not.toContain('<img');expect(html).not.toContain('Confirmar compensação')
 expect(renderToStaticMarkup(createElement(CompensationConflictMeasures,{measures:[],rate,disabled:false,onCopy:()=>{}}))).toBe('')
})

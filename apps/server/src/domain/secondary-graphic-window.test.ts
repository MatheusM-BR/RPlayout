import {expect,it} from 'vitest'
import type {SecondaryEvent} from '@rplayout/protocol'
import {secondaryGraphicWindow} from './secondary-graphic-window.js'
const event={triggerMode:'OFFSET_FROM_START',offsetFrames:25,durationFrames:75} as SecondaryEvent
it('retomada conserva fim original, não reinicia duração inteira',()=>{
  expect(secondaryGraphicWindow(event,250,80)).toEqual({start:25,end:100,expired:false,remainingFrames:20})
  expect(secondaryGraphicWindow(event,250,100).expired).toBe(true)
})
it('deixa relativa ao fim usa duração montada do item e limita início a zero',()=>{
  const relative={...event,triggerMode:'OFFSET_BEFORE_END' as const,offsetFrames:200}
  expect(secondaryGraphicWindow(relative,250,80)).toMatchObject({start:50,end:125,remainingFrames:45})
  expect(secondaryGraphicWindow(relative,100,10)).toMatchObject({start:0,end:75,remainingFrames:65})
})
it('deixa manual usa quadro de disparo persistido, não offset nominal nem reinício',()=>{
  const manual={...event,triggerMode:'MANUAL' as const,offsetFrames:0}
  expect(secondaryGraphicWindow(manual,250,140,100)).toMatchObject({start:100,end:175,remainingFrames:35})
  expect(secondaryGraphicWindow(manual,250,100)).toMatchObject({start:100,end:175,remainingFrames:75})
})
it('arte sem duração não inventa fim e quadros restantes não são fracionários',()=>{
  expect(secondaryGraphicWindow({...event,durationFrames:undefined},250,1000)).toMatchObject({end:null,expired:false,remainingFrames:undefined})
  expect(secondaryGraphicWindow(event,250,99.5).remainingFrames).toBe(1)
})

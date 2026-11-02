import {it,expect} from 'vitest'
import {prepareHaGraphicRecovery} from './ha-graphic-recovery.js'
import {graphicLayers,type GraphicDisplaySnapshot} from './graphic-composition.js'
// NOT_RUN. Authenticated input translation only; not native render/PGM proof.
function display():GraphicDisplaySnapshot{return {version:1,layers:Object.fromEntries(graphicLayers.map(layer=>[layer,{layer,active:false}])) as GraphicDisplaySnapshot['layers'],current:null,currentLayer:null,deadlines:{},versions:{},owners:{},emergencySvg:null}}
it('legacy absence is unverified rather than a proven clear display',()=>{
  expect(prepareHaGraphicRecovery(undefined,null)).toMatchObject({status:'UNVERIFIED',display:null})
  expect(prepareHaGraphicRecovery(undefined,'primary-receipt')).toMatchObject({status:'UNVERIFIED',sourceReceiptId:'primary-receipt'})
})
it('binds the source receipt and refuses a different checkpoint pointer',()=>{
  const saved={version:1,status:'CONFIRMED',sourceReceiptId:'primary-receipt',display:display(),reason:null}
  expect(()=>prepareHaGraphicRecovery(saved,'other-receipt')).toThrow('checkpoint')
  expect(prepareHaGraphicRecovery(saved,'primary-receipt')).toMatchObject({status:'CONFIRMED',sourceReceiptId:'primary-receipt'})
})
it('preserves absolute expiry and appearance without importing event ownership',()=>{
  const composition=display()
  composition.layers.LOWER_THIRD={layer:'LOWER_THIRD',active:true,svg:'<rect width="100" height="30"/>',opacity:0.8}
  composition.versions.LOWER_THIRD=7;composition.owners.LOWER_THIRD={eventId:'foreign-event',version:7};composition.deadlines.LOWER_THIRD=1700000000000
  const result=prepareHaGraphicRecovery({version:1,status:'CONFIRMED',sourceReceiptId:'receipt',display:composition,reason:null},'receipt')
  expect(result.display).toMatchObject({owners:{},deadlines:{LOWER_THIRD:1700000000000},layers:{LOWER_THIRD:{active:true,opacity:0.8}}})
  expect(composition.owners.LOWER_THIRD?.eventId).toBe('foreign-event')
})
it('refuses clear claims carrying an active layer',()=>{
  const composition=display();composition.layers.STATION_LOGO.active=true
  expect(()=>prepareHaGraphicRecovery({version:1,status:'CLEAR',sourceReceiptId:null,display:composition,reason:null},null)).toThrow()
})
it('preserves blocked state and does not fabricate a display',()=>{
  expect(prepareHaGraphicRecovery({version:1,status:'BLOCKED',sourceReceiptId:null,display:null,reason:'Comando incerto'},null)).toMatchObject({status:'BLOCKED',display:null})
})
it('refuses external resources in layers and emergency overlays',()=>{
  for(const emergency of [false,true]){
    const composition=display(),svg='<image href="file:///C:/PRIMARY/logo.png"/>'
    if(emergency)composition.emergencySvg=svg
    else composition.layers.STATION_LOGO={layer:'STATION_LOGO',active:true,svg}
    expect(()=>prepareHaGraphicRecovery({version:1,status:'CONFIRMED',sourceReceiptId:'receipt',display:composition,reason:null},'receipt')).toThrow('recurso externo')
  }
})

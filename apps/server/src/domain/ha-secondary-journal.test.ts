import {it,expect} from 'vitest'
import {randomUUID,createHash} from 'node:crypto'
import {canonicalHaSecondaryRuns} from './ha-secondary-journal.js'
import {graphicLayers,type GraphicDisplaySnapshot} from './graphic-composition.js'
// NOT_RUN. Decoded chronological projection, not DB/vault/native/physical proof.
function fixture(){
  const id=randomUUID(),display:GraphicDisplaySnapshot={version:1,layers:Object.fromEntries(graphicLayers.map(layer=>[layer,{layer,active:false}])) as GraphicDisplaySnapshot['layers'],current:null,currentLayer:null,deadlines:{},versions:{},owners:{},emergencySvg:null}
  const payload={version:1,promotionId:randomUUID(),channelId:'ch',executionId:'local-execution',revisionId:'local-edition',itemId:'item',decoderId:31,eventId:'future',mode:'FIRE',frames:100,ownerId:randomUUID(),term:9,composition:display,compositionHash:createHash('sha256').update(JSON.stringify(display)).digest('hex')}
  return {id,row:(phase:string,extra:Record<string,unknown>={})=>({id:id+':'+phase,kind:'HA_SECONDARY_'+phase,createdAt:'2026-10-10T12:00:00.000Z',payload:{...payload,...extra}})}
}
it('projects only an ordered confirmed composition as executed',()=>{
  const f=fixture(),runs=canonicalHaSecondaryRuns([f.row('ACCEPTED'),f.row('SENDING',{frames:101}),f.row('CONFIRMED',{frames:102})])
  expect(runs).toMatchObject([{id:'ha-secondary:'+f.id,state:'EXECUTED',frames:101,executionId:'local-execution',sourceNamespace:'HA_SECONDARY',physicalOutputValidated:false}])
})
it('unfinished and uncertain sends remain firing, not successful or replayable',()=>{
  for(const phases of [['ACCEPTED'],['ACCEPTED','SENDING'],['ACCEPTED','SENDING','UNCERTAIN']]){
    const f=fixture();expect(canonicalHaSecondaryRuns(phases.map(phase=>f.row(phase)))[0]).toMatchObject({state:'FIRING',completedAt:null})
  }
})
it('refuses missing intention, duplicate terminal, wrong context and forged composition hash',()=>{
  const f=fixture()
  expect(()=>canonicalHaSecondaryRuns([f.row('CONFIRMED')])).toThrow('intenção')
  expect(()=>canonicalHaSecondaryRuns([f.row('ACCEPTED'),f.row('SENDING'),f.row('CONFIRMED'),f.row('CONFIRMED')])).toThrow('Cronologia')
  expect(()=>canonicalHaSecondaryRuns([f.row('ACCEPTED'),f.row('SENDING',{decoderId:32})])).toThrow('contexto')
  expect(()=>canonicalHaSecondaryRuns([f.row('ACCEPTED'),f.row('SENDING'),f.row('CONFIRMED',{compositionHash:'a'.repeat(64)})])).toThrow('íntegra')
})
it('superseded dismissal is not a command executed at the destination',()=>{
  const f=fixture(),runs=canonicalHaSecondaryRuns([f.row('ACCEPTED',{mode:'DISMISS'}),f.row('SUPERSEDED',{mode:'DISMISS'})])
  expect(runs[0]?.state).toBe('FAILED')
  expect(()=>canonicalHaSecondaryRuns([f.row('ACCEPTED'),f.row('SUPERSEDED')])).toThrow('Descarte')
})

import {it,expect} from 'vitest'
import {randomUUID,createHash} from 'node:crypto'
import type {Db} from '../db/client.js'
import {graphicLayers,type GraphicDisplaySnapshot} from './graphic-composition.js'
import {readHaGraphicComposition,HA_GRAPHIC_RECEIPT_PREFIX} from './ha-graphic-receipts.js'
// NOT_RUN. Mocked decoded rows/chronology only, not SQLite/vault/native proof.
const composition:GraphicDisplaySnapshot={version:1,layers:Object.fromEntries(graphicLayers.map(layer=>[layer,{layer,active:false}])) as GraphicDisplaySnapshot['layers'],current:null,currentLayer:null,deadlines:{},versions:{},owners:{},emergencySvg:null}
function fixture(){
  const id=randomUUID()+':CONFIRMED',payload={channelId:'ch',promotionId:randomUUID(),ownerId:randomUUID(),term:9,composition,compositionHash:createHash('sha256').update(JSON.stringify(composition)).digest('hex')}
  const row={id,kind:'HA_GRAPHIC_PREPARATION_CONFIRMED',rundownId:'@ha',payload}
  const later:Array<{id:string;kind:string;payload:Record<string,unknown>}>=[]
  const query={from:()=>query,where:()=>query,orderBy:()=>query,get:()=>row,all:()=>later}
  return {db:{select:()=>query} as unknown as Db,row,later,receipt:HA_GRAPHIC_RECEIPT_PREFIX+id}
}
it('accepts only the local confirmed namespace and matching composition SHA/channel',()=>{
  const f=fixture();expect(readHaGraphicComposition(f.db,'ch',f.receipt)).toEqual(composition)
  expect(()=>readHaGraphicComposition(f.db,'other',f.receipt)).toThrow('canal')
  expect(()=>readHaGraphicComposition(f.db,'ch','primary-receipt')).toThrow('local HA')
  f.row.payload.compositionHash='a'.repeat(64)
  expect(()=>readHaGraphicComposition(f.db,'ch',f.receipt)).toThrow('SHA')
})
it('later confirmed display invalidates a stale checkpoint',()=>{
  const f=fixture()
  f.later.push({id:randomUUID()+':CONFIRMED',kind:'HA_GRAPHIC_EXPIRATION_CONFIRMED',payload:{...f.row.payload}})
  expect(()=>readHaGraphicComposition(f.db,'ch',f.receipt)).toThrow('mais recente')
})
it('pending or uncertain later changes cannot be treated as a safe old composition',()=>{
  for(const phase of ['ACCEPTED','SENDING','UNCERTAIN']){
    const f=fixture();f.later.push({id:randomUUID()+':'+phase,kind:'HA_SECONDARY_'+phase,payload:{...f.row.payload}})
    expect(()=>readHaGraphicComposition(f.db,'ch',f.receipt)).toThrow('incerta')
  }
})
it('a definitively rejected command does not change the old display',()=>{
  const f=fixture(),command=randomUUID()
  for(const phase of ['ACCEPTED','SENDING','REJECTED'])f.later.push({id:command+':'+phase,kind:'HA_SECONDARY_'+phase,payload:{...f.row.payload}})
  expect(readHaGraphicComposition(f.db,'ch',f.receipt)).toEqual(composition)
})

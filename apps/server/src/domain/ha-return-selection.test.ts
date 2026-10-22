// NOT_RUN: fixtures prepared, not executed; no native/authority qualification.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {HaReturnSelections,haReturnSelectionRequest} from './ha-return-selection.js'
const request=()=>({planId:randomUUID(),reviewId:randomUUID(),rekeyId:randomUUID(),transferId:randomUUID(),channelId:'ch',editionInventoryMac:'a'.repeat(43),checkpointMac:null,revisionIds:['rev'],executionRevisionId:'rev',cursorPolicy:'STOPPED',reason:'Reviewed explicit selection'})
it('seleção não aceita chave/caminho/autorização nem edição ausente — NOT_RUN',()=>{
  const value=request()
  expect(haReturnSelectionRequest.safeParse(value).success).toBe(true)
  for(const extra of [{file:'foreign'},{installationKey:'secret'},{publicationAuthorized:true}])expect(haReturnSelectionRequest.safeParse({...value,...extra}).success).toBe(false)
  expect(haReturnSelectionRequest.safeParse({...value,executionRevisionId:'other'}).success).toBe(false)
  expect(haReturnSelectionRequest.safeParse({...value,revisionIds:['rev','rev']}).success).toBe(false)
})
it('registro é cifrado, imutável, idempotente e sem prontidão operacional — NOT_RUN',()=>{
  const db=new Database(':memory:'),value=request()
  try{
    const plans=new HaReturnSelections(db,'test-context','boot-a'),report=plans.save(value,'b'.repeat(64),'operator',()=>{})
    expect(report.phase).toBe('SELECTION_RECORDED');expect(report.operationalReady).toBe(false);expect(report.authorityTransferred).toBe(false)
    expect(plans.save(value,'c'.repeat(64),'other',()=>{})).toEqual(report)
    expect(()=>plans.save({...value,reason:'Changed selection'},'b'.repeat(64),'operator',()=>{})).toThrow()
    expect(()=>db.prepare('DELETE FROM ha_return_selection_plans').run()).toThrow()
    const saved=db.prepare('SELECT payload FROM ha_return_selection_plans').get() as {payload:string}
    expect(saved.payload).not.toContain(value.reason)
    const successor=new HaReturnSelections(db,'test-context','boot-b')
    expect(successor.query(value.planId,'ch').ownedHere).toBe(false)
    expect(()=>successor.query(value.planId,'other')).toThrow()
  }finally{db.close()}
})

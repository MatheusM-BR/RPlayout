// NOT_RUN: admission fixture prepared, not executed.
import {it,expect} from 'vitest'
import Database from 'better-sqlite3'
import {assertNoUnboundReturnCandidate} from './return-candidate-admission.js'
it('marcador do candidato bloqueia bootstrap mesmo sem provenance legível — NOT_RUN',()=>{
  const db=new Database(':memory:')
  try{expect(()=>assertNoUnboundReturnCandidate(db)).not.toThrow();db.exec('CREATE TABLE ha_return_candidate_origin(id INTEGER,payload TEXT)');expect(()=>assertNoUnboundReturnCandidate(db)).toThrow('partida operacional bloqueada')}
  finally{db.close()}
})

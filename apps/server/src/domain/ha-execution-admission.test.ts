import {it,expect} from 'vitest'
import {HaExecutionAdmission,assertHaExecutionAdmission} from './ha-execution-admission.js'
// NOT_RUN: unforgeability checks only, not native host/storage admission proof.
it('browser objects and reconstructed prototypes are not process-local admissions',()=>{
  for(const value of [null,{}, {ownedHere:true,promotionReady:true},Object.create(HaExecutionAdmission.prototype)])expect(()=>assertHaExecutionAdmission(value)).toThrow('capacidade local')
})
it('forged admission cannot authorize native preparation or release storage',()=>{
  const forged=Object.create(HaExecutionAdmission.prototype) as HaExecutionAdmission
  expect(()=>forged.markNativePreparation()).toThrow('capacidade local')
  expect(()=>forged.releaseAfterStop(true)).toThrow('capacidade local')
  expect(()=>forged.assertNativeActivation()).toThrow('capacidade local')
  expect(()=>forged.completeTransfer({} as never)).toThrow('capacidade local')
})

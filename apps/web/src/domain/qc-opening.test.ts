import {expect,it} from 'vitest'
import {qcOpeningMessage} from './use-qc-live-inspection.js'

it('abertura do decodificador do QC não aparece como erro',()=>{
  expect(qcOpeningMessage('aguardando o primeiro quadro da fonte no decodificador do QC')).toBe(true)
  expect(qcOpeningMessage('aguardando quadro válido da fonte no preview')).toBe(true)
  expect(qcOpeningMessage('Outro QC está inspecionando outra entrada deste canal.')).toBe(false)
})

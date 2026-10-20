import {describe,it,expect} from 'vitest'
import {assertRollbackSchema,currentRollbackContract,qualifiedHistoricalRollbackContract} from './rollback-contract.js'
describe('contrato de retorno sem downgrade presumido',()=>{
  const contract=currentRollbackContract(),rows=contract.migrations.map((name,index)=>({version:index+1,name}))
  it('aceita somente lista completa e identidade exata do schema',()=>{expect(assertRollbackSchema(rows,contract)).toEqual(contract)})
  it.each(['older','gap','identity','future'])('recusa schema %s sem alterar a lista',kind=>{
    const changed=rows.map(row=>({...row}))
    if(kind==='older')changed.pop();else if(kind==='gap')changed.splice(1,1);else if(kind==='identity')changed[0]!.name='unknown';else changed.push({version:rows.length+1,name:'future'})
    expect(()=>assertRollbackSchema(changed,contract)).toThrow('schema atual');expect(rows[0]!.name).toBe(contract.migrations[0])
  })
  it('adapter histórico depende do manifesto completo conhecido e mantém limite50',()=>{
    expect(qualifiedHistoricalRollbackContract('6897C8E308CF40893804B9313A10255F75271C5028EAD63FF6C6E1D66D2E981C').migrations).toHaveLength(50)
    expect(()=>qualifiedHistoricalRollbackContract('0'.repeat(64))).toThrow('qualificação')
  })
})

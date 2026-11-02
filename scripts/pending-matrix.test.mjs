import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parsePendingMatrix,verifyDeclaredTotals} from './lib/pending-matrix.mjs'
const text=`Histórico:53 testes PASS não são53 requisitos.
## Pendência 1 — Exemplo
- 1.1 Primeiro:
  **concluída por cobertura**. Histórico em andamento.
- 1.2 Segundo: **em andamento**. Falta conferir.
## Pendência 8 — v3
- 8.1 Reserva: **adiada para v3**.
## Totais
| 1 | 2 | 1 | 1 | 0 | 0 |
| 8 | 1 | 0 | 0 | 0 | 1 |
| **Total** | **3** | **1** | **1** | **0** | **1** |`
test('counts requirement states, not repeated historical test claims',()=>{
  const parsed=parsePendingMatrix(text)
  assert.deepEqual(parsed.totals,{groups:2,checks:3,complete:1,inProgress:1,pending:0,deferred:1})
  verifyDeclaredTotals(text,parsed)
})
test('rejects duplicate IDs and unknown states',()=>{
  assert.throws(()=>parsePendingMatrix(text.replace('1.2 Segundo','1.1 Segundo')),/duplicada/)
  assert.throws(()=>parsePendingMatrix(text.replace('**em andamento**','**quase pronto**')),/desconhecido/)
})
test('rejects totals that diverge from individual requirement states',()=>{
  assert.throws(()=>verifyDeclaredTotals(text.replace('| 1 | 2 | 1 | 1 | 0 | 0 |','| 1 | 2 | 2 | 0 | 0 | 0 |'),parsePendingMatrix(text)),/divergentes/)
})
test('duplicate table rows cannot conceal a missing group',()=>{
  assert.throws(()=>verifyDeclaredTotals(text.replace('| 8 | 1 | 0 | 0 | 0 | 1 |','| 1 | 2 | 1 | 1 | 0 | 0 |'),parsePendingMatrix(text)),/duplicado na tabela/)
})

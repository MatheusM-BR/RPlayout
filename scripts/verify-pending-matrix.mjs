import {readFile} from 'node:fs/promises'
import {parsePendingMatrix,verifyDeclaredTotals} from './lib/pending-matrix.mjs'
const markdown=await readFile(new URL('../docs/PENDENCIAS-NUMERADAS.md',import.meta.url),'utf8')
const matrix=parsePendingMatrix(markdown)
verifyDeclaredTotals(markdown,matrix)
if(matrix.totals.groups!==10||matrix.totals.checks!==53)throw new Error('Escopo10/53 alterado sem revisão explícita')
const sizes=[4,6,7,5,5,5,4,7,5,5]
for(const [index,size]of sizes.entries()){
  const group=matrix.groups.find(group=>group.id===index+1)
  if(!group||group.checks.length!==size||Array.from({length:size},(_,i)=>`${index+1}.${i+1}`).some(id=>!group.checks.some(check=>check.id===id)))throw new Error('Identidade dos requisitos alterada no grupo '+(index+1))
}
console.log(JSON.stringify(process.argv.includes('--full')?matrix:{result:'PASS',...matrix.totals,scope:matrix.scope},null,2))

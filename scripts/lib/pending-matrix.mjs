const plain=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function parsePendingMatrix(markdown){
  const groups=[]
  for(const match of markdown.matchAll(/^## Pendência (\d+) — ([^\r\n]+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)){
    const group={id:Number(match[1]),name:match[2],checks:[]}
    if(groups.some(existing=>existing.id===group.id))throw new Error('Grupo duplicado: '+group.id)
    for(const check of match[3].matchAll(/^- (\d+)\.(\d+) ([\s\S]*?)(?=^- \d+\.\d+ |$(?![\s\S]))/gm)){
      if(Number(check[1])!==group.id)throw new Error('Verificação fora do grupo: '+check[1]+'.'+check[2])
      const id=check[1]+'.'+check[2],strong=check[3].match(/\*\*([\s\S]*?)\*\*/)?.[1]
      if(!strong)throw new Error('Estado ausente: '+id)
      const normalized=plain(strong).replace(/\s+/g,' ')
      const state=normalized.startsWith('adiada para v3')?'deferred':normalized.startsWith('concluida')?'complete':normalized.startsWith('em andamento')?'inProgress':normalized.startsWith('pendente')?'pending':null
      if(!state)throw new Error('Estado desconhecido: '+id+' '+strong)
      if(group.checks.some(existing=>existing.id===id))throw new Error('Verificação duplicada: '+id)
      group.checks.push({id,name:check[3].slice(0,check[3].indexOf('**')).replace(/:\s*$/,'').replace(/\s+/g,' ').trim(),state})
    }
    if(!group.checks.length)throw new Error('Grupo sem verificações: '+group.id)
    groups.push(group)
  }
  const checks=groups.flatMap(group=>group.checks)
  const totals={groups:groups.length,checks:checks.length,complete:0,inProgress:0,pending:0,deferred:0}
  for(const check of checks)totals[check.state]++
  return {groups,totals,scope:'Structural inventory only; does not certify implementation or evidence'}
}

export function verifyDeclaredTotals(markdown,matrix){
  const rows=[...markdown.matchAll(/^\| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|\r?$/gm)]
  if(rows.length!==matrix.groups.length)throw new Error('Tabela de grupos incompleta')
  const seen=new Set()
  for(const row of rows){
    if(seen.has(row[1]))throw new Error('Grupo duplicado na tabela: '+row[1])
    seen.add(row[1])
    const group=matrix.groups.find(group=>group.id===Number(row[1]))
    if(!group)throw new Error('Grupo extra na tabela')
    const expected=[group.checks.length,...['complete','inProgress','pending','deferred'].map(state=>group.checks.filter(check=>check.state===state).length)]
    if(expected.some((value,index)=>value!==Number(row[index+2])))throw new Error('Totais divergentes no grupo '+group.id)
  }
  const declared=markdown.match(/^\| \*\*Total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/m)
  const expected=['checks','complete','inProgress','pending','deferred'].map(key=>matrix.totals[key])
  if(!declared||expected.some((value,index)=>value!==Number(declared[index+1])))throw new Error('Total geral divergente')
}

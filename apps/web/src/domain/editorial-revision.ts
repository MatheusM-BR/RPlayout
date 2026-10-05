/** This is the revision shown when editing started, not a fresh API read. */
export function editorialHeaders(revision:number|undefined):Record<string,string>{
  if(!Number.isSafeInteger(revision) || !revision || revision<1)throw new Error('Atualize a grade antes de editar; a revisão desta tela não está disponível.')
  return {'If-Match':`w/"${revision}"`}
}

/** Linhas legíveis da conferência de publicação (B5): título em vez de ID
 * interno e reordenação resumida, sem uma linha "order" por item deslocado. */
const FIELD_LABELS: Record<string, string> = {
  title: 'título', order: 'posição', mediaId: 'arquivo', sourceRef: 'fonte', type: 'tipo', eventType: 'regra',
  anchor: 'horário/âncora', durationOverride: 'duração', minDuration: 'duração mínima', trim: 'corte', audio: 'áudio',
  fit: 'enquadramento', trimmable: 'pode encurtar', optional: 'opcional', protected: 'protegido', onOverrun: 'estouro',
  configuredSourceId: 'entrada', liveMaxDuration: 'duração máxima do ao vivo', liveAutoFollowOnEnd: 'segue no fim do ao vivo',
}
export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field

export interface RevisionDiffInput {
  simulated: { items: Array<{ id: string; title: string }> }
  differences: { added: string[]; removed: string[]; removedTitles?: Record<string, string>; changed: Array<{ itemId: string; fields: string[] }> }
}
export interface RevisionDiffLine { key: string; kind: 'added' | 'removed' | 'changed' | 'moved'; text: string }

export function revisionDiffLines({ simulated, differences }: RevisionDiffInput): { lines: RevisionDiffLine[]; contentChanges: number; moved: number } {
  const title = (id: string) => simulated.items.find(item => item.id === id)?.title
  const lines: RevisionDiffLine[] = []
  for (const id of differences.added) lines.push({ key: `add-${id}`, kind: 'added', text: `+ ${title(id) ?? 'item sem título'}` })
  for (const id of differences.removed) lines.push({ key: `remove-${id}`, kind: 'removed', text: `− Item removido: ${differences.removedTitles?.[id] ?? title(id) ?? 'item sem título no registro'}` })
  let moved = 0, contentChanges = 0
  for (const change of differences.changed) {
    const fields = change.fields.filter(field => field !== 'order')
    if (!fields.length) { moved++; continue }
    contentChanges++
    lines.push({ key: change.itemId, kind: 'changed', text: `${title(change.itemId) ?? 'item sem título'}: ${fields.map(fieldLabel).join(', ')}${fields.length < change.fields.length ? ' (e posição)' : ''}` })
  }
  if (moved) lines.push({ key: 'moved', kind: 'moved', text: `${moved} item(ns) só mudaram de posição na grade.` })
  return { lines, contentChanges, moved }
}

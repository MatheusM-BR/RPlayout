/** A data de hoje não é sinônimo da grade carregada no Master (após a virada
 * pode continuar ontem). Nunca use essa coincidência como identidade. */
export function editorialContext<T extends { rundown: { id: string; date: string; channelId: string } }>(loaded: T, dated: T | null, selectedDate: string, channelId: string): T | null {
  if (loaded.rundown.date===selectedDate && loaded.rundown.channelId===channelId) return loaded
  if (dated?.rundown.date===selectedDate && dated.rundown.channelId===channelId) return dated
  return null
}

/** A seleção só autoriza editar itens presentes na grade efetivamente exibida. */
export function editorialSelection(view: { items: { item: { id: string } }[] } | null, selected: Iterable<string>): string[] {
  if (!view) return []
  const available = new Set(view.items.map(entry => entry.item.id))
  return [...new Set(selected)].filter(id => available.has(id))
}

/** O que a grade exibida diz de um dia sem eventos: sem grade cadastrada
 * (oferece criar/copiar) ou grade já criada e vazia (oferece inserir). */
export function emptyDayState(active: { items: readonly unknown[] } | null): 'NO_GRID' | 'EMPTY_GRID' | 'HAS_ITEMS' {
  if (!active) return 'NO_GRID'
  return active.items.length ? 'HAS_ITEMS' : 'EMPTY_GRID'
}

/** Desfazer/refazer atuam no histórico da grade CARREGADA no Master (o mesmo
 * do Ctrl+Z). Com outra data exibida na PLAYLIST, os botões explicam isso em
 * vez de desfazer uma grade que não está na tela. */
export function undoBlockedReason(isLoadedEditorial: boolean): string | null {
  return isLoadedEditorial ? null : 'Desfazer/refazer valem para a grade carregada no Master; abra a data dela para usar.'
}

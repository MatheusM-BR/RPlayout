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

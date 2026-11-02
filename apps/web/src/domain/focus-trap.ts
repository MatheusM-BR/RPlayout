/** Prende o Tab dentro de um diálogo: do último controle volta ao primeiro e
 * do primeiro, com Shift, vai ao último. Devolve true se tratou a tecla. */
export function trapTab(event: { key: string; shiftKey: boolean; preventDefault: () => void }, container: HTMLElement | null, active: Node | null = typeof document === 'undefined' ? null : document.activeElement): boolean {
  if (event.key !== 'Tab' || !container) return false
  const items = Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
  if (items.length === 0) return false
  const first = items[0]!
  const last = items[items.length - 1]!
  if (event.shiftKey && (active === first || !container.contains(active))) { event.preventDefault(); last.focus(); return true }
  if (!event.shiftKey && (active === last || !container.contains(active))) { event.preventDefault(); first.focus(); return true }
  return false
}

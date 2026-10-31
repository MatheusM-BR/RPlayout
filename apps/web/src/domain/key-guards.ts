// Decide se uma tecla global (Espaço = TAKE) pode agir. Com o foco num controle
// (botão, link, select) a tecla pertence ao controle: Espaço aciona o botão, e
// nunca dispara um TAKE além disso.
export function focusOwnsKey(element: { closest?: (selector: string) => unknown } | null | undefined): boolean {
  if (!element || typeof element.closest !== 'function') return false
  return Boolean(element.closest('button, a, select, [role="button"], [role="menuitem"], [role="tab"]'))
}

// Delete na biblioteca do Master só vale se ninguém mais tratou a tecla, não há
// diálogo aberto, o painel não está travado e o foco não está num controle.
export function masterDeleteAllowed(event: { defaultPrevented: boolean }, element: { closest?: (selector: string) => unknown } | null | undefined, panelLocked: boolean, dialogOpen: boolean): boolean {
  return !event.defaultPrevented && !panelLocked && !dialogOpen && !focusOwnsKey(element)
}

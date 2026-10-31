import { useEffect, useRef } from 'react'

/** Esc fecha o modal aberto (mesma regra do clique fora: quem tem operação em
 * andamento decide no próprio onEscape se pode fechar). */
export function useEscape(active: boolean, onEscape: () => void): void {
  const latest = useRef(onEscape)
  latest.current = onEscape
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) latest.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

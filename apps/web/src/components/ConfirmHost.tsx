import { useEffect, useRef, useState } from 'react'
import { settleConfirm, subscribeConfirm, type ConfirmRequest } from '../domain/confirm.js'

/** Mostra a confirmação da vez. O foco começa no botão seguro (CANCELAR):
 * um Enter distraído não confirma uma ação que afeta o ar. Esc cancela. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([])
  useEffect(() => subscribeConfirm(setQueue), [])
  const current = queue[0]
  const safeRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<Element | null>(null)
  useEffect(() => {
    if (!current) return
    previousFocus.current = document.activeElement
    ;(current.cancelLabel === null ? confirmRef : safeRef).current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); settleConfirm(current.id, false) }
      if (event.key === 'Tab') {
        // Foco preso na caixa: Tab alterna entre os dois botões.
        const buttons = [safeRef.current, confirmRef.current].filter((button): button is HTMLButtonElement => Boolean(button))
        if (buttons.length) { event.preventDefault(); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]!.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus() }
  }, [current])
  if (!current) return null
  const danger = current.tone === 'danger'
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby={`confirm-title-${current.id}`} aria-describedby={`confirm-message-${current.id}`} className={`w-full max-w-md rounded-xl border bg-surface-panel p-5 shadow-2xl ${danger ? 'border-on-air-crimson/70' : 'border-border-strong'}`}>
        <h2 id={`confirm-title-${current.id}`} className={`mb-2 font-headline-md text-[16px] font-bold uppercase tracking-wide ${danger ? 'text-on-air-crimson' : 'text-on-surface'}`}>{current.title}</h2>
        <p id={`confirm-message-${current.id}`} className="whitespace-pre-line text-[14px] leading-relaxed text-on-surface">{current.message}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {current.cancelLabel !== null && <button ref={safeRef} type="button" className="btn" onClick={() => settleConfirm(current.id, false)}>{current.cancelLabel}</button>}
          <button ref={confirmRef} type="button" className={danger ? 'btn !border-on-air-crimson !bg-on-air-crimson/25 !text-white' : 'btn primary'} onClick={() => settleConfirm(current.id, true)}>{current.confirmLabel}</button>
        </div>
        {queue.length > 1 && <p className="mt-2 text-[11px] text-outline">Mais {queue.length - 1} confirmação(ões) na fila.</p>}
      </div>
    </div>
  )
}

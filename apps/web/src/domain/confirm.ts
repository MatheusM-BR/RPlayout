/** Confirmação e aviso dentro da página, no lugar de window.confirm/alert.
 * A caixa nativa congela o JavaScript da tela enquanto está aberta: relógio,
 * contagens e estado do ar param de atualizar no Master. Esta não. */
export interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger': ação que afeta o ar ou apaga algo; o botão fica vermelho. */
  tone?: 'danger' | 'normal'
}
export interface ConfirmRequest extends Required<Omit<ConfirmOptions, 'cancelLabel'>> { id: number; cancelLabel: string | null; resolve: (ok: boolean) => void }

let queue: ConfirmRequest[] = []
let sequence = 0
let hosts = 0
const listeners = new Set<(queue: ConfirmRequest[]) => void>()
const publish = () => { for (const listener of listeners) listener(queue) }

/** Há uma confirmação aberta: atalhos de operação (Espaço = TAKE) não agem. */
export const confirmOpen = () => queue.length > 0

export function subscribeConfirm(listener: (queue: ConfirmRequest[]) => void): () => void {
  listeners.add(listener); hosts += 1; listener(queue)
  return () => { listeners.delete(listener); hosts -= 1 }
}

export function settleConfirm(id: number, ok: boolean): void {
  const request = queue.find(entry => entry.id === id)
  if (!request) return
  queue = queue.filter(entry => entry.id !== id)
  publish()
  request.resolve(ok)
}

const DANGER = /\b(apagar|excluir|remover|descartar|arquivar|reiniciar|cortar|abort|parar|restaurar|reconstruir|acionar|desligar|retomar|encerrar)\b/i

export function confirmAction(input: string | ConfirmOptions): Promise<boolean> {
  const options: ConfirmOptions = typeof input === 'string' ? { message: input } : input
  // Sem a tela montada (testes, janela avulsa) mantém o comportamento antigo.
  if (!hosts) return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(options.message) : false)
  return new Promise(resolve => {
    queue = [...queue, {
      id: ++sequence,
      title: options.title ?? 'Confirmar',
      message: options.message,
      confirmLabel: options.confirmLabel ?? 'CONFIRMAR',
      cancelLabel: options.cancelLabel ?? 'CANCELAR',
      tone: options.tone ?? (DANGER.test(options.message) ? 'danger' : 'normal'),
      resolve,
    }]
    publish()
  })
}

/** Aviso com um botão só (substitui alert). */
export function notify(message: string, title = 'Aviso'): Promise<void> {
  if (!hosts) { if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(message); return Promise.resolve() }
  return new Promise(resolve => {
    queue = [...queue, { id: ++sequence, title, message, confirmLabel: 'OK', cancelLabel: null, tone: 'normal', resolve: () => resolve() }]
    publish()
  })
}

import { useSyncExternalStore } from 'react'
import { can, canShareAcrossChannels, parseRole, type AccessRole, type Action } from '@rplayout/protocol'

/** Papel da sessão, para as telas não oferecerem o que o servidor recusa.
 * Não é segurança: o servidor confere tudo de novo em cada comando. Sem
 * leitura ainda, nada é escondido (evita sumir botão por atraso de rede). */
let current: AccessRole | null = null
const listeners = new Set<() => void>()
export function setSessionAccessRole(value: string | null): void {
  const next = value === null ? null : parseRole(value)
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}
export function useAccessRole(): AccessRole | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current, () => current)
}
export function useCan(action: Action): boolean {
  const role = useAccessRole()
  return role === null || can(role, action)
}
export function useCanShareAcrossChannels(): boolean {
  const role = useAccessRole()
  return role !== null && canShareAcrossChannels(role)
}
/** Texto padrão para botões bloqueados pelo papel. */
export const deniedReason = (what: string): string => `Seu papel não permite ${what}. Peça a um Supervisor, Gestor ou Administrador.`

import { can, roleLabel, type AccessRole, type Action } from './permissions.js'

/** O que a checagem de acesso sabe dizer de uma recusa. */
export interface AccessProbe<R> {
  required(): boolean
  identity(request: R): unknown
  role(request: R): AccessRole
  channelAllowed(request: R, channelId: string): boolean
}

/** Motivo honesto de um 403 (B12): quem nunca teve a permissão não lê "a
 * permissão mudou". Distingue sessão ausente, papel sem a ação, canal fora
 * do acesso e mudança no meio da operação. `what` é o verbo da ação
 * ("editar a grade", "publicar"...). */
export function accessDenial<R>(access: AccessProbe<R>, request: R, action: Action, channelId: string | null, what: string): string {
  if (access.required() && !access.identity(request)) return `Sessão ausente ou expirada: entre novamente para ${what}. Nada foi alterado.`
  const role = access.role(request)
  if (!can(role, action)) return `Seu papel (${roleLabel(role)}) não permite ${what}. Nada foi alterado.`
  if (channelId !== null && !access.channelAllowed(request, channelId)) return `Sua conta não tem acesso a este canal; não é possível ${what}. Nada foi alterado.`
  return `A sessão ou a permissão mudou durante a operação; entre novamente para ${what}. Nada foi alterado.`
}

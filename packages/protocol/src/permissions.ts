/** Papéis operacionais do playout. Fonte única: o servidor autoriza com
 * esta tabela e as telas usam a mesma para não oferecer o que será recusado. */
export type Role = 'OPERATOR' | 'PROGRAMMER' | 'SUPERVISOR' | 'GESTOR' | 'ADMIN'
/** Pirâmide de papéis, do menor para o maior. */
export const ROLE_ORDER: readonly Role[] = ['OPERATOR', 'PROGRAMMER', 'SUPERVISOR', 'GESTOR', 'ADMIN']
/** Denied is a diagnostic result, never a role assignable to an account. */
export type AccessRole = Role | 'DENIED'

export type Action =
  | 'TRANSPORT'
  | 'PLAYLIST_EDIT'
  | 'PLAYLIST_PUBLISH'
  | 'OUTPUT_CONTROL'
  | 'CHANNEL_STOP'
  | 'USER_MANAGE'
  | 'USER_MANAGE_LOWER'
  | 'REPORT_EXPORT'

const grants: Record<Role, readonly Action[]> = {
  OPERATOR: ['TRANSPORT', 'PLAYLIST_EDIT', 'REPORT_EXPORT'],
  PROGRAMMER: ['TRANSPORT', 'PLAYLIST_EDIT', 'PLAYLIST_PUBLISH', 'REPORT_EXPORT'],
  SUPERVISOR: ['TRANSPORT', 'PLAYLIST_EDIT', 'PLAYLIST_PUBLISH', 'OUTPUT_CONTROL', 'CHANNEL_STOP', 'REPORT_EXPORT'],
  // GESTOR = tudo do SUPERVISOR + gestão de contas de papéis abaixo dele (USER_MANAGE_LOWER).
  // USER_MANAGE (contas de qualquer papel, auditoria, configuração de sistema) segue só ADMIN.
  GESTOR: ['TRANSPORT', 'PLAYLIST_EDIT', 'PLAYLIST_PUBLISH', 'OUTPUT_CONTROL', 'CHANNEL_STOP', 'USER_MANAGE_LOWER', 'REPORT_EXPORT'],
  ADMIN: ['TRANSPORT', 'PLAYLIST_EDIT', 'PLAYLIST_PUBLISH', 'OUTPUT_CONTROL', 'CHANNEL_STOP', 'USER_MANAGE', 'USER_MANAGE_LOWER', 'REPORT_EXPORT'],
}

export function can(role: AccessRole, action: Action): boolean {
  return Object.hasOwn(grants, role) && grants[role as Role].includes(action)
}

export function parseRole(value: unknown): AccessRole {
  if (value === 'OPERATOR' || value === 'PROGRAMMER' || value === 'SUPERVISOR' || value === 'GESTOR' || value === 'ADMIN') return value
  return 'DENIED'
}

export function roleLabel(role: AccessRole): string {
  return {
    OPERATOR: 'Operador',
    PROGRAMMER: 'Programador',
    SUPERVISOR: 'Supervisor',
    GESTOR: 'Gestor',
    ADMIN: 'Administrador',
    DENIED: 'Acesso não autorizado',
  }[role]
}

/** Copiar ou espelhar programação entre canais: Supervisor, Gestor e Administrador,
 * e só com acesso aos dois canais (o servidor confere o escopo). */
export const canShareAcrossChannels = (role: AccessRole): boolean => role === 'SUPERVISOR' || role === 'GESTOR' || role === 'ADMIN'

/** Papéis que `actor` pode criar, editar, rebaixar/promover para, desativar ou ter sessões
 * revogadas: ADMIN gerencia todos; GESTOR só os estritamente abaixo de GESTOR. */
export function canManageRole(actor: AccessRole, target: AccessRole): boolean {
  if (actor === 'ADMIN') return true // inclui reparar conta com papel salvo inválido
  if (actor === 'DENIED' || target === 'DENIED') return false
  return can(actor, 'USER_MANAGE_LOWER') && ROLE_ORDER.indexOf(target) < ROLE_ORDER.indexOf(actor)
}

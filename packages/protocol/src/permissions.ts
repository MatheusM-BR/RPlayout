/** Papéis operacionais do playout. Fonte única: o servidor autoriza com
 * esta tabela e as telas usam a mesma para não oferecer o que será recusado. */
export type Role = 'OPERATOR' | 'PROGRAMMER' | 'SUPERVISOR' | 'ADMIN'
/** Denied is a diagnostic result, never a role assignable to an account. */
export type AccessRole = Role | 'DENIED'

export type Action =
  | 'TRANSPORT'
  | 'PLAYLIST_EDIT'
  | 'PLAYLIST_PUBLISH'
  | 'OUTPUT_CONTROL'
  | 'CHANNEL_STOP'
  | 'USER_MANAGE'
  | 'REPORT_EXPORT'

const grants: Record<Role, readonly Action[]> = {
  OPERATOR: ['TRANSPORT', 'PLAYLIST_EDIT', 'REPORT_EXPORT'],
  PROGRAMMER: ['TRANSPORT', 'PLAYLIST_EDIT', 'PLAYLIST_PUBLISH', 'REPORT_EXPORT'],
  SUPERVISOR: ['TRANSPORT', 'PLAYLIST_EDIT', 'PLAYLIST_PUBLISH', 'OUTPUT_CONTROL', 'CHANNEL_STOP', 'REPORT_EXPORT'],
  ADMIN: ['TRANSPORT', 'PLAYLIST_EDIT', 'PLAYLIST_PUBLISH', 'OUTPUT_CONTROL', 'CHANNEL_STOP', 'USER_MANAGE', 'REPORT_EXPORT'],
}

export function can(role: AccessRole, action: Action): boolean {
  return Object.hasOwn(grants, role) && grants[role as Role].includes(action)
}

export function parseRole(value: unknown): AccessRole {
  if (value === 'OPERATOR' || value === 'PROGRAMMER' || value === 'SUPERVISOR' || value === 'ADMIN') return value
  return 'DENIED'
}

export function roleLabel(role: AccessRole): string {
  return {
    OPERATOR: 'Operador',
    PROGRAMMER: 'Programador',
    SUPERVISOR: 'Supervisor',
    ADMIN: 'Administrador',
    DENIED: 'Acesso não autorizado',
  }[role]
}

/** Copiar ou espelhar programação entre canais: Supervisor e Administrador,
 * e só com acesso aos dois canais (o servidor confere o escopo). */
export const canShareAcrossChannels = (role: AccessRole): boolean => role === 'SUPERVISOR' || role === 'ADMIN'

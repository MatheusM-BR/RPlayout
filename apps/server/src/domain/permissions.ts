/** Papéis operacionais do playout. */
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

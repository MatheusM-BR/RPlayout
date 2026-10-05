/** Papéis operacionais do playout. */
export type Role = 'OPERATOR' | 'PROGRAMMER' | 'SUPERVISOR' | 'ADMIN'

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

export function can(role: Role, action: Action): boolean {
  return grants[role].includes(action)
}

export function parseRole(value: unknown): Role {
  if (value === 'PROGRAMMER' || value === 'SUPERVISOR' || value === 'ADMIN') return value
  return 'OPERATOR'
}

export function roleLabel(role: Role): string {
  return {
    OPERATOR: 'Operador',
    PROGRAMMER: 'Programador',
    SUPERVISOR: 'Supervisor',
    ADMIN: 'Administrador',
  }[role]
}

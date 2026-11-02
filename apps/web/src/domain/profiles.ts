import type { WorkspaceId } from '../components/WorkspaceShell.js'

/** Perfis de navegação (U9). Filtram só o menu desta estação: não são
 * permissão. Quem pode o quê continua decidido pelo servidor (papel da sessão). */
export type ProfileId = 'OPERACAO' | 'ACERVO' | 'ENGENHARIA' | 'REGISTRO' | 'COMPLETO'

export const PROFILES: ReadonlyArray<{ id: ProfileId; label: string; description: string; workspaces: readonly WorkspaceId[] }> = [
  { id: 'OPERACAO', label: 'Operação', description: 'Master e Playlist', workspaces: ['master', 'playlist', 'docs'] },
  { id: 'ACERVO', label: 'Acervo', description: 'QC e Playlist', workspaces: ['qc', 'playlist', 'docs'] },
  { id: 'ENGENHARIA', label: 'Engenharia', description: 'Monitor, saídas, HA e configurações', workspaces: ['master', 'monitor', 'aired', 'docs', 'settings'] },
  { id: 'REGISTRO', label: 'Registro', description: 'Aired (veiculação)', workspaces: ['aired', 'docs'] },
  { id: 'COMPLETO', label: 'Completo', description: 'Todas as telas', workspaces: ['master', 'playlist', 'qc', 'monitor', 'aired', 'docs', 'settings'] },
]
export const PROFILE_IDS: readonly ProfileId[] = PROFILES.map(profile => profile.id)

/** Sem escolha salva: operador começa em Operação; supervisor/admin, Completo. */
export function defaultProfileFor(sessionLabel: string | null | undefined): ProfileId {
  return /^operador$/i.test((sessionLabel ?? '').trim()) ? 'OPERACAO' : 'COMPLETO'
}

/** Abas do menu: as do perfil, mais a tela aberta se ela estiver fora dele
 * (um link direto não some do menu enquanto está aberto). */
export function navWorkspaces(profile: ProfileId, active: WorkspaceId): WorkspaceId[] {
  const list = [...(PROFILES.find(entry => entry.id === profile) ?? PROFILES[PROFILES.length - 1]!).workspaces].filter(id => id !== 'settings')
  if (active !== 'settings' && !list.includes(active)) list.push(active)
  return list
}

export function profileShowsSettings(profile: ProfileId): boolean {
  return (PROFILES.find(entry => entry.id === profile)?.workspaces ?? []).includes('settings')
}

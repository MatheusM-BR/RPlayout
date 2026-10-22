import type { ReactNode } from 'react'

export type WorkspaceId = 'master' | 'playlist' | 'users' | 'monitor' | 'aired' | 'audit' | 'qc' | 'docs' | 'settings'

const items: Array<{ id: WorkspaceId; label: string; description: string }> = [
  { id: 'master', label: 'MASTER', description: 'operação no ar' },
  { id: 'playlist', label: 'PLAYLISTS', description: 'programação 24h' },
  { id: 'qc', label: 'QC', description: 'qualidade do acervo' },
  { id: 'monitor', label: 'MONITORAMENTO', description: 'saídas e processos' },
  { id: 'aired', label: 'AIRED', description: 'veiculação' },
  { id: 'audit', label: 'AUDITORIA', description: 'ações do sistema' },
  { id: 'users', label: 'USUÁRIOS', description: 'acesso e papéis' },
  { id: 'docs', label: 'AJUDA', description: 'manual operacional' },
  { id: 'settings', label: 'CONFIGURAÇÕES', description: 'sistema e canais' },
]

interface Props {
  active: WorkspaceId
  channelName: string
  role: string
  authRequired: boolean
  title: string
  description: string
  onNavigate?: (id: WorkspaceId) => void
  children: ReactNode
}

const hrefOf = (id: WorkspaceId): string => id === 'master' ? window.location.pathname : `${window.location.pathname}?workspace=${id}`

/** Navegação comum das aplicações operacionais que compartilham o servidor 24/7. */
export function WorkspaceShell({ active, channelName, role, authRequired, title, description, onNavigate, children }: Props) {
  const handleClick = (e: React.MouseEvent, id: WorkspaceId) => {
    if (onNavigate && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault()
      onNavigate(id)
    }
  }

  return <div className="workspace-shell">
    <header className="workspace-topbar">
      <a className="brand workspace-brand" href={hrefOf('master')} onClick={(e) => handleClick(e, 'master')}>RPlayout<span>.</span></a>
      <div className="workspace-context"><strong>{title}</strong><span>{description}</span></div>
      <div className="spacer" />
      <span className="workspace-channel">{channelName}</span>
      <span className={`auth-state${authRequired ? ' protected' : ' local'}`}>{authRequired ? role : 'ACESSO LOCAL'}</span>
      <a className="btn small" href={hrefOf(active)} target="_blank" rel="noreferrer" title="Abrir este workspace em outra janela">↗ NOVA JANELA</a>
    </header>
    <nav className="workspace-nav" aria-label="Áreas de trabalho do RPlayout">
      {items.map((item) => <a key={item.id} href={hrefOf(item.id)} onClick={(e) => handleClick(e, item.id)} aria-current={active === item.id ? 'page' : undefined} title={item.description}>
        <span>{item.label}</span><small>{item.description}</small>
      </a>)}
    </nav>
    <main className="workspace-content">{children}</main>
  </div>
}

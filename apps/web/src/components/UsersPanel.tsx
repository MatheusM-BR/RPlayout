import { useEffect, useState } from 'react'
import { api } from '../api.js'

const ROLE_LABEL: Record<string, string> = { OPERATOR: 'Operador', PROGRAMMER: 'Programador', SUPERVISOR: 'Supervisor', ADMIN: 'Administrador' }
const ROLE_HELP: Record<string, string> = {
  OPERATOR: 'Opera o canal e executa TAKE.',
  PROGRAMMER: 'Monta e publica playlists.',
  SUPERVISOR: 'Opera, programa e revisa relatórios.',
  ADMIN: 'Acesso completo, inclusive usuários e configuração.',
}

export function UsersPanel({ onMessage }: { onMessage: (text: string) => void }) {
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.users>>['users']>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('OPERATOR')
  const reload = () => void api.users().then((response) => setUsers(response.users)).catch(() => setUsers([]))
  useEffect(reload, [])
  const add = () => void api.addUser({ username, password, role }).then(() => { setUsername(''); setPassword(''); reload(); onMessage('Usuário criado.') }).catch((error: Error) => onMessage(error.message))
  return <div className="users-layout"><section className="field"><label>Contas cadastradas</label>
    <ul className="canais user-list">{users.map((user) => <li key={user.id}><div className="quem"><div className="nome">{user.username} <span className={`pill ${user.enabled ? 'ok' : 'bad'}`}>{user.enabled ? 'ATIVO' : 'DESATIVADO'}</span></div><div className="detalhe">Criado em {new Date(user.createdAt).toLocaleString('pt-BR')}</div></div><select aria-label={`Papel de ${user.username}`} value={user.role} onChange={(event) => void api.patchUser(user.id, { role: event.target.value }).then(() => { reload(); onMessage(`Papel de ${user.username} atualizado.`) }).catch((error: Error) => onMessage(error.message))}>{Object.keys(ROLE_LABEL).map((value) => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}</select><button className="btn small" onClick={() => void api.patchUser(user.id, { enabled: !user.enabled }).then(() => { reload(); onMessage(`Usuário ${user.enabled ? 'desativado' : 'ativado'}.`) }).catch((error: Error) => onMessage(error.message))}>{user.enabled ? 'DESATIVAR' : 'ATIVAR'}</button></li>)}</ul>
    {users.length === 0 && <div className="note">Nenhuma conta cadastrada. Crie o primeiro administrador abaixo.</div>}
  </section>
    <aside className="user-create"><h2>Novo usuário</h2><label>Nome de acesso<input autoComplete="off" placeholder="ex.: operador-master" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Senha temporária<input type="password" autoComplete="new-password" placeholder="mínimo de 8 caracteres" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Papel<select value={role} onChange={(event) => setRole(event.target.value)}>{Object.keys(ROLE_LABEL).map((value) => <option key={value} value={value}>{ROLE_LABEL[value]}</option>)}</select></label><p>{ROLE_HELP[role]}</p><button className="btn take" disabled={!username.trim() || password.length < 8} onClick={add}>CRIAR USUÁRIO</button></aside>
    <section className="role-matrix"><h2>Papéis</h2>{Object.entries(ROLE_LABEL).map(([value, label]) => <div key={value}><strong>{label}</strong><span>{ROLE_HELP[value]}</span></div>)}</section>
  </div>
}

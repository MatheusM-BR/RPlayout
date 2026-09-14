import { useEffect, useState } from 'react'
import { api } from '../api.js'

export function UsersPanel({ onMessage }: { onMessage: (text: string) => void }) {
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.users>>['users']>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('OPERATOR')
  const reload = () => void api.users().then((response) => setUsers(response.users)).catch(() => setUsers([]))
  useEffect(reload, [])
  const add = () => void api.addUser({ username, password, role }).then(() => { setUsername(''); setPassword(''); reload(); onMessage('Usuário criado.') }).catch((error: Error) => onMessage(error.message))
  return <div className="field"><label>Usuários e permissões</label>
    <ul className="canais">{users.map((user) => <li key={user.id}><div className="quem"><div className="nome">{user.username}</div><div className="detalhe mono">{user.role} · {user.enabled ? 'ativo' : 'desativado'}</div></div><button className="btn small" onClick={() => void api.patchUser(user.id, { enabled: !user.enabled }).then(reload)}> {user.enabled ? 'desativar' : 'ativar'} </button></li>)}</ul>
    <div className="pastas-add"><input placeholder="novo usuário" value={username} onChange={(event) => setUsername(event.target.value)} /><input type="password" placeholder="senha (8+ caracteres)" value={password} onChange={(event) => setPassword(event.target.value)} /><select value={role} onChange={(event) => setRole(event.target.value)}><option>OPERATOR</option><option>PROGRAMMER</option><option>SUPERVISOR</option><option>ADMIN</option></select><button className="btn small" disabled={!username || password.length < 8} onClick={add}>CRIAR</button></div>
  </div>
}

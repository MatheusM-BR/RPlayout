import { useRef, useState, type FormEvent } from 'react'

interface Props { onLogin: (username: string, password: string) => Promise<void>; error: string | null }

export function Login({ onLogin, error }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if(inFlight.current)return
    inFlight.current=true;setBusy(true)
    try { await onLogin(username, password) } finally { inFlight.current=false;setBusy(false) }
  }
  return <main className="login-screen"><form className="login-card" onSubmit={submit}>
    <h1>RPlayout.</h1><p>Entre para operar o playout.</p>
    <label>usuário<input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label>senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error && <div className="note warn">{error}</div>}
    <button className="btn take" disabled={busy || !username || !password}>{busy ? 'entrando…' : 'entrar'}</button>
  </form></main>
}

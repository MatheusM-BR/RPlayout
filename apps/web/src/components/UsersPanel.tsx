import { useEffect, useState } from 'react'
import { api } from '../api.js'

const ROLE_LABEL: Record<string, string> = {
  OPERATOR: 'Operador',
  PROGRAMMER: 'Programador',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Administrador',
}

const ROLE_HELP: Record<string, string> = {
  OPERATOR: 'Opera o canal e executa TAKE / CUT.',
  PROGRAMMER: 'Monta e publica playlists 24h.',
  SUPERVISOR: 'Opera, programa e revisa relatórios gerenciais.',
  ADMIN: 'Acesso completo, inclusive usuários e configurações críticas.',
}

export function UsersPanel({ onMessage }: { onMessage: (text: string) => void }) {
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.users>>['users']>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('OPERATOR')

  const reload = () => {
    void api
      .users()
      .then((response) => setUsers(response.users))
      .catch(() => setUsers([]))
  }

  useEffect(reload, [])

  const add = () => {
    void api
      .addUser({ username, password, role })
      .then(() => {
        setUsername('')
        setPassword('')
        reload()
        onMessage('Usuário criado com sucesso.')
      })
      .catch((error: Error) => onMessage(error.message))
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-gutter p-space-md bg-surface-base text-on-surface">
      {/* Contas Cadastradas */}
      <section className="xl:col-span-8 bg-surface-card p-space-md rounded border border-border-subtle flex flex-col gap-space-sm shadow-md">
        <div className="flex items-center justify-between pb-space-xs border-b border-border-subtle">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-[20px]">manage_accounts</span>
            <h2 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
              Contas de Usuários Cadastrados
            </h2>
          </div>
          <span className="font-label-mono text-label-mono bg-surface-panel px-2 py-0.5 rounded text-outline">
            {users.length} USUÁRIOS
          </span>
        </div>

        <div className="w-full overflow-x-auto rounded border border-border-subtle bg-surface-container-lowest scrollbar-thin">
          <table className="w-full text-left font-body-sm text-body-sm">
            <thead>
              <tr className="bg-surface-panel text-outline font-label-caps text-label-caps uppercase border-b border-border-subtle">
                <th className="py-2.5 px-space-md">USUÁRIO</th>
                <th className="py-2.5 px-space-md">STATUS</th>
                <th className="py-2.5 px-space-md">PAPEL NO SISTEMA</th>
                <th className="py-2.5 px-space-md">CRIADO EM</th>
                <th className="py-2.5 px-space-md text-right">AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border-subtle/30 hover:bg-surface-panel/40 transition-colors"
                >
                  <td className="py-2.5 px-space-md font-semibold text-on-surface">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-[11px]">
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                      {user.username}
                    </div>
                  </td>
                  <td className="py-2.5 px-space-md">
                    <span
                      className={`inline-flex items-center gap-1 font-label-caps text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        user.enabled
                          ? 'bg-status-ok/20 text-status-ok-bright border border-status-ok/40'
                          : 'bg-surface-panel text-outline border border-border-subtle'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${user.enabled ? 'bg-status-ok' : 'bg-outline'}`}></span>
                      {user.enabled ? 'ATIVO' : 'INATIVO'}
                    </span>
                  </td>
                  <td className="py-2.5 px-space-md">
                    <select
                      aria-label={`Papel de ${user.username}`}
                      value={user.role}
                      onChange={(event) =>
                        void api
                          .patchUser(user.id, { role: event.target.value })
                          .then(() => {
                            reload()
                            onMessage(`Papel de ${user.username} atualizado.`)
                          })
                          .catch((error: Error) => onMessage(error.message))
                      }
                      className="bg-surface-panel text-on-surface px-2 py-1 rounded border border-border-subtle font-label-caps text-[11px] font-semibold outline-none focus:border-primary cursor-pointer"
                    >
                      {Object.keys(ROLE_LABEL).map((value) => (
                        <option key={value} value={value} className="bg-surface-card text-on-surface">
                          {ROLE_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 px-space-md font-label-mono text-label-mono text-outline">
                    {new Date(user.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td className="py-2.5 px-space-md text-right">
                    <button
                      onClick={() =>
                        void api
                          .patchUser(user.id, { enabled: !user.enabled })
                          .then(() => {
                            reload()
                            onMessage(`Usuário ${user.enabled ? 'desativado' : 'ativado'}.`)
                          })
                          .catch((error: Error) => onMessage(error.message))
                      }
                      className={`px-space-md py-1 rounded font-label-caps text-[10px] font-bold transition-colors border ${
                        user.enabled
                          ? 'bg-surface-panel hover:bg-on-air-crimson/20 text-on-air-crimson border-border-subtle'
                          : 'bg-status-ok/20 hover:bg-status-ok/30 text-status-ok-bright border-status-ok/40'
                      }`}
                    >
                      {user.enabled ? 'DESATIVAR' : 'ATIVAR'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {users.length === 0 && (
          <div className="p-space-md bg-surface-container-lowest rounded border border-border-subtle text-outline text-center font-body-sm text-body-sm">
            Nenhuma conta cadastrada. Crie a primeira conta de administrador no painel ao lado.
          </div>
        )}
      </section>

      {/* Novo Usuário & Matriz de Papéis */}
      <div className="xl:col-span-4 flex flex-col gap-gutter">
        {/* Formulário de Criação */}
        <aside className="bg-surface-card p-space-md rounded border border-border-subtle flex flex-col gap-space-sm shadow-md">
          <div className="flex items-center gap-space-xs pb-space-xs border-b border-border-subtle">
            <span className="material-symbols-outlined text-accent-ice text-[20px]">person_add</span>
            <h3 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
              Novo Usuário
            </h3>
          </div>

          <div className="flex flex-col gap-space-sm">
            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-outline uppercase">Nome de Acesso</label>
              <input
                autoComplete="off"
                placeholder="ex.: operador-master"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm outline-none focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-outline uppercase">Senha Provisória</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo de 8 caracteres"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm outline-none focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-caps text-label-caps text-outline uppercase">Papel Operacional</label>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className="bg-surface-container-lowest text-on-surface p-2 rounded border border-border-subtle font-body-sm text-body-sm outline-none focus:border-primary cursor-pointer"
              >
                {Object.keys(ROLE_LABEL).map((value) => (
                  <option key={value} value={value} className="bg-surface-card text-on-surface">
                    {ROLE_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>

            <p className="font-body-sm text-[11px] text-outline bg-surface-panel p-space-sm rounded border border-border-subtle">
              {ROLE_HELP[role]}
            </p>

            <button
              disabled={!username.trim() || password.length < 8}
              onClick={add}
              className="w-full py-2 px-space-md rounded bg-primary-container text-on-primary-container hover:brightness-110 font-label-caps text-label-caps uppercase font-bold transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              Criar Usuário
            </button>
          </div>
        </aside>

        {/* Matriz de Permissões */}
        <section className="bg-surface-card p-space-md rounded border border-border-subtle flex flex-col gap-space-xs shadow-md">
          <h3 className="font-label-caps text-label-caps text-outline uppercase font-bold border-b border-border-subtle pb-1">
            Matriz de Papéis e Permissões
          </h3>
          <div className="flex flex-col gap-space-xs pt-1">
            {Object.entries(ROLE_LABEL).map(([value, label]) => (
              <div key={value} className="p-space-xs bg-surface-panel rounded border border-border-subtle">
                <strong className="font-label-caps text-[11px] text-primary block">{label}</strong>
                <span className="font-body-sm text-[11px] text-outline">{ROLE_HELP[value]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

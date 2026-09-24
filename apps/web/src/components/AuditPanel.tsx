import { useEffect, useMemo, useState } from 'react'

interface Props {
  onClose: () => void
  isModal?: boolean
}

export function AuditPanel({ onClose, isModal = true }: Props) {
  const [entries, setEntries] = useState<
    Array<{
      id: string
      actorUsername: string | null
      kind: string
      itemId: string | null
      createdAt: string
      payload: Record<string, unknown>
    }>
  >([])
  const [user, setUser] = useState('')
  const [action, setAction] = useState('')
  const [date, setDate] = useState('')

  useEffect(() => {
    void fetch('/api/audit?limit=1000')
      .then((response) => response.json())
      .then((body: { entries?: typeof entries }) => setEntries(body.entries ?? []))
      .catch(() => setEntries([]))
  }, [])

  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (!user || (entry.actorUsername ?? '').toLowerCase().includes(user.toLowerCase())) &&
          (!action || entry.kind === action) &&
          (!date || entry.createdAt.slice(0, 10) === date),
      ),
    [entries, user, action, date],
  )

  const csv =
    'usuário;ação;item;data\n' +
    filtered
      .map((entry) => [entry.actorUsername ?? 'sessão local', entry.kind, entry.itemId ?? '', entry.createdAt].join(';'))
      .join('\n')

  const content = (
    <div
      className={`bg-surface-card w-full border border-border-subtle rounded-xl shadow-2xl flex flex-col overflow-hidden ${
        isModal ? 'max-w-5xl max-h-[95vh]' : 'h-full max-h-full'
      }`}
      onClick={(event) => event.stopPropagation()}
    >
        {/* Header */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-b border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-primary text-[22px]">verified_user</span>
            <div>
              <h2 className="font-headline-md text-headline-md uppercase text-on-surface font-bold tracking-wide">
                Trilha de Auditoria &amp; Conformidade
              </h2>
              <p className="font-label-mono text-label-mono text-outline">
                Registro criptográfico e sequencial de todas as ações de comando executadas no playout
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Filters Bar */}
        <div className="p-space-md bg-surface-container-lowest border-b border-border-subtle flex flex-wrap items-center gap-space-sm">
          <div className="flex-1 min-w-[200px] relative">
            <span className="material-symbols-outlined absolute left-2.5 top-2.5 text-outline text-[16px]">search</span>
            <input
              type="text"
              placeholder="Filtrar por operador..."
              value={user}
              onChange={(event) => setUser(event.target.value)}
              className="w-full bg-surface-card text-on-surface pl-8 pr-3 py-1.5 rounded border border-border-subtle font-body-sm text-body-sm outline-none focus:border-primary"
            />
          </div>

          <div className="min-w-[180px]">
            <select
              value={action}
              onChange={(event) => setAction(event.target.value)}
              className="w-full bg-surface-card text-on-surface px-3 py-1.5 rounded border border-border-subtle font-body-sm text-body-sm outline-none focus:border-primary cursor-pointer"
            >
              <option value="">Todas as ações</option>
              {[...new Set(entries.map((entry) => entry.kind))].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[150px]">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full bg-surface-card text-on-surface px-3 py-1.5 rounded border border-border-subtle font-label-mono text-label-mono outline-none focus:border-primary"
            />
          </div>

          <span className="font-label-mono text-label-mono text-outline ml-auto">
            {filtered.length} {filtered.length === 1 ? 'REGISTRO' : 'REGISTROS'}
          </span>
        </div>

        {/* Table View */}
        <div className="flex-1 overflow-x-auto overflow-y-auto max-h-[550px] p-space-sm bg-surface-container-lowest scrollbar-thin">
          <table className="w-full text-left font-body-sm text-body-sm border border-border-subtle rounded overflow-hidden">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-panel text-outline font-label-caps text-label-caps uppercase border-b border-border-subtle">
                <th className="py-2.5 px-space-sm w-44">DATA / HORA</th>
                <th className="py-2.5 px-space-sm w-36">USUÁRIO</th>
                <th className="py-2.5 px-space-sm w-36">AÇÃO</th>
                <th className="py-2.5 px-space-sm w-36">ITEM ID</th>
                <th className="py-2.5 px-space-sm">PARÂMETROS / DETALHES</th>
              </tr>
            </thead>
            <tbody className="font-label-mono text-label-mono">
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-b border-border-subtle/30 hover:bg-surface-panel/40 transition-colors"
                >
                  <td className="py-2 px-space-sm text-outline tabular-nums">
                    {entry.createdAt.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="py-2 px-space-sm text-on-surface font-semibold">
                    {entry.actorUsername ?? 'Sessão Local'}
                  </td>
                  <td className="py-2 px-space-sm">
                    <span className="inline-block px-1.5 py-0.5 rounded bg-surface-card text-accent-ice font-bold border border-border-subtle">
                      {entry.kind}
                    </span>
                  </td>
                  <td className="py-2 px-space-sm text-outline truncate max-w-[120px]" title={entry.itemId ?? '—'}>
                    {entry.itemId ?? '—'}
                  </td>
                  <td className="py-2 px-space-sm text-[11px] text-on-surface-variant truncate max-w-md font-mono" title={JSON.stringify(entry.payload)}>
                    {JSON.stringify(entry.payload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="p-space-lg text-center text-outline font-body-sm text-body-sm">
              Nenhum evento registrado com os filtros selecionados.
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-space-lg py-space-sm bg-surface-panel border-t border-border-subtle flex items-center justify-between">
          <span className="font-label-mono text-label-mono text-outline">
            PADRÃO DE AUDITORIA INTERNA • REGISTROS IMUTÁVEIS
          </span>

          <div className="flex items-center gap-space-sm">
            <button
              onClick={onClose}
              className="px-space-lg py-2 rounded bg-surface-card hover:bg-surface-container text-on-surface font-label-caps text-label-caps uppercase transition-colors border border-border-subtle"
            >
              Fechar
            </button>
            <a
              download="rplayout-auditoria.csv"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
              className="px-space-lg py-2 rounded bg-accent-ice text-surface-base hover:brightness-110 font-label-caps text-label-caps uppercase font-bold transition-all shadow-sm flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              Exportar CSV
            </a>
          </div>
        </div>
      </div>
  )

  if (!isModal) {
    return content
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      {content}
    </div>
  )
}

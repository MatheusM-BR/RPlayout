import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import type { ServerFolderBrowser } from '../types.js'

export function ServerFileTargetDialog({ onClose, onChoose }: { onClose: () => void; onChoose: (path: string) => void }) {
  const [browser, setBrowser] = useState<ServerFolderBrowser | null>(null)
  const [path, setPath] = useState('')
  const [filename, setFilename] = useState(() => `Gravação-${new Date().toISOString().replace(/[:.]/g, '-')}.mkv`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const navigate = async (requested?: string) => {
    const id = ++requestId.current
    setBusy(true); setError(null)
    try {
      const result = await api.browseMediaRoot(requested)
      if (id !== requestId.current) return
      setBrowser(result); setPath(result.path)
    } catch (failure) {
      if (id === requestId.current) setError(failure instanceof Error ? failure.message : 'Não consegui abrir a pasta.')
    } finally { if (id === requestId.current) setBusy(false) }
  }
  useEffect(() => { void navigate(); return () => { requestId.current++ } }, [])
  const choose = async () => {
    setBusy(true); setError(null)
    try {
      const result = await api.recordingTarget(path, filename)
      onChoose(result.path)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não consegui validar o destino.')
    } finally { setBusy(false) }
  }
  const inputClass = 'w-full bg-surface-base border border-border-subtle rounded-lg px-3 py-2 text-sm text-on-surface'
  return (
    <div className="fixed inset-0 z-[110] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="recording-target-title">
      <section className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border-subtle bg-surface-panel p-5 text-on-surface space-y-4">
        <h2 id="recording-target-title" className="text-lg font-bold">Destino da gravação no servidor</h2>
        <p className="text-sm text-outline">Escolha a pasta e, abaixo, o nome do novo arquivo. Esta janela funciona na página remota; nada será gravado até ativar a saída.</p>
        <label className="block text-sm">Pasta no servidor
          <div className="flex gap-2 mt-1">
            <button type="button" className="btn small" disabled={busy || !browser?.parent} aria-label="Pasta acima" onClick={() => void navigate(browser?.parent ?? undefined)}>↑</button>
            <input className={inputClass} aria-label="Pasta de gravação no servidor" value={path} disabled={busy} onChange={event => setPath(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void navigate(path) }} />
            <button type="button" className="btn small" disabled={busy || !path.trim()} onClick={() => void navigate(path)}>ABRIR</button>
          </div>
        </label>
        <div className="h-44 overflow-y-auto rounded-lg border border-border-subtle bg-surface-base p-2" aria-label="Pastas para gravação">
          {busy && <p className="text-sm" role="status">Consultando o servidor…</p>}
          {!busy && browser?.directories.length === 0 && <p className="text-sm text-outline">Esta pasta não tem subpastas.</p>}
          {browser?.directories.map(folder => <button key={folder.path} type="button" disabled={busy} className="block w-full text-left px-3 py-2 rounded hover:bg-surface-panel text-sm break-all" onClick={() => void navigate(folder.path)}>📁 {folder.name}</button>)}
        </div>
        <label className="block text-sm">Nome do arquivo (.mkv)
          <input className={`${inputClass} mt-1`} aria-label="Nome da gravação" value={filename} disabled={busy} onChange={event => setFilename(event.target.value)} />
        </label>
        <p className="text-xs text-outline">Formato atual: Matroska (.mkv). Arquivos existentes não são aceitos nesta escolha.</p>
        <div className="text-xs break-all" aria-label="Destino escolhido">{path}{path.endsWith('\\') || path.endsWith('/') ? '' : path.includes('\\') ? '\\' : '/'}{filename}</div>
        {error && <p className="text-sm text-error" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn small" disabled={busy} onClick={onClose}>CANCELAR</button>
          <button type="button" className="btn primary small" disabled={busy || !browser || !path.trim() || !filename.trim()} onClick={() => void choose()}>USAR DESTINO</button>
        </div>
      </section>
    </div>
  )
}

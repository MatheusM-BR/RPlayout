import { useMemo, useState } from 'react'
import { durationIn, type Rate } from '@rplayout/protocol'
import type { LibraryFolder, ScanStatus } from '../types.js'
import { dur, lufs } from '../format.js'

interface Props {
  folders: LibraryFolder[]
  rate: Rate
  /** Arquivo aberto no preview agora, se for do explorador. */
  openAssetId: string | null
  onPreview: (assetId: string) => void
  onInsert: (assetId: string) => void
  /** Situação da varredura do acervo. Nulo esconde o botão. */
  scan: ScanStatus | null
  onScan: () => void
}

/**
 * Explorador de arquivos. A árvore é a das pastas em disco, e clicar num
 * arquivo abre ele no preview — conferir um VT não obriga ninguém a colocá-lo
 * na grade primeiro.
 */
export function Explorer({
  folders,
  rate,
  openAssetId,
  onPreview,
  onInsert,
  scan,
  onScan,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return folders
    return folders
      .map((folder) => ({
        ...folder,
        assets: folder.assets.filter(
          (asset) =>
            asset.title.toLowerCase().includes(needle) ||
            asset.fileName.toLowerCase().includes(needle),
        ),
      }))
      .filter((folder) => folder.assets.length > 0)
  }, [folders, query])

  const toggle = (name: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <>
      <div className="search">
        <input
          type="text"
          placeholder="filtrar arquivos"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {scan?.available && (
          <button className="btn small" onClick={onScan} disabled={scan.running}>
            {scan.running ? `${scan.seen}/${scan.total}` : 'LER PASTA'}
          </button>
        )}
      </div>
      {scan?.running && (
        <div className="scanning" title={scan.current ?? ''}>
          lendo o acervo · {scan.current ? scan.current.split('/').slice(-1)[0] : 'procurando'}
        </div>
      )}
      <div className="pane-body">
        {filtered.map((folder) => {
          const shut = collapsed.has(folder.name) && !query
          return (
            <div key={folder.name}>
              <button className="folder" onClick={() => toggle(folder.name)}>
                <span className="caret">{shut ? '▸' : '▾'}</span>
                {folder.name}
                <span className="n">{folder.assets.length}</span>
              </button>
              {!shut &&
                folder.assets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`file${openAssetId === asset.id ? ' open' : ''}${
                      asset.probeError ? ' broken' : ''
                    }`}
                    onClick={() => !asset.probeError && onPreview(asset.id)}
                    title={
                      asset.probeError
                        ? `${asset.path}\n\nNão abriu: ${asset.probeError}`
                        : `${asset.path}\nClique abre no preview`
                    }
                  >
                    <img src={asset.thumbnailUrl} alt="" width={64} height={36} />
                    <div className="info">
                      <div className="name">{asset.title}</div>
                      {/* Arquivo que não abriu continua na lista, com o motivo:
                          sumir com ele esconderia justamente o caso em que
                          alguém precisa instalar um plugin ou refazer a cópia. */}
                      {asset.probeError ? (
                        <div className="sub bad">não abriu</div>
                      ) : (
                        <div className="sub">
                          {dur(durationIn(asset, rate), rate)}
                          {asset.probe?.hasAudio === false && ' · mudo'}
                          {asset.loudnessFile &&
                            ` · ${lufs(asset.loudnessFile.integratedLufs)} LUFS`}
                          {asset.defaultTrim && ' · corte'}
                          {asset.defaultAudio && ' · nível'}
                        </div>
                      )}
                    </div>
                    {!asset.probeError && (
                      <button
                        className="add"
                        title="Inserir na grade"
                        onClick={(event) => {
                          event.stopPropagation()
                          onInsert(asset.id)
                        }}
                      >
                        +
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )
        })}
        {filtered.length === 0 && <div className="empty">Nenhum arquivo com esse nome.</div>}
      </div>
    </>
  )
}

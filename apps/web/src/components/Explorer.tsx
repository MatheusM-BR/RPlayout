import { useMemo, useState } from 'react'
import { durationIn, type Rate } from '@rplayout/protocol'
import type { LibraryFolder, ScanStatus } from '../types.js'
import { dur, lufs } from '../format.js'

interface Props {
  folders: LibraryFolder[]
  rate: Rate
  /** Arquivo aberto no preview agora, se for do explorador. */
  openAssetId: string | null
  /** Categorias que já existem no acervo. */
  categories: string[]
  onPreview: (assetId: string) => void
  /** Põe o arquivo no fim da grade, sem diálogo: é o caminho de todo dia. */
  onInsert: (assetId: string) => void
  onRemove: (assetId: string) => void
  onCategorize: (assetId: string, categoryId: string | null) => void
  /** Tira do acervo tudo que não abriu. */
  onPrune: () => void
  /** Situação da varredura do acervo. Nulo esconde o botão. */
  scan: ScanStatus | null
  onScan: (measure: boolean) => void
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
  categories,
  onPreview,
  onInsert,
  onRemove,
  onCategorize,
  onPrune,
  scan,
  onScan,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  /** Arquivo com a caixa de categoria aberta. */
  const [categorizando, setCategorizando] = useState<string | null>(null)
  const [novaCategoria, setNovaCategoria] = useState<string | null>(null)

  const quebrados = useMemo(
    () => folders.reduce((total, folder) => total + folder.assets.filter((a) => a.probeError).length, 0),
    [folders],
  )

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
          <div className="acoes-acervo">
            <button className="btn small" onClick={() => onScan(true)} disabled={scan.running}>
              {scan.running ? `${scan.seen}/${scan.total}` : 'LER PASTA'}
            </button>
            {/* Medir loudness é o que demora: decodifica o áudio inteiro de
                cada arquivo. Num acervo grande, poder ler sem medir é o que
                torna o dia utilizável -- e o nivelamento automático fica sem
                base até alguém medir, o que a linha do arquivo mostra. */}
            {!scan.running && (
              <button
                className="btn small"
                onClick={() => onScan(false)}
                title="Lê muito mais rápido, sem medir loudness"
              >
                RÁPIDO
              </button>
            )}
            {/* Enquanto alguém pode agir, arquivo que não abriu é informação.
                Depois que o operador viu e decidiu que não vai agir, é ruído. */}
            {!scan.running && quebrados > 0 && (
              <button
                className="btn small"
                onClick={onPrune}
                title={`Tira do acervo ${quebrados} arquivo(s) que não abriram`}
              >
                LIMPAR {quebrados}
              </button>
            )}
          </div>
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
                    // Arrastar para a grade é o gesto que o operador já tem na
                    // mão de outros programas. O que não abre não arrasta: não
                    // faz sentido pôr no ar o que nem toca.
                    draggable={!asset.probeError}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'copy'
                      event.dataTransfer.setData('application/x-rplayout-asset', asset.id)
                      // Texto puro junto, para quem largar fora da grade ver
                      // algo com sentido em vez de nada.
                      event.dataTransfer.setData('text/plain', asset.title)
                    }}
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
                    <div className="acoes" onClick={(event) => event.stopPropagation()}>
                      {!asset.probeError && (
                        <>
                          <button
                            className="add"
                            title="Põe no fim da grade"
                            onClick={() => onInsert(asset.id)}
                          >
                            +
                          </button>
                          <button
                            className="marca"
                            title={asset.categoryId ? `Categoria: ${asset.categoryId}` : 'Sem categoria'}
                            onClick={() =>
                              setCategorizando(categorizando === asset.id ? null : asset.id)
                            }
                          >
                            {asset.categoryId ? asset.categoryId.slice(0, 3) : '—'}
                          </button>
                        </>
                      )}
                      <button
                        className="tira"
                        title="Tira do acervo (não apaga o arquivo em disco)"
                        onClick={() => onRemove(asset.id)}
                      >
                        ×
                      </button>
                    </div>

                    {categorizando === asset.id && (
                      <div className="categoria" onClick={(event) => event.stopPropagation()}>
                        {novaCategoria === null ? (
                          <select
                            autoFocus
                            value={asset.categoryId ?? ''}
                            onChange={(event) => {
                              if (event.target.value === '__nova__') {
                                setNovaCategoria('')
                                return
                              }
                              onCategorize(asset.id, event.target.value || null)
                              setCategorizando(null)
                            }}
                          >
                            <option value="">sem categoria</option>
                            {categories.map((categoria) => (
                              <option key={categoria} value={categoria}>
                                {categoria}
                              </option>
                            ))}
                            <option value="__nova__">nova categoria…</option>
                          </select>
                        ) : (
                          <input
                            type="text"
                            autoFocus
                            placeholder="nome da categoria"
                            value={novaCategoria}
                            onChange={(event) => setNovaCategoria(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') setNovaCategoria(null)
                              if (event.key !== 'Enter' || novaCategoria.trim() === '') return
                              onCategorize(asset.id, novaCategoria.trim())
                              setNovaCategoria(null)
                              setCategorizando(null)
                            }}
                          />
                        )}
                      </div>
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

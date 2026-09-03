import { useMemo, useState, type CSSProperties } from 'react'
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
  /** Cor de cada categoria, para pintar a linha do arquivo. */
  categoryColors: Map<string, string>
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
  /** Acrescenta uma pasta ao acervo. Devolve o que deu errado, ou nulo. */
  onAddRoot: (path: string) => Promise<string | null>
  /** Abre o diálogo de inserir item com hora marcada. */
  onOpenInsert: () => void
}

/** Pastas fixadas, guardadas no navegador de quem opera. */
const FIXADAS = 'rplayout.pastas-fixadas'

function lerFixadas(): Set<string> {
  try {
    const bruto = window.localStorage.getItem(FIXADAS)
    return new Set(bruto ? (JSON.parse(bruto) as string[]) : [])
  } catch {
    // Navegador com armazenamento bloqueado não pode derrubar o explorador.
    return new Set()
  }
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
  categoryColors,
  onPreview,
  onInsert,
  onRemove,
  onCategorize,
  onPrune,
  scan,
  onScan,
  onAddRoot,
  onOpenInsert,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  /**
   * Pasta fixada sobe para o topo e nasce aberta.
   *
   * Num acervo de emissora a pasta do dia é uma só, e ela fica no meio de
   * dezenas de outras. Fixar é o que evita rolar a lista inteira toda vez.
   */
  const [fixadas, setFixadas] = useState<Set<string>>(lerFixadas)
  const [novaPasta, setNovaPasta] = useState<string | null>(null)
  const [erroPasta, setErroPasta] = useState<string | null>(null)
  /** Arquivo escolhido: é nele que o botão de baixo age. */
  const [escolhido, setEscolhido] = useState<string | null>(null)
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

  const toggle = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const fixar = (key: string): void => {
    setFixadas((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try {
        window.localStorage.setItem(FIXADAS, JSON.stringify([...next]))
      } catch {
        // Sem armazenamento a fixação vale só nesta sessão, e tudo bem.
      }
      return next
    })
  }

  /** Uma seção por raiz, com as pastas fixadas no topo de cada uma. */
  const porRaiz = useMemo(() => {
    const mapa = new Map<string, { label: string; folders: LibraryFolder[] }>()
    for (const folder of filtered) {
      const grupo = mapa.get(folder.rootId)
      if (grupo) grupo.folders.push(folder)
      else mapa.set(folder.rootId, { label: folder.rootLabel, folders: [folder] })
    }
    for (const grupo of mapa.values()) {
      grupo.folders.sort((a, b) => {
        const fa = fixadas.has(a.key) ? 0 : 1
        const fb = fixadas.has(b.key) ? 0 : 1
        return fa - fb || a.name.localeCompare(b.name, 'pt-BR')
      })
    }
    return [...mapa.entries()]
  }, [filtered, fixadas])

  const acrescentar = (): void => {
    const caminho = (novaPasta ?? '').trim()
    if (caminho === '') return
    void onAddRoot(caminho).then((erro) => {
      setErroPasta(erro)
      if (!erro) setNovaPasta(null)
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
        <button
          className="btn small"
          title="Acrescenta uma pasta ao acervo"
          onClick={() => {
            setErroPasta(null)
            setNovaPasta(novaPasta === null ? '' : null)
          }}
        >
          + PASTA
        </button>
      </div>
      {novaPasta !== null && (
        <div className="nova-pasta">
          <input
            type="text"
            autoFocus
            placeholder="C:\\Caminho\\Da\\Pasta"
            value={novaPasta}
            onChange={(event) => setNovaPasta(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setNovaPasta(null)
              if (event.key === 'Enter') acrescentar()
            }}
          />
          <button className="btn small" disabled={novaPasta.trim() === ''} onClick={acrescentar}>
            LER
          </button>
          {erroPasta && <div className="erro">{erroPasta}</div>}
        </div>
      )}
      {scan?.running && (
        <div className="scanning" title={scan.current ?? ''}>
          lendo o acervo · {scan.current ? scan.current.split('/').slice(-1)[0] : 'procurando'}
        </div>
      )}
      <div className="pane-body">
        {porRaiz.map(([rootId, grupo]) => (
          <div key={rootId} className="raiz">
            <div className="raiz-nome">{grupo.label}</div>
            {grupo.folders.map((folder) => {
          const fixa = fixadas.has(folder.key)
          // Pasta fixada nasce aberta: fixar é dizer "é nesta que eu trabalho".
          const shut = collapsed.has(folder.key) && !query && !fixa
          return (
            <div key={folder.key}>
              <div className={`folder${fixa ? ' fixa' : ''}`}>
                <button className="abre" onClick={() => toggle(folder.key)}>
                  <span className="caret">{shut ? '▸' : '▾'}</span>
                  {folder.name}
                  <span className="n">{folder.assets.length}</span>
                </button>
                <button
                  className={`alfinete${fixa ? ' on' : ''}`}
                  title={fixa ? 'Solta a pasta' : 'Fixa a pasta no topo'}
                  aria-label={fixa ? `Soltar ${folder.name}` : `Fixar ${folder.name}`}
                  onClick={() => fixar(folder.key)}
                >
                  ★
                </button>
              </div>
              {!shut &&
                folder.assets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`file${openAssetId === asset.id ? ' open' : ''}${
                      asset.probeError ? ' broken' : ''
                    }${escolhido === asset.id ? ' escolhido' : ''}`}
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
                    // Mesma cor da grade: o arquivo é reconhecido no
                    // explorador antes de entrar na programação.
                    style={
                      asset.categoryId && categoryColors.get(asset.categoryId)
                        ? ({ '--cat': categoryColors.get(asset.categoryId) } as CSSProperties)
                        : undefined
                    }
                    onClick={() => {
                      if (asset.probeError) return
                      setEscolhido(asset.id)
                      onPreview(asset.id)
                    }}
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
          </div>
        ))}
        {filtered.length === 0 && <div className="empty">Nenhum arquivo com esse nome.</div>}
      </div>

      {/* O botão de pôr na grade mora embaixo da lista, que é onde a mão já
          está depois de escolher o arquivo -- e não no alto, longe do que foi
          escolhido. */}
      <div className="explorador-rodape">
        <button
          className="btn"
          disabled={escolhido === null}
          title={
            escolhido === null ? 'Escolha um arquivo na lista' : 'Põe o arquivo no fim da grade'
          }
          onClick={() => escolhido !== null && onInsert(escolhido)}
        >
          PÔR NA GRADE
        </button>
        <button className="btn" onClick={onOpenInsert} title="Com hora marcada e âncora">
          INSERIR ITEM…
        </button>
      </div>
    </>
  )
}

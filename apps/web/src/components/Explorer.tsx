import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { durationIn, isIgnoredVideo, type Rate } from '@rplayout/protocol'
import type { LibraryFolder, ScanStatus } from '../types.js'
import { dur, lufs } from '../format.js'
import {AssetMetadataEditor} from './AssetMetadataEditor.js'

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
  onAccept: (assetId: string) => void | Promise<void>
  onMetadataSaved?: () => void
  /** Tira do acervo tudo que não abriu. */
  onPrune: () => void
  /** Situação da varredura do acervo. Nulo esconde o botão. */
  scan: ScanStatus | null
  onScan: (measure: boolean) => void
  /** Acrescenta uma pasta ao acervo. Devolve o que deu errado, ou nulo. */
  onPickRoot: () => Promise<string | null>
  onRemoveRoot: (rootId: string) => void
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
  onAccept,
  onMetadataSaved,
  onPrune,
  scan,
  onScan,
  onPickRoot,
  onRemoveRoot,
  onOpenInsert,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; assetId?: string; rootId?: string } | null>(null)
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

  const ativos = useMemo(
    () => filtered.map((folder) => ({ ...folder, assets: folder.assets.filter((asset) => !asset.ignored) })).filter((folder) => folder.assets.length > 0),
    [filtered],
  )
  const ignorados = useMemo(
    // Ignorados é quarentena de material que poderia entrar no playout. Áudio
    // e stills antigos não devem aparecer nesta lista operacional de vídeo.
    () => filtered.flatMap((folder) => folder.assets.filter(isIgnoredVideo)),
    [filtered],
  )

  const resultCount = ativos.reduce((total, folder) => total + folder.assets.length, 0)
  const assetsAll = folders.flatMap((folder) => folder.assets)
  const selectedAsset = assetsAll.find((asset) => asset.id === escolhido && !asset.probeError)

  const fecharMenu = (): void => setMenu(null)
  const abrirMenu = (event: MouseEvent, target: { assetId?: string; rootId?: string }): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, ...target })
  }
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
    for (const folder of ativos) {
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
  }, [ativos, fixadas])

  const acrescentar = (): void => {
    void onPickRoot().then((erro) => {
      setErroPasta(erro)
      if (!erro) setNovaPasta(null)
    })
  }

  return (
    <>
      <div className="search">
        <input
          type="text"
          aria-label="Buscar arquivos no acervo"
          placeholder="Buscar por nome do arquivo…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && <button className="btn small" onClick={() => setQuery('')}>Limpar busca</button>}
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
      {query.trim() && <div className="search-summary" role="status">{resultCount} arquivo(s) encontrado(s)</div>}
      {novaPasta !== null && (
        <div className="nova-pasta">
          <button className="btn small" onClick={acrescentar}>
            ABRIR EXPLORADOR DO WINDOWS
          </button>
          {erroPasta && <div className="erro">{erroPasta}</div>}
        </div>
      )}
      {scan?.running && (
        <div className="scanning" title={scan.current ?? ''}>
          lendo o acervo · {scan.current ? scan.current.split('/').slice(-1)[0] : 'procurando'}
        </div>
      )}
      {scan?.error && <div className="empty" role="alert">{scan.error}</div>}
      {scan?.folders?.filter((folder) => !folder.present).map((folder) => (
        <div className="empty" key={folder.id} role="status">Pasta indisponível: {folder.path}</div>
      ))}
      <div className="pane-body">
        {porRaiz.map(([rootId, grupo]) => (
          <div key={rootId} className="raiz">
            <div className="raiz-nome" onContextMenu={(event) => abrirMenu(event, { rootId })}>
              <span>{grupo.label}</span>
              {rootId !== 'fora' && (
                <button
                  className="btn small"
                  title={`Remover a pasta ${grupo.label} do acervo`}
                  onClick={() => onRemoveRoot(rootId)}
                >
                  remover pasta
                </button>
              )}
            </div>
            {grupo.folders.map((folder) => {
          const fixa = fixadas.has(folder.key)
          // Pasta fixada nasce aberta: fixar é dizer "é nesta que eu trabalho".
          const shut = collapsed.has(folder.key) && !query && !fixa
          return (
            <div key={folder.key}>
              <div className={`folder${fixa ? ' fixa' : ''}`} onContextMenu={(event) => abrirMenu(event, { rootId })}>
                <button className="abre" aria-expanded={!shut} onClick={() => toggle(folder.key)}>
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
                    tabIndex={asset.probeError ? undefined : 0}
                    role="group"
                    aria-label={`${asset.title} — abrir no preview`}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      if (asset.probeError || event.repeat) return
                      setEscolhido(asset.id)
                      onPreview(asset.id)
                    }}
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
                    onContextMenu={(event) => abrirMenu(event, { assetId: asset.id })}
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
                            aria-label={`Adicionar ${asset.title} ao fim da grade`}
                            onClick={() => onInsert(asset.id)}
                          >
                            +
                          </button>
                          <button
                            className="marca"
                            title={asset.categoryId ? `Categoria: ${asset.categoryId}` : 'Sem categoria'}
                            onClick={() => setCategorizando(asset.id)}
                          >
                            {asset.categoryId ? asset.categoryId.slice(0, 3) : '—'}
                          </button>
                        </>
                      )}
                      <button
                        className="tira"
                        title="Tira do acervo (não apaga o arquivo em disco)"
                        aria-label={`Remover ${asset.title} do acervo`}
                        onClick={() => onRemove(asset.id)}
                      >
                        ×
                      </button>
                    </div>

                  </div>
                ))}
            </div>
          )
            })}
          </div>
        ))}
        {resultCount === 0 && <div className="empty library-empty">
          <strong>{query.trim() ? 'Nenhum resultado' : 'Seu acervo começa aqui'}</strong>
          <p>{query.trim() ? 'Tente outro nome ou limpe a busca para ver todos os arquivos.' : 'Use + PASTA para escolher a pasta de mídia. Depois, selecione um arquivo para conferir no preview.'}</p>
        </div>}
        {ignorados.length > 0 && (
          <div className="ignored-assets" aria-label="Arquivos ignorados">
            <div className="pane-title">ignorados<span className="count">{ignorados.length}</span></div>
            <div className="ignored-list">
              {ignorados.map((asset) => (
                <div className="ignored-row" key={asset.id}>
                  <span className="name">{asset.title}</span>
                  <span className="sub">{asset.probe?.hasAudio === false ? 'mudo' : asset.probe ? `${asset.probe.width}×${asset.probe.height}` : 'sem imagem'}</span>
                  <button className="btn small" onClick={() => { void Promise.resolve(onAccept(asset.id)).catch(() => {}) }} title="Aprovar este arquivo no QC e devolvê-lo ao acervo ativo">APROVAR</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={fecharMenu}>
          {menu.assetId && (() => {
            const asset = assetsAll.find((entry) => entry.id === menu.assetId)
            if (!asset) return null
            return <>
              <button disabled={Boolean(asset.probeError)} onClick={() => { fecharMenu(); onPreview(asset.id) }}>abrir no preview</button>
              <button disabled={Boolean(asset.probeError)} onClick={() => { fecharMenu(); onInsert(asset.id) }}>inserir na grade</button>
              <button onClick={() => { fecharMenu(); onRemove(asset.id) }}>remover do acervo</button>
            </>
          })()}
          {menu.rootId && menu.rootId !== 'fora' && (
            <button onClick={() => { fecharMenu(); onRemoveRoot(menu.rootId!) }}>remover pasta do acervo</button>
          )}
        </div>
      )}

      {categorizando&&<AssetMetadataEditor key={categorizando} assetId={categorizando} categories={categories} onSaved={()=>onMetadataSaved?.()} onCancel={()=>setCategorizando(null)}/>}
      {/* O botão de pôr na grade mora embaixo da lista, que é onde a mão já
          está depois de escolher o arquivo -- e não no alto, longe do que foi
          escolhido.

          Os dois nomes dizem a diferença entre eles, e não o que os dois fazem.
          "Pôr na grade" e "Inserir item" descreviam a mesma coisa com palavras
          diferentes, lado a lado: quem está aprendendo tinha que clicar nos
          dois para descobrir que um vai para o fim e o outro pergunta a hora. */}
      <div className="explorador-rodape">
        <button
          className="btn"
          disabled={!selectedAsset}
          title={
            !selectedAsset
              ? 'Escolha um arquivo na lista'
              : `Adicionar ${selectedAsset.title} ao fim da grade`
          }
          onClick={() => selectedAsset && onInsert(selectedAsset.id)}
        >
          PÔR NO FIM
        </button>
        <button
          className="btn"
          onClick={onOpenInsert}
          title="Abre o diálogo para marcar a hora de entrada e a âncora"
        >
          COM HORA MARCADA…
        </button>
      </div>
    </>
  )
}

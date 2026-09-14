import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import type { PlaylistEntryView, PlaylistFile, Snapshot } from '../types.js'

interface Props {
  rundownId: string
  onCancel: () => void
  onLoaded: (snapshot: Snapshot, message: string) => void
  onMessage: (text: string) => void
}

/**
 * As listas de reprodução que estão na pasta do acervo.
 *
 * O modelo é o que o operador já usa por fora: uma lista por dia, com a data
 * no nome, salva junto dos vídeos. Aqui elas são só lidas -- nada é copiado
 * para dentro do sistema, então editar a lista no programa de sempre e
 * recarregar continua funcionando.
 */
export function PlaylistsDialog({ rundownId, onCancel, onLoaded, onMessage }: Props) {
  const [listas, setListas] = useState<PlaylistFile[]>([])
  const [hoje, setHoje] = useState<string | null>(null)
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [entradas, setEntradas] = useState<PlaylistEntryView[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [versoes, setVersoes] = useState<Array<{ id: string; sourceName: string; mode: 'APPEND' | 'PUBLISH_NEXT'; loaded: number; skipped: number; scheduledDate: string | null; publishedAt: string }>>([])
  const [importada, setImportada] = useState<{ name: string; text: string } | null>(null)
  const [importEntries, setImportEntries] = useState<PlaylistEntryView[] | null>(null)
  const [inicioDia, setInicioDia] = useState('00:00')
  const [filtroData, setFiltroData] = useState('')
  const [dataProgramacao, setDataProgramacao] = useState(() => localStorage.getItem('rplayout.programacao.data') ?? new Date().toISOString().slice(0, 10))
  const [filtrarHistorico, setFiltrarHistorico] = useState(false)
  useEffect(() => { localStorage.setItem('rplayout.programacao.data', dataProgramacao) }, [dataProgramacao])
  const moverData = (dias: number): void => {
    const base = new Date(`${dataProgramacao}T12:00:00`)
    base.setDate(base.getDate() + dias)
    setDataProgramacao(base.toISOString().slice(0, 10))
  }
  const textoRevisado = importEntries?.map((entry) => entry.ref).join('\n') ?? importada?.text ?? ''

  const recarregar = useCallback(async () => {
    const resposta = await api.playlists()
    setListas(resposta.playlists)
    setHoje(resposta.today)
    // A lista do dia já vem aberta: é a que o operador veio buscar.
    setEscolhida((atual) => atual ?? resposta.today ?? resposta.playlists[0]?.path ?? null)
  }, [])

  useEffect(() => {
    void recarregar().catch((falha: Error) => onMessage(falha.message))
  }, [recarregar, onMessage])

  useEffect(() => {
    if (escolhida === null) {
      setEntradas(null)
      return
    }
    let valeu = true
    void api
      .playlistEntries(escolhida)
      .then((resposta) => {
        if (valeu) setEntradas(resposta.entries)
      })
      .catch((falha: Error) => onMessage(falha.message))
    return () => {
      valeu = false
    }
  }, [escolhida, onMessage])

  useEffect(() => {
    void api.playlistVersions(rundownId).then((resposta) => setVersoes(resposta.versions)).catch(() => setVersoes([]))
  }, [rundownId, busy])

  const carregar = (replace: boolean): void => {
    if (escolhida === null && !importada) return
    setBusy(true)
    const request = importada
      ? api.loadPlaylistText(rundownId, textoRevisado, replace, dataProgramacao)
      : api.loadPlaylist(rundownId, escolhida as string, replace, dataProgramacao)
    void request
      .then((resposta) => {
        const pulou =
          resposta.skipped > 0 ? ` · ${resposta.skipped} sem arquivo no acervo` : ''
        onLoaded(
          resposta,
          `${resposta.loaded} item(ns) na grade${pulou} — Ctrl+Z desfaz.`,
        )
      })
      .catch((falha: Error) => onMessage(falha.message))
      .finally(() => setBusy(false))
  }

  const arquivoEntries = importEntries ?? entradas
  const datasPublicadas = [...new Set(versoes.map((versao) => versao.scheduledDate).filter((date): date is string => Boolean(date)))].sort()
  const semArquivo = arquivoEntries?.filter((entrada) => entrada.mediaId === null).length ?? 0
  const duracao = arquivoEntries?.reduce((total, entrada) => total + (entrada.seconds ?? 0), 0) ?? 0
  const horas = Math.floor(duracao / 3600)
  const minutos = Math.floor((duracao % 3600) / 60)
  const segundos = Math.floor(duracao % 60)
  const duracaoLabel = arquivoEntries
    ? `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
    : '—'
  const inicioMin = /^([01]\d|2[0-3]):[0-5]\d$/.test(inicioDia) ? Number(inicioDia.slice(0, 2)) * 60 + Number(inicioDia.slice(3)) : 0
  const horario = (seconds: number): string => {
    const total = (inicioMin * 60 + Math.floor(seconds)) % 86400
    return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }
  const agendaCsv = arquivoEntries
    ? 'horário;título;referência;duração;status\n' + arquivoEntries.map((entry, i) => [horario(arquivoEntries.slice(0, i).reduce((sum, item) => sum + (item.seconds ?? 0), 0)), entry.title ?? '', entry.ref, entry.seconds ?? '', entry.mediaId ? 'OK' : 'SEM ARQUIVO'].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(';')).join('\n')
    : ''

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Listas de reprodução</h2>
          <div className="sub">
            operador de playlist · programação diária sem interferir no Master
          </div>
        </header>

        <div className="body">
          <div className="field">
              <label>Listas encontradas</label>
            <div className="playlist-date-filter"><label>Filtrar por data</label><input type="date" value={filtroData} onChange={(event) => setFiltroData(event.target.value)} /></div>
            <div className="playlist-date-filter"><label>Calendário da programação</label><div className="row"><button className="btn small" type="button" onClick={() => moverData(-1)} aria-label="dia anterior">←</button><input type="date" value={dataProgramacao} onChange={(event) => setDataProgramacao(event.target.value)} /><button className="btn small" type="button" onClick={() => moverData(1)} aria-label="próximo dia">→</button><button className="btn small" type="button" onClick={() => setDataProgramacao(new Date().toISOString().slice(0, 10))}>HOJE</button></div><div className="week-days">{Array.from({ length: 7 }, (_, index) => { const day = new Date(`${dataProgramacao}T12:00:00`); day.setDate(day.getDate() - day.getDay() + index); const value = day.toISOString().slice(0, 10); return <button type="button" key={value} className={`btn small ${value === dataProgramacao ? 'take' : ''}`} onClick={() => setDataProgramacao(value)}>{day.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} {day.getDate()}</button> })}</div><span className="pill ok">agenda selecionada</span></div>
            <div className="playlist-import">
              <input id="playlist-file" type="file" accept=".m3u,.m3u8,.csv,.txt" hidden onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                void file.text().then((text) => api.readPlaylist(file.name, text).then((result) => {
                  setImportada({ name: file.name, text })
                  setImportEntries(result.entries)
                  setEscolhida(null)
                  onMessage(`${file.name}: ${result.entries.length} entradas, ${result.missing} sem arquivo.`)
                }).catch((failure: Error) => onMessage(failure.message)))
              }} />
              <label className="btn small" htmlFor="playlist-file">IMPORTAR ARQUIVO 24H</label>
              {importada && <span className="pill ok">{importada.name}</span>}
            </div>
            <ul className="listas">
              {listas.filter((lista) => !filtroData || lista.date === filtroData).map((lista) => (
                <li
                  key={lista.path}
                  className={`${escolhida === lista.path ? 'escolhida' : ''}${
                    hoje === lista.path ? ' hoje' : ''
                  }`}
                >
                  <button onClick={() => setEscolhida(lista.path)}>
                    <span className="nome">{lista.name}</span>
                    {hoje === lista.path && <span className="pill ok">DE HOJE</span>}
                    {lista.date === null && (
                      <span className="pill" title="Sem data no nome: não é a lista de nenhum dia">
                        SEM DATA
                      </span>
                    )}
                    <span className="conta">
                      {lista.matched}/{lista.entries} no acervo
                    </span>
                  </button>
                </li>
              ))}
              {listas.length === 0 && (
                <li className="vazio">
                  Nenhum arquivo .m3u na pasta do acervo.
                </li>
              )}
            </ul>
          </div>

          {arquivoEntries && (
            <div className="field">
              <label>O que a lista tem · {arquivoEntries.length} itens · duração estimada {duracaoLabel}</label>
              <div className="row"><div className="field"><label>Início da programação</label><input type="time" value={inicioDia} onChange={(event) => setInicioDia(event.target.value)} /></div></div>
              {/* O que não achou aparece riscado, e não some: sumir esconderia
                  justamente o que precisa de conserto antes do ar. */}
              <ol className="entradas">
                {arquivoEntries.map((entrada, i) => (
                  <li key={`${entrada.ref}-${i}`} className={entrada.mediaId ? '' : 'faltando'}>
                    <b className="mono playlist-clock">{horario(arquivoEntries.slice(0, i).reduce((sum, item) => sum + (item.seconds ?? 0), 0))}</b>
                    <span className="t">{entrada.title ?? entrada.ref}</span>
                    {entrada.mediaId === null && (
                      <span className="pill bad" title={entrada.ref}>
                        SEM ARQUIVO
                      </span>
                    )}
                    {entrada.matchedBy === 'name' && (
                      <span
                        className="pill warn"
                        title="A lista aponta para outro caminho; casou pelo nome do arquivo"
                      >
                        PELO NOME
                      </span>
                    )}
                    {importEntries && <span className="playlist-entry-actions">
                      <button className="btn small" title="mover para cima" disabled={i === 0} onClick={() => setImportEntries((current) => { if (!current || i === 0 || !current[i] || !current[i - 1]) return current; const next = [...current]; [next[i - 1]!, next[i]!] = [next[i]!, next[i - 1]!]; return next })}>↑</button>
                      <button className="btn small" title="mover para baixo" disabled={i === arquivoEntries.length - 1} onClick={() => setImportEntries((current) => { if (!current || i >= current.length - 1 || !current[i] || !current[i + 1]) return current; const next = [...current]; [next[i]!, next[i + 1]!] = [next[i + 1]!, next[i]!]; return next })}>↓</button>
                      <button className="btn small" title="remover da publicação" onClick={() => setImportEntries((current) => current?.filter((_, index) => index !== i) ?? null)}>remover</button>
                    </span>}
                  </li>
                ))}
              </ol>
              {semArquivo > 0 && (
                <div className="note">
                  {semArquivo} entrada(s) sem arquivo no acervo são puladas. Entrada ao vivo
                  não tem arquivo e cai aqui — por enquanto ela entra na grade à mão.
                </div>
              )}
              <div className="note">
                Publicar a lista substitui somente o futuro da grade. O item que já está no ar
                permanece protegido; a alteração pode ser desfeita pelo histórico.
              </div>
            </div>
          )}
          <div className="field">
            <label>Histórico de publicação</label>
            {datasPublicadas.length > 0 && <div className="week-days" aria-label="dias com programação publicada">{datasPublicadas.map((date) => <button type="button" className={`btn small ${date === dataProgramacao ? 'take' : ''}`} key={date} onClick={() => { setDataProgramacao(date); setFiltrarHistorico(true) }}>{date}</button>)}</div>}
            <label className="check"><input type="checkbox" checked={filtrarHistorico} onChange={(event) => setFiltrarHistorico(event.target.checked)} /> mostrar somente {dataProgramacao}</label>
            {versoes.length === 0 ? <div className="note">nenhuma playlist publicada nesta grade</div> : (
              <ol className="entradas">
                {versoes.filter((versao) => !filtrarHistorico || versao.scheduledDate === dataProgramacao).slice(0, 8).map((versao) => <li key={versao.id}>
                  <span className="t">{versao.scheduledDate ? `${versao.scheduledDate} · ` : ''}{new Date(versao.publishedAt).toLocaleString()}</span>
                  <span className="pill">{versao.mode === 'PUBLISH_NEXT' ? 'PRÓXIMO' : 'FIM'}</span>
                  <span className="conta">{versao.sourceName} · {versao.loaded} carregados · {versao.skipped} pulados</span>
                </li>)}
              </ol>
            )}
          </div>
        </div>

        <footer>
          <button className="btn" onClick={() => window.open(`${window.location.pathname}?workspace=playlist`, '_blank', 'noopener,noreferrer')}>
            abrir tela do operador
          </button>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          {arquivoEntries && <a className="btn" download="programacao-24h.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(agendaCsv)}`}>baixar programação</a>}
          <button className="btn" disabled={busy || (escolhida === null && !importada)} onClick={() => carregar(false)}>
            inserir no fim
          </button>
          <button
            className="btn take"
            disabled={busy || (escolhida === null && !importada)}
            onClick={() => carregar(true)}
          >
            publicar no próximo item
          </button>
        </footer>
      </div>
    </div>
  )
}

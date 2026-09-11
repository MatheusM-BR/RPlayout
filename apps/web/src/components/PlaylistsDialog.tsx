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

  const carregar = (replace: boolean): void => {
    if (escolhida === null) return
    setBusy(true)
    void api
      .loadPlaylist(rundownId, escolhida, replace)
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

  const semArquivo = entradas?.filter((entrada) => entrada.mediaId === null).length ?? 0

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Listas de reprodução</h2>
          <div className="sub">
            lidas da pasta do acervo · a do dia é a que tem a data de hoje no nome
          </div>
        </header>

        <div className="body">
          <div className="field">
            <label>Listas encontradas</label>
            <ul className="listas">
              {listas.map((lista) => (
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

          {entradas && (
            <div className="field">
              <label>O que a lista tem</label>
              {/* O que não achou aparece riscado, e não some: sumir esconderia
                  justamente o que precisa de conserto antes do ar. */}
              <ol className="entradas">
                {entradas.map((entrada, i) => (
                  <li key={`${entrada.ref}-${i}`} className={entrada.mediaId ? '' : 'faltando'}>
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
                  </li>
                ))}
              </ol>
              {semArquivo > 0 && (
                <div className="note">
                  {semArquivo} entrada(s) sem arquivo no acervo são puladas. Entrada ao vivo
                  não tem arquivo e cai aqui — por enquanto ela entra na grade à mão.
                </div>
              )}
            </div>
          )}
        </div>

        <footer>
          <button className="btn" onClick={onCancel}>
            cancelar
          </button>
          <button className="btn" disabled={busy || escolhida === null} onClick={() => carregar(false)}>
            adicionar ao fim
          </button>
          <button
            className="btn take"
            disabled={busy || escolhida === null}
            onClick={() => carregar(true)}
          >
            substituir a grade
          </button>
        </footer>
      </div>
    </div>
  )
}

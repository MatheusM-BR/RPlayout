import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import type { Categoria } from '../types.js'

interface Props {
  onMessage: (text: string) => void
  /** Recarrega acervo e grade quando uma categoria muda de cor ou some. */
  onChanged: () => void
}

/**
 * Paleta fechada, em vez de seletor de cor livre.
 *
 * Cor escolhida à mão num seletor de milhões de valores acaba clara demais
 * para o fundo escuro do painel, ou tão perto da vizinha que as duas viram a
 * mesma coisa na grade. Estas nove foram escolhidas para se distinguirem entre
 * si e para o texto continuar legível por cima quando entram fracas na linha.
 */
const PALETA: readonly { cor: string; nome: string }[] = [
  { cor: '#c98a3a', nome: 'âmbar' },
  { cor: '#4a9d7a', nome: 'verde' },
  { cor: '#5b8fd6', nome: 'azul' },
  { cor: '#a86fc0', nome: 'roxo' },
  { cor: '#c96a6a', nome: 'vermelho' },
  { cor: '#3fa3a3', nome: 'turquesa' },
  { cor: '#9a9a4f', nome: 'oliva' },
  { cor: '#c07ba0', nome: 'rosa' },
  { cor: '#7d8794', nome: 'cinza' },
]

export function CategoriasPanel({ onMessage, onChanged }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [nova, setNova] = useState('')
  const [corNova, setCorNova] = useState(PALETA[0]?.cor ?? '#5570ab')
  const [busy, setBusy] = useState(false)

  const recarregar = useCallback(async () => {
    const resposta = await api.categories()
    setCategorias(resposta.categories)
  }, [])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  const guard = (acao: () => Promise<void>): void => {
    setBusy(true)
    void acao()
      .then(recarregar)
      .then(onChanged)
      .catch((falha: Error) => onMessage(falha.message))
      .finally(() => setBusy(false))
  }

  const pintar = (id: string, cor: string): void => {
    guard(async () => {
      await api.setCategoryColor(id, cor)
    })
  }

  const criar = (): void => {
    const nome = nova.trim()
    if (nome === '') return
    guard(async () => {
      await api.setCategoryColor(nome, corNova)
      setNova('')
      onMessage(`Categoria "${nome}" criada.`)
    })
  }

  const apagar = (categoria: Categoria): void => {
    // Apagar categoria tira a marca dos arquivos: pergunta com o número na
    // frente, porque "3 arquivos" e "300 arquivos" são decisões diferentes.
    const aviso =
      categoria.items > 0
        ? `Apagar "${categoria.id}"? ${categoria.items} arquivo(s) ficam sem categoria.`
        : `Apagar "${categoria.id}"?`
    if (!window.confirm(aviso)) return
    guard(async () => {
      const { soltos } = await api.removeCategory(categoria.id)
      onMessage(
        soltos > 0
          ? `"${categoria.id}" apagada; ${soltos} arquivo(s) ficaram sem categoria.`
          : `"${categoria.id}" apagada.`,
      )
    })
  }

  return (
    <div className="field">
      <label>Categorias do acervo</label>
      <div className="note">
        A cor pinta a linha do arquivo na grade e no explorador — é o que
        permite achar o bloco comercial de longe, sem ler nome nenhum.
      </div>

      <ul className="categorias">
        {categorias.map((categoria) => (
          <li key={categoria.id}>
            <span className="amostra" style={{ background: categoria.color }} />
            <span className="nome">{categoria.id}</span>
            <span className="quantos">
              {categoria.items} {categoria.items === 1 ? 'arquivo' : 'arquivos'}
            </span>
            <span className="paleta">
              {PALETA.map((entrada) => (
                <button
                  key={entrada.cor}
                  className={`tinta${categoria.color === entrada.cor ? ' escolhida' : ''}`}
                  style={{ background: entrada.cor }}
                  disabled={busy}
                  title={entrada.nome}
                  aria-label={`Pintar ${categoria.id} de ${entrada.nome}`}
                  onClick={() => pintar(categoria.id, entrada.cor)}
                />
              ))}
            </span>
            <button className="btn small tira" disabled={busy} onClick={() => apagar(categoria)}>
              ×
            </button>
          </li>
        ))}
        {categorias.length === 0 && (
          <li className="vazio">
            Nenhuma categoria ainda. Crie aqui, ou marque um arquivo no explorador.
          </li>
        )}
      </ul>

      <div className="add-row">
        <input
          type="text"
          placeholder="nova categoria"
          value={nova}
          onChange={(event) => setNova(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && criar()}
        />
        <span className="paleta">
          {PALETA.map((entrada) => (
            <button
              key={entrada.cor}
              className={`tinta${corNova === entrada.cor ? ' escolhida' : ''}`}
              style={{ background: entrada.cor }}
              title={entrada.nome}
              aria-label={`Cor ${entrada.nome}`}
              onClick={() => setCorNova(entrada.cor)}
            />
          ))}
        </span>
        <button className="btn small" disabled={busy || nova.trim() === ''} onClick={criar}>
          CRIAR
        </button>
      </div>
    </div>
  )
}

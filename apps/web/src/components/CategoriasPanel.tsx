import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import type { Categoria } from '../types.js'
import {CategoryEditor} from './CategoryEditor.js'
import {BoundedLatestRead} from '../domain/bounded-latest-read.js'

interface Props {
  onMessage: (text: string) => void
  /** Recarrega acervo e grade quando uma categoria muda de cor ou some. */
  onChanged: () => void
}

/**
 * Paleta de atalhos: a escolha abre a conferência antes de alterar a cor.
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
  const [loaded,setLoaded]=useState(false),[error,setError]=useState('')
  const [editing,setEditing]=useState<{id:string;color?:string}|null>(null)
  const reads=useRef(new BoundedLatestRead()),alive=useRef(false),epoch=useRef(0),pending=useRef(false)

  const recarregar = useCallback(async () => {
    const at=epoch.current,reading=await reads.current.read(signal=>api.categories(signal),'A consulta das categorias demorou demais. A lista anterior foi preservada; recarregue para tentar novamente.')
    if(!reading.current||!alive.current||epoch.current!==at)return
    const resposta=reading.value
    setCategorias(resposta.categories)
    setLoaded(true);setError('')
  }, [])

  useEffect(() => {
    alive.current=true;epoch.current++;pending.current=false
    const at=epoch.current
    void recarregar().catch(cause=>{if(alive.current&&epoch.current===at)setError(cause instanceof Error?cause.message:'Categorias não consultadas.')})
    return()=>{alive.current=false;epoch.current++;pending.current=false;reads.current.cancel()}
  }, [recarregar])

  const guard = (acao: () => Promise<void>): void => {
    if(pending.current)return
    pending.current=true;const at=epoch.current
    setBusy(true)
    void acao()
      .then(recarregar)
      .then(()=>{if(alive.current&&epoch.current===at)onChanged()})
      .catch((falha: Error) => {if(alive.current&&epoch.current===at){setError(falha.message);onMessage(falha.message)}})
      .finally(() => {if(alive.current&&epoch.current===at){pending.current=false;setBusy(false)}})
  }

  const pintar = (id: string, cor: string): void => {
    setEditing({id,color:cor})
  }

  const criar = (): void => {
    const nome = nova.trim()
    if (nome === '') return
    setEditing({id:nome,color:corNova})
  }

  const apagar = (categoria: Categoria): void => {
    // Apagar categoria tira a marca dos arquivos: pergunta com o número na
    // frente, porque "3 arquivos" e "300 arquivos" são decisões diferentes.
    setEditing({id:categoria.id})
  }

  return (
    <div className="field">
      <label>Categorias do acervo</label>
      {error&&<p role="alert">{error} Falha de consulta não significa acervo vazio.</p>}
      {!loaded&&<p role="status">Categorias ainda não conferidas.</p>}
      <button disabled={busy} onClick={()=>guard(async()=>{})}>Recarregar lista</button>
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
        {loaded&&categorias.length === 0 && (
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
          CONFERIR NOVA CATEGORIA
        </button>
      </div>
      {editing&&<CategoryEditor key={editing.id} id={editing.id} initialColor={editing.color} onCancel={()=>setEditing(null)} onSaved={message=>{setEditing(null);setNova('');onMessage(message);guard(async()=>{})}}/>}
    </div>
  )
}

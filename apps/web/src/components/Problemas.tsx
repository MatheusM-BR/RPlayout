import { useState } from 'react'

/** Um problema visto pela interface, de onde quer que tenha vindo. */
export interface Problema {
  id: number
  quando: string
  origem: 'SERVIDOR' | 'TELA' | 'ARQUIVO' | 'SAÍDA'
  texto: string
}

interface Props {
  problemas: Problema[]
  onLimpar: () => void
}

const TOM: Record<Problema['origem'], string> = {
  SERVIDOR: 'srv',
  TELA: 'tela',
  ARQUIVO: 'arq',
  'SAÍDA': 'saida',
}

/**
 * Sino de problemas, no canto de baixo.
 *
 * Erro que aparece por três segundos e some não existe para quem estava
 * olhando o monitor. Aqui ele fica: o operador vê que houve, quantos, e de
 * onde -- servidor, tela, arquivo ou saída -- sem precisar do console do
 * navegador aberto.
 */
export function Problemas({ problemas, onLimpar }: Props) {
  const [aberto, setAberto] = useState(false)

  if (problemas.length === 0) {
    return (
      <button className="problemas quieto" title="Nenhum problema registrado" disabled>
        !
      </button>
    )
  }

  return (
    <>
      <button
        className="problemas"
        title={`${problemas.length} problema(s) — clique para ver`}
        onClick={() => setAberto(true)}
      >
        ! <b>{problemas.length}</b>
      </button>

      {aberto && (
        <div className="backdrop" onClick={() => setAberto(false)}>
          <div className="dialog wide" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Problemas</h2>
              <div className="sub">o mais novo primeiro · fica aqui até você limpar</div>
            </header>
            <div className="body">
              <ul className="cues">
                {problemas.map((problema) => (
                  <li key={problema.id}>
                    <b>{problema.quando}</b>
                    <span className={`chip ${TOM[problema.origem]}`}>{problema.origem}</span>
                    <i>{problema.texto}</i>
                    <span />
                  </li>
                ))}
              </ul>
            </div>
            <footer>
              <button className="btn" onClick={() => setAberto(false)}>
                fechar
              </button>
              <button
                className="btn"
                onClick={() => {
                  onLimpar()
                  setAberto(false)
                }}
              >
                limpar
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

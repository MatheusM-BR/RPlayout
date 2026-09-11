import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import type { MediaRoot } from '../types.js'

interface Props {
  onMessage: (text: string) => void
  /** Recarrega o explorador quando uma pasta entra ou sai. */
  onChanged: () => void
}

/**
 * Pastas onde o acervo procura arquivo.
 *
 * Antes disto havia uma só, fixada por variável de ambiente na hora de subir:
 * trocar de pasta exigia mexer no atalho e reiniciar o sistema, e apontar para
 * duas era impossível. Numa emissora o material chega em mais de um lugar, e
 * obrigar tudo a morar sob a mesma raiz é obrigar a mover arquivo.
 */
export function PastasPanel({ onMessage, onChanged }: Props) {
  const [pastas, setPastas] = useState<MediaRoot[]>([])
  const [nova, setNova] = useState('')
  const [busy, setBusy] = useState(false)
  const [varrendo, setVarrendo] = useState(false)

  const recarregar = useCallback(async () => {
    const resposta = await api.mediaRoots()
    setPastas(resposta.roots)
  }, [])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  /**
   * Acompanha a varredura enquanto ela corre.
   *
   * Sem isto, apontar para uma pasta grande parecia não ter feito nada: os
   * arquivos só apareciam minutos depois, e quem estava olhando concluía que a
   * procura não funcionava.
   */
  useEffect(() => {
    if (!varrendo) return undefined
    const relogio = window.setInterval(() => {
      void api
        .scanStatus()
        .then((estado) => {
          if (estado.running) return
          setVarrendo(false)
          onChanged()
          onMessage(
            estado.added > 0
              ? `Procura terminada: ${estado.added} arquivo(s) novo(s).`
              : 'Procura terminada: nada de novo.',
          )
        })
        .catch(() => setVarrendo(false))
    }, 2_000)
    return () => window.clearInterval(relogio)
  }, [varrendo, onChanged, onMessage])

  const guard = (acao: () => Promise<void>): void => {
    setBusy(true)
    void acao()
      .then(recarregar)
      .catch((falha: Error) => onMessage(falha.message))
      .finally(() => setBusy(false))
  }

  const acrescentar = (): void => {
    const caminho = nova.trim()
    if (caminho === '') return
    guard(async () => {
      const { root, scanning } = await api.addMediaRoot(caminho)
      setNova('')
      setVarrendo(scanning)
      onMessage(
        scanning
          ? `"${root.label}" entrou no acervo. Procurando arquivos…`
          : `"${root.label}" entrou no acervo.`,
      )
      onChanged()
    })
  }

  const tirar = (pasta: MediaRoot): void => {
    // Tirar a pasta não apaga o acervo dela: uma grade que aponta para um
    // arquivo dessa pasta continua tocando. Dizer isso na pergunta evita que
    // alguém deixe de tirar por medo de perder o que montou.
    if (!window.confirm(`Tirar "${pasta.label}" do acervo? Os arquivos já na grade continuam.`)) {
      return
    }
    guard(async () => {
      await api.removeMediaRoot(pasta.id)
      onMessage(`"${pasta.label}" saiu do acervo.`)
      onChanged()
    })
  }

  const procurar = (): void => {
    guard(async () => {
      await api.scan(false)
      setVarrendo(true)
      onMessage('Procurando arquivos em todas as pastas…')
    })
  }

  return (
    <div className="field">
      <label>Pastas do acervo</label>
      <div className="note">
        O sistema procura arquivo em todas elas. Pasta que some da rede fica
        marcada e é pulada na procura — o acervo dela não é apagado.
      </div>

      <ul className="pastas">
        {pastas.map((pasta) => (
          <li key={pasta.id}>
            <span className="nome">{pasta.label}</span>
            <span className="caminho mono" title={pasta.path}>
              {pasta.path}
            </span>
            {!pasta.present && <span className="tag sumida">FORA DO AR</span>}
            <button
              className="btn small tira"
              disabled={busy || pastas.length === 1}
              title={
                pastas.length === 1
                  ? 'O acervo precisa de pelo menos uma pasta.'
                  : `Tirar ${pasta.label}`
              }
              onClick={() => tirar(pasta)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="pastas-add">
        <input
          type="text"
          placeholder="C:\Caminho\Da\Pasta"
          value={nova}
          disabled={busy}
          onChange={(event) => setNova(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') acrescentar()
          }}
        />
        <button className="btn small" disabled={busy || nova.trim() === ''} onClick={acrescentar}>
          ACRESCENTAR
        </button>
        <button className="btn small" disabled={busy || varrendo} onClick={procurar}>
          {varrendo ? 'PROCURANDO…' : 'PROCURAR'}
        </button>
      </div>
    </div>
  )
}

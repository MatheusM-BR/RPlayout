import { useEffect, useRef } from 'react'

const keys: Array<[string, string]> = [
  ['Espaço', 'TAKE sempre: vai ao ar o vídeo em foco, a linha selecionada na grade. Toque duplo é descartado.'],
  ['F2', 'CUE: abre no PVW a linha selecionada ou a próxima'],
  ['↑ / ↓', 'Anda pela grade armando linha a linha'],
  ['Delete', 'Tira da grade a linha selecionada (Backspace não apaga)'],
  ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer edição da grade'],
  ['I', 'Ajustar entrada e saída (trim) do item selecionado'],
  ['N', 'Áudio do item selecionado'],
  ['Esc', 'Desarma o ABORT; com uma janela aberta, fecha a janela'],
  ['F1', 'Este cartão'],
]

/** Glossário curto: um termo, um significado. */
export const glossary: Array<[string, string]> = [
  ['TAKE', 'Leva ao ar (PGM) o que está armado.'],
  ['CUE', 'Arma uma linha: carrega no PVW, sem ir ao ar.'],
  ['PGM', 'Programa: o que está saindo no ar.'],
  ['PVW', 'Preview: o que está armado e ainda não saiu.'],
  ['ALINHAR', 'Ajusta a grade (preenche a sobra ou corta o atraso) para o item em FOCO entrar no horário marcado.'],
  ['FOCO', 'Item marcado (botão direito na linha) para contar quando entra e se a grade chega a tempo. Não é a linha selecionada.'],
]

/** Cartão de atalhos (F1). Também serve de guia para botoeiras (Stream Deck,
 * X-keys): elas só precisam mandar estas teclas com a janela em foco. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="w-full max-w-xl rounded-xl border border-border-strong bg-surface-panel p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="shortcuts-title" className="font-headline-md text-[18px] font-bold uppercase tracking-wide text-on-surface">Atalhos de operação</h2>
          <button ref={closeRef} type="button" className="btn small" onClick={onClose}>FECHAR</button>
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {keys.map(([key, what]) => (
              <tr key={key} className="border-t border-border-subtle">
                <td className="w-36 py-1.5 pr-3 align-top"><kbd className="rounded border border-border-strong bg-surface-container px-1.5 py-0.5 font-label-mono text-[12px] text-on-surface">{key}</kbd></td>
                <td className="py-1.5 text-on-surface-variant">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 mb-1 font-label-caps text-[12px] uppercase tracking-wider text-outline">Glossário</h3>
        <dl data-testid="shortcuts-glossary" className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-[13px]">
          {glossary.map(([term, meaning]) => (
            <div key={term} className="contents">
              <dt className="font-label-mono text-on-surface">{term}</dt>
              <dd className="text-on-surface-variant">{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[12px] text-outline">As teclas não agem enquanto você digita num campo, com uma janela aberta ou com o painel bloqueado. Botoeiras (Stream Deck, X-keys): configure cada botão para enviar a tecla acima, com a janela do RPlayout em foco.</p>
      </div>
    </div>
  )
}

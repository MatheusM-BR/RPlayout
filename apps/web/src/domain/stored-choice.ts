import { useCallback, useState } from 'react'

/** Preferência da estação (aba aberta, painel recolhido, perfil). Só
 * conveniência: se o navegador não guardar, a tela abre no padrão. Enquanto
 * nada foi escolhido, segue o padrão atual (ex.: perfil pelo papel da sessão,
 * que chega depois da primeira renderização). */
export function useStoredChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (value: T) => void] {
  const [chosen, setChosen] = useState<T | null>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored && (allowed as readonly string[]).includes(stored) ? stored as T : null
    } catch { return null }
  })
  const choose = useCallback((next: T) => {
    setChosen(next)
    try { window.localStorage.setItem(key, next) } catch { /* sem armazenamento: só nesta tela */ }
  }, [key])
  return [chosen ?? fallback, choose]
}

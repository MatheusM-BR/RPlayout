import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Todo fundo de modal (fixed inset-0) se anuncia como diálogo modal para
// leitor de tela; a única exceção é a película do painel bloqueado.
it('todo modal de tela cheia tem role=dialog e aria-modal', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files: string[] = []
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.tsx') && !name.includes('.test.')) files.push(path) } }
  walk(root)
  const offenders: string[] = []
  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/<(div|section)\b([^>]*?)className="fixed inset-0[^"]*"/gs)) {
      const tag = match[0]
      if (tag.includes('aria-hidden="true"')) continue
      const ownMarking = /role="(dialog|alertdialog)"/.test(tag) && tag.includes('aria-modal="true"')
      const innerMarking = /^[\s\S]{0,400}?role="(dialog|alertdialog)"[^>]*aria-modal="true"/.test(source.slice(match.index! + tag.length))
      if (!ownMarking && !innerMarking) offenders.push(`${path.slice(root.length)}:${source.slice(0, match.index).split('\n').length}`)
    }
  }
  expect(offenders).toEqual([])
})

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// A caixa nativa congela a tela (relógio, contagens, estado do ar). Toda
// confirmação passa por domain/confirm.ts.
it('nenhuma tela usa window.confirm, confirm() ou alert() nativos', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files: string[] = []
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.endsWith(join('domain', 'confirm.ts'))) files.push(path) } }
  walk(root)
  const offenders = files.filter(path => /(?<![\w.])(window\.)?(confirm|alert)\(/.test(readFileSync(path, 'utf8')))
  expect(offenders.map(path => path.slice(root.length))).toEqual([])
})

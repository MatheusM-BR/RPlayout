import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// O Master mostra a grade no ar (executionView). Teclado e TAKE de ao vivo
// precisam comandar a mesma grade, não a grade editável do dia.
it('setas, Espaço com ao vivo e TAKE de ao vivo usam a grade que está no ar', () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  expect(source).toContain('const operatingView = executionView ?? view')
  expect(source).toContain('const items = operatingView?.items ?? []')
  expect(source).toContain('liveOutsideGrade(preview, operatingView.items')
  expect(source).toContain('const rundownId = onAirGrade.rundown.id')
  expect(source).toContain('view={executionView ?? view}')
})

import {readFileSync} from 'node:fs'
import {it,expect} from 'vitest'

// Source wiring checks, not a substitute for browser/interaction qualification.
it.each(['CategoryEditor','PastasPanel','IntegrationEditor','IntegrationsPanel'])('%s usa confirmação revisada na página, sem chamar caixa nativa',component=>{
  const source=readFileSync(new URL(`../components/${component}.tsx`,import.meta.url),'utf8')
  expect(source).toContain('ReviewedOperationConfirm')
  expect(source).not.toContain('window.confirm')
  expect(source).toContain('reviewKey=')
})
it('remover pasta continua ligado à prova original, autorização e proteção da última raiz',()=>{
  const source=readFileSync(new URL('../components/PastasPanel.tsx',import.meta.url),'utf8')
  expect(source).toContain('review!==removal.review');expect(source).toContain('pastas.length<2')
  expect(source).toContain('api.removeMediaRoot(original.root.id,original.review)')
})

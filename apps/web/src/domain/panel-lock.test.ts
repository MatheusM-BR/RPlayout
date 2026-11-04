import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
describe('B15: BLOQUEAR e transições', () => {
  it('o tooltip aponta onde o aviso realmente aparece', () => {
    const app = read('../App.tsx'), master = read('../views/MasterControlView.tsx')
    expect(app).toMatch(/data-testid="panel-lock-notice" className="fixed right-4 bottom-4/)
    expect(app).not.toMatch(/panel-lock-notice[^>]*left-1\/2/)
    expect(master).toContain('no aviso PAINEL BLOQUEADO, no canto inferior direito da tela')
    expect(master).not.toContain('aviso do topo')
  })
  it('MIX e WIPE desabilitados mostram cursor de bloqueado, não de clique', () => {
    const master = read('../views/MasterControlView.tsx')
    const block = master.slice(master.indexOf("{(['CUT', 'MIX', 'WIPE'] as const).map"), master.indexOf("{(['CUT', 'MIX', 'WIPE'] as const).map") + 1200)
    expect(block).toContain("disabled={mode !== 'CUT'}")
    expect(block).toContain('disabled:cursor-not-allowed')
  })
})

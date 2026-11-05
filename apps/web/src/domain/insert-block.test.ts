import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { assetTone, insertBlockReason, qcStatusLabel } from './insert-block.js'
describe('B16: "Inserir" respeita o QC antes do clique', () => {
  it('pendente, em análise, reprovado, bloqueado e ignorado não inserem e dizem por quê', () => {
    expect(insertBlockReason({ qcStatus: 'PENDING' })).toContain('Pendente de QC')
    expect(insertBlockReason({ qcStatus: 'ANALYSIS' })).toContain('Em análise')
    expect(insertBlockReason({ qcStatus: 'REJECTED' })).toContain('Reprovado')
    expect(insertBlockReason({ qcStatus: 'BLOCKED' })).toContain('Bloqueado')
    expect(insertBlockReason({ qcStatus: 'APPROVED', ignored: true })).toContain('ignorado')
    expect(insertBlockReason({ qcStatus: 'APPROVED', probeError: 'sem vídeo' })).toContain('leitura técnica')
  })
  it('aprovado (com ou sem ressalva) e fonte ao vivo inserem', () => {
    expect(insertBlockReason({ qcStatus: 'APPROVED' })).toBeNull()
    expect(insertBlockReason({ qcStatus: 'APPROVED_WITH_NOTES' })).toBeNull()
    expect(insertBlockReason({ isLiveSource: true })).toBeNull()
  })
  it('rótulos de status iguais aos da grade', () => {
    expect(qcStatusLabel({ qcStatus: 'PENDING' })).toBe('QC PEND.')
    expect(qcStatusLabel({ qcStatus: 'APPROVED' })).toBe('QC OK')
    expect(qcStatusLabel({ qcStatus: 'ANALYSIS' })).toBe('EM ANÁLISE')
  })
  it('a biblioteca da PLAYLIST desabilita o botão com o motivo e mostra o status', () => {
    const view = readFileSync(new URL('../views/PlaylistScheduleView.tsx', import.meta.url), 'utf8')
    expect(view).toContain('disabled={Boolean(insertBlockReason(asset))}')
    expect(view).toContain("title={insertBlockReason(asset) ?? 'Inserir na grade do dia selecionado'}")
    // Sem badges de categoria/QC na linha: bolinha + tarja + legenda no rodapé.
    expect(view).toContain('data-tone={assetTone(asset)}')
    expect(view).toContain('data-testid="mam-category-dot"')
    expect(view).toContain('data-testid="mam-legend"')
    expect(view).not.toContain('data-testid="mam-qc-status"')
    expect(view).toMatch(/const blocked = insertBlockReason\(asset\)\n\s+if \(blocked\) \{ void notify\(blocked\); return \}/)
  })
  it('tarja: laranja para QC pendente/em análise, vermelha para indisponível', () => {
    expect(assetTone({ qcStatus: 'PENDING' })).toBe('pending')
    expect(assetTone({})).toBe('pending')
    expect(assetTone({ qcStatus: 'ANALYSIS' })).toBe('pending')
    expect(assetTone({ qcStatus: 'APPROVED' })).toBe('ok')
    expect(assetTone({ qcStatus: 'APPROVED_WITH_NOTES' })).toBe('ok')
    expect(assetTone({ qcStatus: 'REJECTED' })).toBe('blocked')
    expect(assetTone({ qcStatus: 'APPROVED', ignored: true })).toBe('blocked')
    expect(assetTone({ qcStatus: 'APPROVED', probeError: 'x' })).toBe('blocked')
    expect(assetTone({ isLiveSource: true })).toBe('live')
  })
})

describe('aviso do topo da PLAYLIST', () => {
  const view = readFileSync(new URL('../views/PlaylistScheduleView.tsx', import.meta.url), 'utf8')
  it('não pisca, flutua e some sozinho', () => {
    const banner = view.slice(view.indexOf('data-testid="playlist-feedback"') - 200, view.indexOf('data-testid="playlist-feedback"') + 600)
    expect(banner).not.toContain('animate-pulse')
    expect(banner).toContain('fixed')
    expect(view).toMatch(/setTimeout\(\(\) => setFeedbackMessage\(null\), FEEDBACK_MS\)/)
  })
  it('ignorar vídeo não mostra aviso de sucesso', () => {
    expect(view).not.toContain('marcado como IGNORADO')
  })
})

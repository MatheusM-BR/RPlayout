import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PlaylistsDialog } from '../components/PlaylistsDialog.js'
import { playlistImportTarget, startSeconds } from './playlist-import-target.js'

const rate = { num: 30000, den: 1001 }

describe('importar M3U mostra a grade que recebe a lista', () => {
  it('data e início vêm da grade de destino, não do relógio do navegador', () => {
    expect(playlistImportTarget('2026-11-01', 0, rate)).toEqual({ date: '2026-11-01', start: '00:00:00' })
    // 06:00:00 a 29,97 = 647352,… quadros; meia-quadro de tolerância mantém 06:00:00.
    expect(playlistImportTarget('2026-11-01', Math.round(6 * 3600 * 30000 / 1001), rate).start).toBe('06:00:00')
    expect(playlistImportTarget(null, 0, rate, new Date(2026, 9, 31, 22, 30)).date).toBe('2026-10-31')
  })
  it('início aceita HH:MM e HH:MM:SS', () => {
    expect(startSeconds('06:30')).toBe(23400)
    expect(startSeconds('06:30:15')).toBe(23415)
    expect(startSeconds('xx')).toBe(0)
  })
  it('com a grade de amanhã aberta, o diálogo trava a data nela e não oferece outro dia', () => {
    const html = renderToStaticMarkup(createElement(PlaylistsDialog, { rundownId: 'r', revision: 1, target: { date: '2026-11-01', start: '00:00:00' }, onCancel: () => {}, onLoaded: () => {}, onMessage: () => {} }))
    expect(html).toContain('Grade de destino')
    expect(html).toContain('01/11/2026')
    expect(html).not.toContain('Calendário da programação')
    expect(html).not.toContain('aria-label="próximo dia"')
  })
})

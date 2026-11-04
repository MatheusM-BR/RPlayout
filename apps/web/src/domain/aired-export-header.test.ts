import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { asRunCsv } from './asrun-evidence.js'
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
describe('B13: AIRED e auditoria com fuso coerente e hora inteira', () => {
  it('cabeçalho do CSV do AIRED diz UTC, sem "relógio local"', () => {
    const header = asRunCsv([]).replace(/^﻿/, '').split(/\r?\n/)[0]!
    expect(header).toContain('Início (UTC)')
    expect(header).toContain('Fim (UTC)')
    expect(header).not.toMatch(/rel[oó]gio local/i)
  })
  it('CSV da auditoria não chama UTC de relógio local', () => {
    const audit = read('../components/AuditPanel.tsx')
    expect(audit).toContain("'data (UTC, ISO 8601)'")
    expect(audit).not.toContain('UTC (relógio local)')
  })
  it('campos de hora do período cabem "04:12 AM" (Chromium em inglês) sem cortar', () => {
    const aired = read('../views/AiredView.tsx')
    expect(aired).not.toContain('w-[86px]')
    expect(aired.match(/type="time"[\s\S]{0,700}?w-\[7\.5rem\]/g)).toHaveLength(2)
  })
})

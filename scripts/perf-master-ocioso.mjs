#!/usr/bin/env node
/**
 * Regressão de consumo: conta as requisições HTTP do Master parado.
 *
 * Abre o Master num Chromium (Playwright), espera a tela assentar e conta
 * por 30 s as chamadas a /api feitas pela aba -- primeiro visível, depois
 * oculta. Falha (código 1) se passar da meta de docs/CONSUMO-E-POLLING.md:
 *
 *   visível  < 0,5 requisição/s por aba
 *   oculta   < 0,1 requisição/s por aba (quase zero)
 *
 * Uso (com um servidor de QA no ar, canal criado e, de preferência, no ar):
 *   node scripts/perf-master-ocioso.mjs http://127.0.0.1:4220 [segundos]
 *
 * O WebSocket não conta: TAKE, CUE, tally, relógio e medidores seguem nele.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = process.argv[2] ?? 'http://127.0.0.1:4220'
const seconds = Number(process.argv[3] ?? 30)
const LIMIT_VISIBLE = 0.5, LIMIT_HIDDEN = 0.1

const browser = await chromium.launch()
try {
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  let counting = false
  const seen = new Map()
  page.on('request', request => {
    const url = new URL(request.url())
    if (!counting || !url.pathname.startsWith('/api/')) return
    const key = `${request.method()} ${url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  })
  const measure = async label => {
    seen.clear(); counting = true
    await page.waitForTimeout(seconds * 1000)
    counting = false
    const total = [...seen.values()].reduce((sum, n) => sum + n, 0)
    const rate = total / seconds
    console.log(`${label}: ${total} requisições em ${seconds} s = ${rate.toFixed(2)}/s`)
    for (const [key, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${key}`)
    return rate
  }
  await page.goto(base + '/')
  // Abertura (grade, acervo, primeira leitura de cada painel) não é ociosidade.
  await page.waitForTimeout(10_000)
  const visible = await measure('Master visível')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(2000)
  const hidden = await measure('Master oculto')
  const failures = []
  if (visible >= LIMIT_VISIBLE) failures.push(`visível ${visible.toFixed(2)}/s >= ${LIMIT_VISIBLE}/s`)
  if (hidden >= LIMIT_HIDDEN) failures.push(`oculto ${hidden.toFixed(2)}/s >= ${LIMIT_HIDDEN}/s`)
  if (failures.length) { console.error(`FALHOU: ${failures.join('; ')}`); process.exitCode = 1 }
  else console.log('OK: dentro da meta de consumo do Master parado.')
} finally {
  await browser.close()
}

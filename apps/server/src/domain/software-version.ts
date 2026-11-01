import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Versões do que está rodando, para a tela técnica e o "Exportar saúde". */
export interface SoftwareVersion {
  /**
   * Edição instalada (`RPlayout-1.1-parcial-20261020-r88-35`, do recibo do
   * instalador) ou, num checkout, a versão do package.json.
   */
  rplayout: string
  /** Commit curto quando rodando de um checkout git; ou RPLAYOUT_BUILD do instalador. */
  build: string | null
  node: string
  platform: string
  gstreamer: string | null
  startedAt: string
}
const startedAt = new Date().toISOString()
let cached: SoftwareVersion | null = null
let gstreamer: string | null | undefined

/**
 * O que o instalador gravou na raiz da instalação: `installation-receipt.json`
 * (`edition`, `install-rplayout-partial.ps1`) e `package-manifest.json`
 * (`commit`, `builtAt`; `package-rplayout-1.1.ps1` e
 * `build-streamed-partial-installer.ps1`). A raiz é procurada subindo a partir
 * do servidor e do diretório de trabalho; `RPLAYOUT_INSTALL_ROOT` força uma.
 */
export function installedEdition(starts: readonly string[] = installationStarts()): { edition: string | null; commit: string | null; root: string } | null {
  for (const start of starts) {
    let dir = resolve(start)
    for (let depth = 0; depth < 8; depth++) {
      const receiptFile = join(dir, 'installation-receipt.json'), manifestFile = join(dir, 'package-manifest.json')
      if (existsSync(receiptFile) || existsSync(manifestFile)) {
        const read = (file: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown> } catch { return null } }
        const receipt = read(receiptFile), manifest = read(manifestFile)
        const text = (value: unknown, pattern: RegExp): string | null => typeof value === 'string' && pattern.test(value) ? value : null
        const edition = text(receipt?.edition, /^RPlayout-[A-Za-z0-9.-]+$/) ?? text(manifest?.edition, /^RPlayout-[A-Za-z0-9.-]+$/)
        const commit = text(manifest?.commit, /^[0-9a-f]{7,40}$/i) ?? text(receipt?.commit, /^[0-9a-f]{7,40}$/i)
        if (edition || commit || receipt || manifest) return { edition, commit, root: dir }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}
function installationStarts(): string[] {
  const starts: string[] = []
  if (process.env.RPLAYOUT_INSTALL_ROOT) starts.push(process.env.RPLAYOUT_INSTALL_ROOT)
  try { starts.push(dirname(fileURLToPath(import.meta.url))) } catch { /* bundle sem arquivo */ }
  starts.push(process.cwd())
  return starts
}

function packageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    for (const candidate of [join(here, '..', '..', 'package.json'), join(here, '..', 'package.json')]) {
      try { const value = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown }; if (typeof value.version === 'string') return value.version } catch { /* próximo */ }
    }
  } catch { /* bundle sem import.meta.url de arquivo */ }
  return process.env.npm_package_version ?? 'desconhecida'
}
function buildId(): string | null {
  if (process.env.RPLAYOUT_BUILD) return process.env.RPLAYOUT_BUILD
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], cwd: dirname(fileURLToPath(import.meta.url)) }).toString().trim() || null } catch { return null }
}
/** Lido uma vez (assíncrono, sem travar a partida). */
function probeGstreamer(): void {
  if (gstreamer !== undefined) return
  gstreamer = null
  const bin = process.platform === 'win32' && process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ? join(process.env.GSTREAMER_1_0_ROOT_MSVC_X86_64, 'bin', 'gst-inspect-1.0.exe') : 'gst-inspect-1.0'
  try {
    execFile(bin, ['--version'], { timeout: 3000, windowsHide: true }, (error, stdout) => {
      if (error) return
      const match = /GStreamer\s+([\d.]+)/.exec(String(stdout))
      gstreamer = match ? match[1]! : null
      if (cached) cached = { ...cached, gstreamer }
    })
  } catch { /* sem gst-inspect */ }
}
export function softwareVersion(): SoftwareVersion {
  probeGstreamer()
  if (!cached) {
    // Instalação empacotada: a edição completa e o commit do pacote. Antes
    // a tela técnica dizia "desconhecida" e build nulo no Windows instalado.
    const installed = installedEdition()
    cached = { rplayout: installed?.edition ?? packageVersion(), build: process.env.RPLAYOUT_BUILD || installed?.commit || buildId(), node: process.version, platform: `${process.platform}-${process.arch}`, gstreamer: gstreamer ?? null, startedAt }
  }
  return { ...cached, gstreamer: gstreamer ?? cached.gstreamer }
}

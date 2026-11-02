import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Versões do que está rodando, para a tela técnica e o "Exportar saúde". */
export interface SoftwareVersion {
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
  cached ??= { rplayout: packageVersion(), build: buildId(), node: process.version, platform: `${process.platform}-${process.arch}`, gstreamer: gstreamer ?? null, startedAt }
  return { ...cached, gstreamer: gstreamer ?? cached.gstreamer }
}

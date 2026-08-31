import { resolve } from 'node:path'

export const DB_FILE = process.env.RPLAYOUT_DB ?? resolve(process.cwd(), 'rplayout.db')
export const PORT = Number(process.env.PORT ?? 4000)
export const HOST = process.env.HOST ?? '0.0.0.0'

/**
 * Caminho do binário do engine. Vazio mantém o transporte simulado, que é o
 * que permite operar a grade inteira numa máquina sem GStreamer.
 */
export const ENGINE_BINARY = process.env.RPLAYOUT_ENGINE ?? ''

/** Saídas passadas ao engine, separadas por vírgula. */
export const ENGINE_OUTPUTS = (process.env.RPLAYOUT_ENGINE_OUTPUT ?? 'null')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '')

export const ENGINE_BITRATE_KBPS = Number(process.env.RPLAYOUT_ENGINE_BITRATE ?? 4000)

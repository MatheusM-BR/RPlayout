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

/** Binário do MediaMTX. Vazio desliga o servidor local por completo. */
export const MEDIAMTX_BINARY = process.env.RPLAYOUT_MEDIAMTX ?? ''

/**
 * Em qual interface o servidor local escuta.
 *
 * O padrão é a LAN. Abrir para todas as interfaces é decisão consciente, e a
 * interface avisa quando está assim.
 */
export const MEDIAMTX_BIND = process.env.RPLAYOUT_MEDIAMTX_BIND ?? '0.0.0.0'

/** Nível de log do servidor local. `info` mostra por que uma conexão caiu. */
export const MEDIAMTX_LOGLEVEL = process.env.RPLAYOUT_MEDIAMTX_LOGLEVEL ?? 'warn'

/** Binário do relay, um processo por destino externo. */
export const RELAY_BINARY = process.env.RPLAYOUT_RELAY ?? ''

/** Binário da sonda de mídia. Vazio desliga a varredura do acervo. */
export const PROBE_BINARY = process.env.RPLAYOUT_PROBE ?? ''

/** Pasta que a varredura percorre. */
export const MEDIA_ROOT = process.env.RPLAYOUT_MEDIA ?? resolve(process.cwd(), 'midia')

/** Onde as miniaturas geradas ficam. Cache: pode ser apagada a qualquer hora. */
export const THUMBNAIL_DIR = process.env.RPLAYOUT_THUMBS ?? resolve(process.cwd(), '.thumbs')

/** Onde ficam as cópias de segurança do banco. */
export const BACKUP_DIR = process.env.RPLAYOUT_BACKUPS ?? resolve(process.cwd(), 'backups')

/**
 * De quantas em quantas horas o banco é copiado sozinho. Zero desliga.
 *
 * O padrão é diário: um playout que roda meses sem ninguém olhar precisa de
 * cópia sem depender de alguém lembrar de pedir.
 */
export const BACKUP_EVERY_HOURS = Number(process.env.RPLAYOUT_BACKUP_HOURS ?? '24')

/** Binário de descoberta de fontes ao vivo. Vazio deixa só os convidados. */
export const DEVICES_BINARY = process.env.RPLAYOUT_DEVICES ?? ''

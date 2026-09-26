import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const DB_FILE = process.env.RPLAYOUT_DB ?? resolve(process.cwd(), 'rplayout.db')
export const PORT = Number(process.env.PORT ?? 4000)
export const HOST = process.env.HOST ?? '0.0.0.0'

function findBinary(name: string): string {
  if (process.env.VITEST) return ''
  const candidates = [
    resolve(process.cwd(), `apps/engine/target/release/${name}.exe`),
    resolve(process.cwd(), `apps/engine/target/debug/${name}.exe`),
    resolve(process.cwd(), `../../apps/engine/target/release/${name}.exe`),
    resolve(process.cwd(), `../../apps/engine/target/debug/${name}.exe`),
    resolve(process.cwd(), `target/release/${name}.exe`),
    resolve(process.cwd(), `target/debug/${name}.exe`),
    `C:/IA/RPlayout/apps/engine/target/release/${name}.exe`,
    `C:/IA/RPlayout/apps/engine/target/debug/${name}.exe`,
    resolve(process.cwd(), `${name}.exe`),
  ]
  return candidates.find((p) => existsSync(p)) ?? ''
}

/**
 * Caminho do binário do engine. Vazio mantém o transporte simulado, que é o
 * que permite operar a grade inteira numa máquina sem GStreamer.
 */
export const ENGINE_BINARY = process.env.RPLAYOUT_ENGINE ?? findBinary('rplayout-engine')

/** Saídas passadas ao engine, separadas por vírgula. */
export const ENGINE_OUTPUTS = (process.env.RPLAYOUT_ENGINE_OUTPUT ?? 'null')
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '')

/**
 * Bitrate forçado por variável de ambiente, quando alguém tem motivo.
 *
 * Nulo quer dizer "calcule pelo formato do canal", que é o certo na maioria
 * esmagadora dos casos: um número fixo era generoso num 480p30 e pobre num
 * 1080p50, e imagem com bloco não se resolve mudando de placa.
 */
export const ENGINE_BITRATE_KBPS_EXPLICITO =
  process.env.RPLAYOUT_ENGINE_BITRATE === undefined
    ? null
    : Number(process.env.RPLAYOUT_ENGINE_BITRATE)

/** Binário do MediaMTX. Vazio desliga o servidor local por completo. */
const defaultMediamtx = [
  resolve(process.cwd(), 'mediamtx', 'mediamtx.exe'),
  resolve(process.cwd(), '..', '..', 'mediamtx', 'mediamtx.exe'),
  'C:/IA/RPlayout/mediamtx/mediamtx.exe',
].find((p) => existsSync(p)) ?? ''

export const MEDIAMTX_BINARY = process.env.RPLAYOUT_MEDIAMTX ?? defaultMediamtx

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
export const RELAY_BINARY = process.env.RPLAYOUT_RELAY ?? findBinary('rplayout-relay')

/** Binário da sonda de mídia. Vazio desliga a varredura do acervo. */
export const PROBE_BINARY = process.env.RPLAYOUT_PROBE ?? findBinary('rplayout-probe')

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
export const HEALTH_RETENTION_DAYS = Number(process.env.RPLAYOUT_HEALTH_RETENTION_DAYS ?? '30')
/** Preenchimento contínuo opt-in; desativado por padrão para preservar controle manual. */

/** Binário de descoberta de fontes ao vivo. Vazio deixa só os convidados. */
export const DEVICES_BINARY = process.env.RPLAYOUT_DEVICES ?? findBinary('rplayout-devices')

/** Papel padrão desta estação; pode ser substituído por sessão autenticada. */
// A estação local inicia como administrador para que o primeiro operador
// consiga criar as contas reais. Em produção, defina RPLAYOUT_ROLE ou use
// autenticação; o valor não substitui a sessão autenticada.
export const DEFAULT_ROLE = process.env.RPLAYOUT_ROLE ?? 'ADMIN'
export const AUTH_USER = process.env.RPLAYOUT_ADMIN_USER ?? ''
export const AUTH_PASSWORD = process.env.RPLAYOUT_ADMIN_PASSWORD ?? ''
/** Token dedicado a automações GPI/ATEM/routers; vazio desativa a porta lógica. */
export const EXTERNAL_CONTROL_TOKEN = process.env.RPLAYOUT_CONTROL_TOKEN ?? ''
/** URL base do segundo host para heartbeat N+1; vazio desativa o peer. */
export const N1_PEER_URL = process.env.RPLAYOUT_N1_PEER ?? ''
export const CONTINUITY_CACHE_MAX_BYTES = Number(process.env.RPLAYOUT_CACHE_MAX_BYTES ?? String(100 * 1024 * 1024 * 1024))

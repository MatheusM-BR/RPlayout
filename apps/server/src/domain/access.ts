import { createHash, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import { AUTH_USER, AUTH_PASSWORD, DEFAULT_ROLE } from '../config.js'
import { parseRole, type Role } from './permissions.js'

export interface AccessRequest { headers: Record<string, string | string[] | undefined>; ip?: string }
export const normalizedIp = (ip: string) => ip.startsWith('::ffff:') ? ip.slice(7) : ip
function readList(value: string | null): string[] | null {
  if (value === null) return null
  const list: unknown = JSON.parse(value)
  if (!Array.isArray(list) || list.some(value => typeof value !== 'string')) throw new Error('Política de acesso inválida.')
  return list
}
export const sessionDigest = (token: string) => createHash('sha256').update(token).digest('hex')
export function sessionToken(request: AccessRequest): string | null {
  const cookie = typeof request.headers.cookie === 'string' ? request.headers.cookie : ''
  return cookie.split(';').map(part => part.trim()).find(part => part.startsWith('rplayout_session='))?.slice(17) || null
}
export function secretEquals(received: string, expected: string): boolean {
  const left = Buffer.from(received), right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
export function trustedOrigin(origin: string | undefined, host: string | undefined, extras: readonly string[] = []): boolean {
  if (!origin) return true // CLI/service requests still need authentication.
  if (extras.includes(origin)) return true
  try { const parsed = new URL(origin); return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === host && parsed.origin === origin } catch { return false }
}

/** Sessions are read on every command, so disabling/revoking takes effect now. */
export class AccessControl {
  constructor(private readonly sqlite: Database.Database) {}
  required(): boolean {
    // Disabling every user must not reopen anonymous administrator mode.
    return Boolean(AUTH_USER && AUTH_PASSWORD) || Boolean(this.sqlite.prepare('SELECT 1 FROM users LIMIT 1').get())
  }
  identity(request: AccessRequest): { id: string; username: string; role: Role; expiresAt: string; channelIds: string[] | null; stationIps: string[] | null } | null {
    const token = sessionToken(request)
    if (!token || token.length > 256) return null
    const row = this.sqlite.prepare(`SELECT u.id, u.username, u.role, s.expires_at AS expiresAt FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.enabled=1`)
      .get(sessionDigest(token), new Date().toISOString()) as { id: string; username: string; role: string; expiresAt: string } | undefined
    if (!row) return null
    try {
      const policy = this.policy(row.id)
      if (policy.stationIps !== null && !policy.stationIps.includes(normalizedIp(request.ip ?? ''))) return null
      return { ...row, role: parseRole(row.role), ...policy }
    } catch { return null }
  }
  policy(userId: string): { channelIds: string[] | null; stationIps: string[] | null } {
    const policy = this.sqlite.prepare('SELECT channel_ids, station_ips FROM user_access WHERE user_id=?').get(userId) as { channel_ids: string | null; station_ips: string | null } | undefined
    return policy ? { channelIds: readList(policy.channel_ids), stationIps: readList(policy.station_ips) } : { channelIds: null, stationIps: null }
  }
  channelAllowed(request: AccessRequest, channelId: string): boolean {
    const identity = this.identity(request)
    return identity ? identity.channelIds === null || identity.channelIds.includes(channelId) : !this.required()
  }
  role(request: AccessRequest): Role {
    const identity = this.identity(request)
    if (identity) return identity.role
    if (this.required()) return 'OPERATOR'
    const base = parseRole(DEFAULT_ROLE), requested = parseRole(request.headers['x-rplayout-role'] ?? base)
    const order: Role[] = ['OPERATOR', 'PROGRAMMER', 'SUPERVISOR', 'ADMIN']
    // A caller can voluntarily restrict its local role, never raise it.
    return order.indexOf(requested) < order.indexOf(base) ? requested : base
  }
}

import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { Channel, Scan } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { outputProfiles } from '../db/schema.js'
import { MediaMtx, type ChannelPaths } from './mediamtx.js'

export type OutputRole = 'PROGRAM' | 'PREVIEW' | 'EXTRA'
export type OutputKind = 'RTMP' | 'SRT' | 'FILE'

export interface OutputProfileRow {
  id: string
  channelId: string
  name: string
  kind: OutputKind
  target: string
  role: OutputRole
  width: number | null
  height: number | null
  rateNum: number | null
  rateDen: number | null
  scan: Scan | null
  bitrateKbps: number | null
  enabled: boolean
  createdAt: string
}

/**
 * O que o engine recebe por saída.
 *
 * Campo em branco herda do canal. É o que permite mudar só o bitrate de um
 * destino sem ter que repetir geometria e cadência -- e é o que faz o valor
 * herdado acompanhar quando o canal muda de formato.
 */
interface EngineProfile {
  kind: 'rtmp' | 'srt' | 'file'
  target: string
  width?: number
  height?: number
  rateNum?: number
  rateDen?: number
  scan?: 'progressive' | 'interlaced'
  bitrateKbps?: number
}

export async function listOutputs(db: Db, channelId: string): Promise<OutputProfileRow[]> {
  return (await db
    .select()
    .from(outputProfiles)
    .where(eq(outputProfiles.channelId, channelId))
    .orderBy(asc(outputProfiles.createdAt))) as OutputProfileRow[]
}

/**
 * Garante que o canal tenha os perfis que o sistema mantém.
 *
 * Programa e preview existem sempre que há servidor de mídia local: o operador
 * não escolhe o destino deles, mas escolhe como saem. Criar aqui, e não no
 * seed, é o que faz um canal novo já nascer com eles.
 */
export async function ensureManagedOutputs(
  db: Db,
  channel: Channel,
  path: ChannelPaths | undefined,
): Promise<void> {
  if (!path) return

  const existing = await listOutputs(db, channel.id)
  const managed: { role: OutputRole; name: string; defaults: Partial<OutputProfileRow> }[] = [
    { role: 'PROGRAM', name: 'Programa', defaults: {} },
    {
      role: 'PREVIEW',
      name: 'Preview',
      // Metade do tamanho e um terço do bitrate: é um monitor, não uma saída.
      defaults: {
        width: Math.max(2, (channel.width / 2) & ~1),
        height: Math.max(2, (channel.height / 2) & ~1),
        bitrateKbps: 1500,
      },
    },
  ]

  for (const entry of managed) {
    if (existing.some((row) => row.role === entry.role)) continue
    await db.insert(outputProfiles).values({
      id: randomUUID(),
      channelId: channel.id,
      name: entry.name,
      kind: 'RTMP',
      // Destino dos gerenciados é derivado, não guardado: o caminho no servidor
      // muda quando o canal é renomeado, e um valor gravado ficaria para trás.
      target: '',
      role: entry.role,
      width: null,
      height: null,
      rateNum: null,
      rateDen: null,
      scan: null,
      bitrateKbps: null,
      enabled: true,
      createdAt: new Date().toISOString(),
      ...entry.defaults,
    })
  }
}

/** Destino real de um perfil: derivado para os gerenciados, guardado nos demais. */
export function targetOf(row: OutputProfileRow, path: ChannelPaths | undefined): string | null {
  if (row.role === 'PROGRAM') return path ? MediaMtx.loopback(path.program) : null
  if (row.role === 'PREVIEW') return path ? MediaMtx.loopback(path.preview) : null
  return row.target || null
}

/** Traduz um perfil para o que o engine entende. Nulo quando não dá para sair. */
export function toEngineProfile(
  row: OutputProfileRow,
  path: ChannelPaths | undefined,
): EngineProfile | null {
  const target = targetOf(row, path)
  if (!target || !row.enabled) return null

  return {
    kind: row.kind.toLowerCase() as EngineProfile['kind'],
    target,
    ...(row.width !== null ? { width: row.width } : {}),
    ...(row.height !== null ? { height: row.height } : {}),
    ...(row.rateNum !== null ? { rateNum: row.rateNum } : {}),
    ...(row.rateDen !== null ? { rateDen: row.rateDen } : {}),
    ...(row.scan !== null
      ? { scan: row.scan === 'INTERLACED' ? ('interlaced' as const) : ('progressive' as const) }
      : {}),
    ...(row.bitrateKbps !== null ? { bitrateKbps: row.bitrateKbps } : {}),
  }
}

export const encodeProfile = (profile: EngineProfile): string => JSON.stringify(profile)

export async function createOutput(
  db: Db,
  channelId: string,
  values: Pick<OutputProfileRow, 'name' | 'kind' | 'target'> & Partial<OutputProfileRow>,
): Promise<OutputProfileRow> {
  const row = {
    id: randomUUID(),
    channelId,
    role: 'EXTRA' as const,
    width: null,
    height: null,
    rateNum: null,
    rateDen: null,
    scan: null,
    bitrateKbps: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...values,
  }
  await db.insert(outputProfiles).values(row)
  return row as OutputProfileRow
}

export async function updateOutput(
  db: Db,
  id: string,
  values: Partial<OutputProfileRow>,
): Promise<void> {
  // Destino de perfil gerenciado não é do operador: ele vem do servidor de
  // mídia, e deixar editar só criaria um valor que o sistema ignora.
  const [row] = await db.select().from(outputProfiles).where(eq(outputProfiles.id, id)).limit(1)
  if (!row) return
  const patch = { ...values }
  if (row.role !== 'EXTRA') {
    delete patch.target
    delete patch.kind
  }
  delete patch.id
  delete patch.channelId
  delete patch.role
  await db.update(outputProfiles).set(patch).where(eq(outputProfiles.id, id))
}

/** Remove um perfil. Os gerenciados não saem: o canal precisa deles. */
export async function deleteOutput(db: Db, id: string): Promise<boolean> {
  const result = await db
    .delete(outputProfiles)
    .where(and(eq(outputProfiles.id, id), eq(outputProfiles.role, 'EXTRA')))
    .returning({ id: outputProfiles.id })
  return result.length > 0
}

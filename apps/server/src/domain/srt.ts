import { randomUUID } from 'node:crypto'
import { eq, or } from 'drizzle-orm'
import {
  buildSrtUri,
  parseSrtUri,
  maskPassphrase,
  sanitizeSrtConfig,
  classifySrtLinkState,
  type FailoverConfig,
  type MultiviewCell,
  type MultiviewLayout,
  type RedundancyRole,
  type SrtConfig,
  type SrtTelemetry,
} from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { liveSources, multiviewConfigs } from '../db/schema.js'

export {
  buildSrtUri,
  parseSrtUri,
  maskPassphrase,
  sanitizeSrtConfig,
  classifySrtLinkState,
  type SrtConfig,
  type SrtTelemetry,
  type FailoverConfig,
  type MultiviewCell,
  type MultiviewLayout,
  type RedundancyRole,
}

export interface LiveSourceRecord {
  id: string
  channelId: string
  name: string
  kind: 'SRT' | 'RTMP' | 'SDI' | 'NDI'
  targetUrl: string
  srtConfig: SrtConfig | null
  role: RedundancyRole
  pairedSourceId: string | null
  autoFailover: boolean
  failoverConfig: FailoverConfig | null
  enabled: boolean
  createdAt: string
}

export interface CreateLiveSourceInput {
  channelId: string
  name: string
  kind: 'SRT' | 'RTMP' | 'SDI' | 'NDI'
  targetUrl?: string
  srtConfig?: SrtConfig
  role?: RedundancyRole
  pairedSourceId?: string
  autoFailover?: boolean
  failoverConfig?: Partial<FailoverConfig>
  enabled?: boolean
}

export interface UpdateLiveSourceInput {
  name?: string
  kind?: 'SRT' | 'RTMP' | 'SDI' | 'NDI'
  targetUrl?: string
  srtConfig?: SrtConfig
  role?: RedundancyRole
  pairedSourceId?: string | null
  autoFailover?: boolean
  failoverConfig?: Partial<FailoverConfig> | null
  enabled?: boolean
}

export const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  autoFailover: true,
  maxLossPercent: 15.0,
  maxTimeoutMs: 1500,
  maxRttMs: 2400,
  switchDelayMs: 120,
}

export interface FailoverEvent {
  sourceId: string
  pairedSourceId: string | null
  fromRole: RedundancyRole
  toRole: RedundancyRole
  reason: string
  timestamp: string
  operator?: string
  automatic: boolean
}

/**
 * Gerenciador de Failover e Redundância Primário/Backup com comutação limpa (glitch-free hold).
 */
export class FailoverManager {
  private activeRoles = new Map<string, RedundancyRole>() // sourceId ou pairId -> role
  private lastOptimalTimestamp = new Map<string, number>()
  private listeners: ((event: FailoverEvent) => void)[] = []

  onFailover(callback: (event: FailoverEvent) => void) {
    this.listeners.push(callback)
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback)
    }
  }

  getActiveRole(sourceId: string, defaultRole: RedundancyRole = 'PRIMARY'): RedundancyRole {
    return this.activeRoles.get(sourceId) ?? defaultRole
  }

  setActiveRole(sourceId: string, role: RedundancyRole) {
    this.activeRoles.set(sourceId, role)
  }

  /**
   * Avalia a telemetria do stream ativo para decidir comutação autônoma de contingência.
   * Critérios conforme SPEC-FASE-B-ENTRADAS-DISTRIBUICAO:
   * 1. Perda de sinal > maxTimeoutMs (ex: 1500ms)
   * 2. Perda de pacotes acumulada > maxLossPercent (ex: 15%)
   * 3. RTT excessivo > maxRttMs
   */
  evaluateHealth(
    source: LiveSourceRecord,
    currentTelemetry: SrtTelemetry | null,
    now = Date.now(),
    hysterisMs = 30000,
  ): { switchNeeded: boolean; targetRole?: RedundancyRole; reason?: string } {
    const config = source.failoverConfig ?? DEFAULT_FAILOVER_CONFIG
    const currentRole = this.getActiveRole(source.id, source.role)

    // Se autoFailover estiver desabilitado, não faz comutação autônoma
    if (!config.autoFailover || !source.autoFailover) {
      return { switchNeeded: false }
    }

    if (currentRole === 'PRIMARY') {
      // Se telemetria estiver ausente ou desconectada
      if (!currentTelemetry || currentTelemetry.linkState === 'DISCONNECTED') {
        return {
          switchNeeded: true,
          targetRole: 'BACKUP',
          reason: `Sinal primário desconectado ou ausente por mais de ${config.maxTimeoutMs}ms (watchdog)`,
        }
      }

      // Verificação de taxa de perda crítica
      if (currentTelemetry.packetLossPercent >= config.maxLossPercent) {
        return {
          switchNeeded: true,
          targetRole: 'BACKUP',
          reason: `Perda de pacotes crítica (${currentTelemetry.packetLossPercent.toFixed(1)}% >= ${config.maxLossPercent}%)`,
        }
      }

      // Verificação de RTT limite
      if (currentTelemetry.rttMs >= config.maxRttMs) {
        return {
          switchNeeded: true,
          targetRole: 'BACKUP',
          reason: `RTT excedeu tolerância limite (${currentTelemetry.rttMs}ms >= ${config.maxRttMs}ms)`,
        }
      }

      this.lastOptimalTimestamp.set(source.id, now)
      return { switchNeeded: false }
    } else {
      // Estamos operando em BACKUP
      if (currentTelemetry && currentTelemetry.linkState === 'OPTIMAL') {
        const firstOpt = this.lastOptimalTimestamp.get(source.id) ?? now
        if (!this.lastOptimalTimestamp.has(source.id)) {
          this.lastOptimalTimestamp.set(source.id, now)
        }
        // Se o primário estiver estável por tempo de histerese (padrão 30s)
        if (now - firstOpt >= hysterisMs) {
          return {
            switchNeeded: true,
            targetRole: 'PRIMARY',
            reason: `Primário restabelecido e estável por ${Math.round((now - firstOpt) / 1000)}s (Auto-Revert)`,
          }
        }
      } else {
        this.lastOptimalTimestamp.delete(source.id)
      }
      return { switchNeeded: false }
    }
  }

  /**
   * Executa a comutação de redundância (Manual ou Automática).
   */
  triggerSwitch(
    source: LiveSourceRecord,
    targetRole: RedundancyRole,
    reason: string,
    options: { operator?: string; automatic?: boolean } = {},
  ): FailoverEvent {
    const fromRole = this.getActiveRole(source.id, source.role)
    this.setActiveRole(source.id, targetRole)

    const event: FailoverEvent = {
      sourceId: source.id,
      pairedSourceId: source.pairedSourceId,
      fromRole,
      toRole: targetRole,
      reason,
      timestamp: new Date().toISOString(),
      operator: options.operator,
      automatic: options.automatic ?? false,
    }

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[FailoverManager] Erro no callback de evento:', err)
      }
    }

    return event
  }
}

/**
 * Gerenciador de Sockets e Telemetria SRT em Tempo Real.
 */
export class SrtManager {
  private telemetryMap = new Map<string, SrtTelemetry>()
  readonly failover = new FailoverManager()

  recordTelemetry(sourceId: string, telemetry: SrtTelemetry) {
    this.telemetryMap.set(sourceId, {
      ...telemetry,
      timestamp: telemetry.timestamp ?? new Date().toISOString(),
    })
  }

  getTelemetry(sourceId: string): SrtTelemetry | undefined {
    return this.telemetryMap.get(sourceId)
  }

  getAllTelemetry(): Record<string, SrtTelemetry> {
    const res: Record<string, SrtTelemetry> = {}
    for (const [id, tel] of this.telemetryMap.entries()) {
      res[id] = tel
    }
    return res
  }

  clearTelemetry(sourceId: string) {
    this.telemetryMap.delete(sourceId)
  }
}

export const globalSrtManager = new SrtManager()

// Operações de Banco de Dados para LiveSources e Multiview

export async function listLiveSources(
  db: Db,
  channelId?: string,
  includePassphrase = false,
): Promise<LiveSourceRecord[]> {
  const query = channelId
    ? db.select().from(liveSources).where(eq(liveSources.channelId, channelId))
    : db.select().from(liveSources)

  const rows = await query
  return rows.map((row) => {
    let srt = row.srtConfig
    if (srt && !includePassphrase) {
      srt = sanitizeSrtConfig(srt)
    }
    return {
      id: row.id,
      channelId: row.channelId,
      name: row.name,
      kind: row.kind,
      targetUrl: row.targetUrl,
      srtConfig: srt,
      role: row.role,
      pairedSourceId: row.pairedSourceId,
      autoFailover: row.autoFailover,
      failoverConfig: row.failoverConfig,
      enabled: row.enabled,
      createdAt: row.createdAt,
    }
  })
}

export async function getLiveSource(
  db: Db,
  id: string,
  includePassphrase = false,
): Promise<LiveSourceRecord | null> {
  const rows = await db.select().from(liveSources).where(eq(liveSources.id, id))
  const row = rows[0]
  if (!row) return null
  let srt = row.srtConfig
  if (srt && !includePassphrase) {
    srt = sanitizeSrtConfig(srt)
  }
  return {
    id: row.id,
    channelId: row.channelId,
    name: row.name,
    kind: row.kind,
    targetUrl: row.targetUrl,
    srtConfig: srt,
    role: row.role,
    pairedSourceId: row.pairedSourceId,
    autoFailover: row.autoFailover,
    failoverConfig: row.failoverConfig,
    enabled: row.enabled,
    createdAt: row.createdAt,
  }
}

export async function createLiveSource(
  db: Db,
  input: CreateLiveSourceInput,
): Promise<LiveSourceRecord> {
  const id = `live-${randomUUID()}`
  let targetUrl = input.targetUrl ?? ''

  // Se for SRT e srtConfig estiver preenchido, compõe a URI padrão se targetUrl não for dada
  if (input.kind === 'SRT' && input.srtConfig) {
    if (!targetUrl) {
      targetUrl = buildSrtUri(input.srtConfig)
    }
  }

  const failoverConfig: FailoverConfig = {
    ...DEFAULT_FAILOVER_CONFIG,
    ...(input.failoverConfig ?? {}),
  }

  const now = new Date().toISOString()
  const record: typeof liveSources.$inferInsert = {
    id,
    channelId: input.channelId,
    name: input.name,
    kind: input.kind,
    targetUrl,
    srtConfig: input.srtConfig ?? null,
    role: input.role ?? 'PRIMARY',
    pairedSourceId: input.pairedSourceId ?? null,
    autoFailover: input.autoFailover ?? true,
    failoverConfig,
    enabled: input.enabled ?? true,
    createdAt: now,
  }

  await db.insert(liveSources).values(record)
  return getLiveSource(db, id, false) as Promise<LiveSourceRecord>
}

export async function updateLiveSource(
  db: Db,
  id: string,
  input: UpdateLiveSourceInput,
): Promise<LiveSourceRecord | null> {
  const existing = await getLiveSource(db, id, true)
  if (!existing) return null

  const updates: Partial<typeof liveSources.$inferInsert> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.kind !== undefined) updates.kind = input.kind
  if (input.enabled !== undefined) updates.enabled = input.enabled
  if (input.role !== undefined) updates.role = input.role
  if (input.pairedSourceId !== undefined) updates.pairedSourceId = input.pairedSourceId
  if (input.autoFailover !== undefined) updates.autoFailover = input.autoFailover

  if (input.srtConfig !== undefined) {
    updates.srtConfig = input.srtConfig
    if (input.kind === 'SRT' || existing.kind === 'SRT') {
      if (input.targetUrl === undefined && input.srtConfig) {
        updates.targetUrl = buildSrtUri(input.srtConfig)
      }
    }
  }

  if (input.targetUrl !== undefined) {
    updates.targetUrl = input.targetUrl
  }

  if (input.failoverConfig !== undefined) {
    updates.failoverConfig = input.failoverConfig
      ? { ...DEFAULT_FAILOVER_CONFIG, ...input.failoverConfig }
      : null
  }

  await db.update(liveSources).set(updates).where(eq(liveSources.id, id))
  return getLiveSource(db, id, false)
}

export async function deleteLiveSource(db: Db, id: string): Promise<boolean> {
  const result = await db.delete(liveSources).where(eq(liveSources.id, id))
  return true
}

export async function getMultiviewConfig(
  db: Db,
  channelId?: string,
): Promise<{ id: string; channelId: string | null; layout: MultiviewLayout; cells: MultiviewCell[]; updatedAt: string }> {
  const targetId = channelId ? `mv-${channelId}` : 'mv-default'
  const rows = await db.select().from(multiviewConfigs).where(eq(multiviewConfigs.id, targetId))
  const row = rows[0]

  if (row) {
    return {
      id: row.id,
      channelId: row.channelId,
      layout: row.layout,
      cells: row.cells ?? [],
      updatedAt: row.updatedAt,
    }
  }

  return {
    id: targetId,
    channelId: channelId ?? null,
    layout: 'GRID_2X2',
    cells: [],
    updatedAt: new Date().toISOString(),
  }
}

export async function saveMultiviewConfig(
  db: Db,
  channelId: string | undefined,
  layout: MultiviewLayout,
  cells: MultiviewCell[],
): Promise<{ id: string; channelId: string | null; layout: MultiviewLayout; cells: MultiviewCell[]; updatedAt: string }> {
  const targetId = channelId ? `mv-${channelId}` : 'mv-default'
  const now = new Date().toISOString()

  const existing = await db.select().from(multiviewConfigs).where(eq(multiviewConfigs.id, targetId))
  if (existing.length > 0) {
    await db
      .update(multiviewConfigs)
      .set({
        layout,
        cells,
        updatedAt: now,
      })
      .where(eq(multiviewConfigs.id, targetId))
  } else {
    await db.insert(multiviewConfigs).values({
      id: targetId,
      channelId: channelId ?? null,
      layout,
      cells,
      updatedAt: now,
    })
  }

  return {
    id: targetId,
    channelId: channelId ?? null,
    layout,
    cells,
    updatedAt: now,
  }
}

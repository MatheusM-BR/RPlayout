/**
 * Concorrência e Bloqueio Otimista Broadcast (Fase E)
 *
 * Suporte a:
 * - Versionamento de rundown e linhas (ETag / If-Match)
 * - Bloqueios de linha (soft lock / hard lock)
 * - Detecção e resolução de conflitos (Conflict Drawer)
 * - Eventos de presença de operadores
 */

export interface RundownLockState {
  readonly version: number
  readonly lockedByUserId?: string
  readonly lockedAt?: string
  readonly lineLocks: Record<string, string>
}

export interface ConflictItem {
  readonly itemId: string
  readonly field: string
  readonly clientValue: unknown
  readonly serverValue: unknown
}

export interface ConflictResolutionData {
  readonly baseVersion: number
  readonly serverVersion: number
  readonly clientVersion: number
  readonly conflicts: ConflictItem[]
}

export type ConflictResolutionStrategy =
  | 'OVERWRITE_FORCE'
  | 'DISCARD_MINE'
  | 'APPLY_MERGED_FIELDS'

export interface ConflictResolutionDecision {
  readonly conflictId?: string
  readonly itemId: string
  readonly clientRundownVersion: number
  readonly resolutionStrategy: ConflictResolutionStrategy
  readonly mergedData?: Record<string, unknown>
}

export interface OptimisticLockErrorPayload {
  readonly error: 'OPTIMISTIC_LOCK_CONFLICT'
  readonly message: string
  readonly conflictId: string
  readonly currentRundownVersion: number
  readonly currentLineVersion?: number
  readonly serverItemState?: Record<string, unknown>
  readonly conflicts?: ConflictItem[]
}

export type UserRole = 'MCR_OPERATOR' | 'PRODUCER' | 'TRAFFIC' | 'ADMIN'

export interface UserFocusEvent {
  readonly type: 'RUNDOWN_USER_FOCUS'
  readonly tenantId?: string
  readonly channelId?: string
  readonly rundownId: string
  readonly itemId?: string
  readonly userId: string
  readonly userName: string
  readonly userRole?: UserRole
  readonly timestampMs: number
}

export interface ItemUpdatedEvent {
  readonly type: 'RUNDOWN_ITEM_UPDATED'
  readonly tenantId?: string
  readonly channelId?: string
  readonly rundownId: string
  readonly newRundownVersion: number
  readonly item: {
    readonly id: string
    readonly lineVersion: number
    readonly title: string
    readonly durationMs?: number
    readonly timingType?: string
    readonly secondaryEventsCount?: number
    readonly updatedBy?: string
  }
}

export interface StructureChangedEvent {
  readonly type: 'RUNDOWN_STRUCTURE_CHANGED'
  readonly tenantId?: string
  readonly channelId?: string
  readonly rundownId: string
  readonly newRundownVersion: number
  readonly action: 'INSERT' | 'DELETE' | 'MOVE'
  readonly affectedItemIds: string[]
  readonly updatedBy?: string
}

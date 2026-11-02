import { randomUUID } from 'node:crypto'
import type {EditorialVersions} from '../db/editorial-revisions.js'
import type {
  ConflictItem,
  ConflictResolutionData,
  ConflictResolutionDecision,
  OptimisticLockErrorPayload,
  RundownLockState,
  UserFocusEvent,
} from '@rplayout/protocol'

interface LineLock {
  userId: string
  userName: string
  acquiredAt: string
  expiresAt: string
}

interface RundownLock {
  userId: string
  userName: string
  acquiredAt: string
  expiresAt: string
}

export type ConcurrencyListener = (event: unknown) => void

/**
 * Gerenciador de concorrência e bloqueio otimista de Rundowns broadcast.
 * A aplicação lê revisões duráveis do SQLite; os mapas são apenas fallback
 * para instâncias isoladas sem banco. Soft locks são avisos locais ao processo,
 * não locks distribuídos nem uma condição de segurança da escrita.
 */
export class ConcurrencyManager {
  constructor(private readonly versions?:EditorialVersions){}
  private readonly rundownVersions = new Map<string, number>()
  private readonly lineVersions = new Map<string, Map<string, number>>()
  private readonly lineLocks = new Map<string, Map<string, LineLock>>()
  private readonly rundownLocks = new Map<string, RundownLock>()
  private readonly listeners = new Set<ConcurrencyListener>()

  private readonly lockTtlMs = 30_000 // 30 segundos de soft-lock

  subscribe(listener: ConcurrencyListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  broadcast(event: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignora erros de listeners
      }
    }
  }

  getRundownVersion(rundownId: string): number {
    if(this.versions)return this.versions.read(rundownId)
    return this.rundownVersions.get(rundownId) ?? 1
  }

  incrementRundownVersion(rundownId: string): number {
    if(this.versions)throw new Error('Revisões persistentes são incrementadas pela escrita no banco, não em memória.')
    const next = (this.rundownVersions.get(rundownId) ?? 1) + 1
    this.rundownVersions.set(rundownId, next)
    return next
  }

  getLineVersion(rundownId: string, itemId: string): number {
    if(this.versions)return this.versions.read(rundownId,itemId)
    const map = this.lineVersions.get(rundownId)
    return map?.get(itemId) ?? 1
  }

  incrementLineVersion(rundownId: string, itemId: string): number {
    if(this.versions)throw new Error('Revisões persistentes são incrementadas pela escrita no banco, não em memória.')
    let map = this.lineVersions.get(rundownId)
    if (!map) {
      map = new Map<string, number>()
      this.lineVersions.set(rundownId, map)
    }
    const next = (map.get(itemId) ?? 1) + 1
    map.set(itemId, next)
    return next
  }

  generateETag(rundownId: string, itemId?: string): string {
    const rVer = this.getRundownVersion(rundownId)
    if (itemId) {
      const lVer = this.getLineVersion(rundownId, itemId)
      return `w/"${rVer}-${lVer}"`
    }
    return `w/"${rVer}"`
  }

  parseETag(eTag: string): { rundownVersion?: number; lineVersion?: number } | null {
    const match = /^(?:w\/)?"([1-9]\d*)(?:-([1-9]\d*))?"$/i.exec(eTag.trim())
    if (!match) return null
    const parts = match[2] ? [match[1]!,match[2]] : [match[1]!]
    if (parts.length === 2) {
      const r = Number.parseInt(parts[0]!, 10)
      const l = Number.parseInt(parts[1]!, 10)
      if (Number.isSafeInteger(r) && Number.isSafeInteger(l)) return { rundownVersion: r, lineVersion: l }
    } else if (parts.length === 1) {
      const r = Number.parseInt(parts[0]!, 10)
      if (Number.isSafeInteger(r)) return { rundownVersion: r }
    }
    return null
  }

  cleanExpiredLocks(rundownId?: string): void {
    const now = Date.now()
    if (rundownId) {
      const locks = this.lineLocks.get(rundownId)
      if (locks) {
        for (const [itemId, lock] of locks.entries()) {
          if (new Date(lock.expiresAt).getTime() <= now) {
            locks.delete(itemId)
          }
        }
      }
      const rLock = this.rundownLocks.get(rundownId)
      if (rLock && new Date(rLock.expiresAt).getTime() <= now) {
        this.rundownLocks.delete(rundownId)
      }
    } else {
      for (const [rId, locks] of this.lineLocks.entries()) {
        for (const [itemId, lock] of locks.entries()) {
          if (new Date(lock.expiresAt).getTime() <= now) {
            locks.delete(itemId)
          }
        }
      }
      for (const [rId, rLock] of this.rundownLocks.entries()) {
        if (new Date(rLock.expiresAt).getTime() <= now) {
          this.rundownLocks.delete(rId)
        }
      }
    }
  }

  getLockState(rundownId: string): RundownLockState {
    this.cleanExpiredLocks(rundownId)
    const lineLocksRecord: Record<string, string> = {}
    const locks = this.lineLocks.get(rundownId)
    if (locks) {
      for (const [itemId, lock] of locks.entries()) {
        lineLocksRecord[itemId] = lock.userId
      }
    }

    const rLock = this.rundownLocks.get(rundownId)

    return {
      version: this.getRundownVersion(rundownId),
      lockedByUserId: rLock?.userId,
      lockedAt: rLock?.acquiredAt,
      lineLocks: lineLocksRecord,
    }
  }

  acquireLock(params: {
    rundownId: string
    itemId?: string
    userId: string
    userName?: string
  }): { success: boolean; lockState: RundownLockState; error?: string } {
    this.cleanExpiredLocks(params.rundownId)
    const { rundownId, itemId, userId, userName = 'Operador MCR' } = params
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.lockTtlMs).toISOString()
    const acquiredAt = now.toISOString()

    if (itemId) {
      let locks = this.lineLocks.get(rundownId)
      if (!locks) {
        locks = new Map<string, LineLock>()
        this.lineLocks.set(rundownId, locks)
      }
      const existing = locks.get(itemId)
      if (existing && existing.userId !== userId) {
        return {
          success: false,
          lockState: this.getLockState(rundownId),
          error: `A linha está bloqueada pelo usuário ${existing.userName} (${existing.userId}).`,
        }
      }
      locks.set(itemId, { userId, userName, acquiredAt, expiresAt })

      const focusEvent: UserFocusEvent = {
        type: 'RUNDOWN_USER_FOCUS',
        rundownId,
        itemId,
        userId,
        userName,
        timestampMs: now.getTime(),
      }
      this.broadcast(focusEvent)
    } else {
      const existing = this.rundownLocks.get(rundownId)
      if (existing && existing.userId !== userId) {
        return {
          success: false,
          lockState: this.getLockState(rundownId),
          error: `A grade está bloqueada pelo usuário ${existing.userName} (${existing.userId}).`,
        }
      }
      this.rundownLocks.set(rundownId, { userId, userName, acquiredAt, expiresAt })
    }

    return {
      success: true,
      lockState: this.getLockState(rundownId),
    }
  }

  releaseLock(params: {
    rundownId: string
    itemId?: string
    userId: string
  }): { success: boolean; lockState: RundownLockState } {
    this.cleanExpiredLocks(params.rundownId)
    const { rundownId, itemId, userId } = params
    if (itemId) {
      const locks = this.lineLocks.get(rundownId)
      if (locks) {
        const existing = locks.get(itemId)
        if (existing && existing.userId !== userId) return {success:false,lockState:this.getLockState(rundownId)}
        if (existing && existing.userId === userId) {
          locks.delete(itemId)
        }
      }
    } else {
      const existing = this.rundownLocks.get(rundownId)
      if (existing && existing.userId !== userId) return {success:false,lockState:this.getLockState(rundownId)}
      if (existing && existing.userId === userId) {
        this.rundownLocks.delete(rundownId)
      }
    }

    return {
      success: true,
      lockState: this.getLockState(rundownId),
    }
  }

  /**
   * Valida a versão otimista e o cabeçalho If-Match para uma operação de escrita.
   * Se houver divergência, retorna conflito detalhado formatado para o Conflict Drawer (HTTP 409).
   */
  validateOptimisticLock(params: {
    rundownId: string
    itemId: string
    expectedRundownVersion?: number
    expectedLineVersion?: number
    ifMatchHeader?: string
    serverItemState?: Record<string, unknown>
    clientPatch?: Record<string, unknown>
  }): {
    valid: boolean
    conflictData?: ConflictResolutionData
    errorPayload?: OptimisticLockErrorPayload
  } {
    const {
      rundownId,
      itemId,
      expectedRundownVersion,
      expectedLineVersion,
      ifMatchHeader,
      serverItemState = {},
      clientPatch = {},
    } = params

    const currentRundownVersion = this.getRundownVersion(rundownId)
    const currentLineVersion = this.getLineVersion(rundownId, itemId)

    let requestedRundownVersion = expectedRundownVersion
    let requestedLineVersion = expectedLineVersion

    if (ifMatchHeader) {
      const parsed = this.parseETag(ifMatchHeader)
      if (parsed) {
        if (parsed.rundownVersion !== undefined && requestedRundownVersion === undefined) {
          requestedRundownVersion = parsed.rundownVersion
        }
        if (parsed.lineVersion !== undefined && requestedLineVersion === undefined) {
          requestedLineVersion = parsed.lineVersion
        }
      }
    }

    const hasRundownMismatch =
      requestedRundownVersion !== undefined && requestedRundownVersion !== currentRundownVersion
    const hasLineMismatch =
      requestedLineVersion !== undefined && requestedLineVersion !== currentLineVersion
    const headerVersion=ifMatchHeader ? this.parseETag(ifMatchHeader) : null
    const headerMismatch=Boolean(headerVersion && (
      headerVersion.rundownVersion!==undefined && headerVersion.rundownVersion!==currentRundownVersion ||
      headerVersion.lineVersion!==undefined && headerVersion.lineVersion!==currentLineVersion))

    if (hasRundownMismatch || hasLineMismatch || headerMismatch) {
      const conflictId = `conf-${randomUUID()}`
      const conflicts: ConflictItem[] = []

      for (const [key, clientVal] of Object.entries(clientPatch)) {
        const serverVal = serverItemState[key]
        if (serverVal !== undefined && serverVal !== clientVal) {
          conflicts.push({
            itemId,
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
          })
        }
      }

      if (conflicts.length === 0) {
        conflicts.push({
          itemId,
          field: 'lineVersion',
          clientValue: requestedLineVersion ?? requestedRundownVersion,
          serverValue: currentLineVersion,
        })
      }

      const conflictData: ConflictResolutionData = {
        baseVersion: requestedRundownVersion ?? currentRundownVersion - 1,
        serverVersion: currentRundownVersion,
        clientVersion: requestedRundownVersion ?? currentRundownVersion,
        conflicts,
      }

      const errorPayload: OptimisticLockErrorPayload = {
        error: 'OPTIMISTIC_LOCK_CONFLICT',
        message: 'A linha ou grade foi modificada concorrentemente por outro operador.',
        conflictId,
        currentRundownVersion,
        currentLineVersion,
        serverItemState: {
          id: itemId,
          lineVersion: currentLineVersion,
          ...serverItemState,
        },
        conflicts,
      }

      return {
        valid: false,
        conflictData,
        errorPayload,
      }
    }

    return { valid: true }
  }

  /**
   * Resolução assistida de conflitos conforme decisão tomada no Conflict Drawer:
   * - OVERWRITE_FORCE: força a aplicação dos dados locais do operador.
   * - DISCARD_MINE: abandona as alterações locais e aceita o estado atual do servidor.
   * - APPLY_MERGED_FIELDS: aplica a mesclagem cirúrgica de campos aprovados.
   */
  resolveConflict(params: {
    rundownId: string
    itemId: string
    decision: ConflictResolutionDecision
    currentItemState: Record<string, unknown>
    clientPatch?: Record<string, unknown>
  }): {
    success: boolean
    newRundownVersion: number
    newLineVersion: number
    resolvedData: Record<string, unknown>
  } {
    const { rundownId, itemId, decision, currentItemState, clientPatch = {} } = params
    let resolvedData: Record<string, unknown>

    switch (decision.resolutionStrategy) {
      case 'OVERWRITE_FORCE':
        resolvedData = { ...currentItemState, ...clientPatch }
        break
      case 'DISCARD_MINE':
        resolvedData = { ...currentItemState }
        break
      case 'APPLY_MERGED_FIELDS':
        resolvedData = { ...currentItemState, ...(decision.mergedData ?? clientPatch) }
        break
      default:
        resolvedData = { ...currentItemState, ...clientPatch }
    }

    const newRundownVersion = this.versions ? this.getRundownVersion(rundownId) : this.incrementRundownVersion(rundownId)
    const newLineVersion = this.versions ? this.getLineVersion(rundownId, itemId) : this.incrementLineVersion(rundownId, itemId)

    return {
      success: true,
      newRundownVersion,
      newLineVersion,
      resolvedData,
    }
  }
}

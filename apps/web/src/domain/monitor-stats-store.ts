import { useSyncExternalStore } from 'react'
import type { MonitorTier } from '@rplayout/protocol'
import type { MonitorRole, MonitorStats } from './monitor-tier.js'

/** Um monitor aberto nesta página, como a tela técnica o mostra. */
export interface MonitorEntry {
  id: string
  role: MonitorRole
  path: string
  tier: MonitorTier | null
  mode: 'auto' | MonitorTier
  stats: MonitorStats | null
  /** Últimas medições de vidro a vidro (relógio de teste), ms. */
  glass: number[]
  updatedAt: number
}

const entries = new Map<string, MonitorEntry>()
const listeners = new Set<() => void>()
let snapshot: MonitorEntry[] = []
let clockTest = false
const emit = () => { snapshot = [...entries.values()]; for (const listener of listeners) listener() }

/**
 * Estatísticas dos monitores WebRTC abertos nesta página. Local ao
 * navegador: cada estação mede o que ela mesma está recebendo.
 */
export const monitorStatsStore = {
  update(id: string, patch: Partial<MonitorEntry> & Pick<MonitorEntry, 'role' | 'path'>): void {
    const previous = entries.get(id)
    entries.set(id, { id, tier: null, mode: 'auto', stats: null, glass: [], ...previous, ...patch, updatedAt: Date.now() })
    emit()
  },
  pushGlass(id: string, ms: number): void {
    const entry = entries.get(id)
    if (!entry) return
    entry.glass = [...entry.glass.slice(-119), ms]
    emit()
  },
  remove(id: string): void { if (entries.delete(id)) emit() },
  list(): MonitorEntry[] { return snapshot },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  /** Relógio de teste: os monitores desta página passam a ler a faixa gravada. */
  get clockTest(): boolean { return clockTest },
  setClockTest(on: boolean): void { clockTest = on; for (const entry of entries.values()) entry.glass = []; emit() },
}

export function useMonitorEntries(): MonitorEntry[] {
  return useSyncExternalStore(monitorStatsStore.subscribe, monitorStatsStore.list, monitorStatsStore.list)
}

export function useClockTest(): boolean {
  return useSyncExternalStore(monitorStatsStore.subscribe, () => monitorStatsStore.clockTest, () => false)
}

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.round((sorted.length - 1) * p)]!
}

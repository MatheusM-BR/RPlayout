/**
 * Multiview composto (R88-36): o engine compõe as fontes numa só imagem,
 * codificada uma vez; o navegador sobrepõe rótulo, tally, VU e estado em HTML.
 *
 * A geometria fica aqui e em apps/engine/src/multiview.rs, na mesma grade de
 * 12 unidades. Os dois lados têm teste com os mesmos números.
 */

import { MONITOR_TIERS, monitorTierPath, type MonitorTier } from './channel.js'

export type MultiviewCompositeLayout = 'MV_2X2' | 'MV_3X3' | 'MV_4X4' | 'MV_1_PLUS_5' | 'MV_PGM_PVW'
export type MultiviewQuality = 'REFERENCIA' | 'PADRAO' | 'LEVE'

export type MultiviewCellSource =
  | { kind: 'pgm' } | { kind: 'pvw' } | { kind: 'next' } | { kind: 'qc' } | { kind: 'contingency' }
  | { kind: 'source'; id: string } | { kind: 'empty' }

export interface MultiviewComposition {
  layout: MultiviewCompositeLayout
  quality: MultiviewQuality
  cells: MultiviewCellSource[]
}

export type MultiviewCellSignal = 'live' | 'held' | 'noSignal' | 'unavailable' | 'empty'

/** Estado que o engine publica (evento `multiviewState`). */
export interface MultiviewEngineState {
  running: boolean
  layout: MultiviewCompositeLayout
  quality: MultiviewQuality
  profile: { width: number; height: number; fpsN: number; fpsD: number; bitrateKbps: number }
  cells: Array<{ source: MultiviewCellSource; signal: MultiviewCellSignal; ageMs: number | null; fps: number; width: number | null; height: number | null; bus: string | null; skipped: number }>
  frames: number
}

/** Células em unidades de 1/12: [x, y, largura, altura]. */
export type MultiviewUnits = readonly [number, number, number, number]

const grid = (n: number): MultiviewUnits[] => {
  const s = 12 / n
  return Array.from({ length: n * n }, (_, i) => [(i % n) * s, Math.floor(i / n) * s, s, s] as const)
}

export const MULTIVIEW_LAYOUTS: ReadonlyArray<{ id: MultiviewCompositeLayout; label: string; description: string; units: readonly MultiviewUnits[] }> = [
  { id: 'MV_PGM_PVW', label: 'PGM/PVW + 8', description: 'PGM e PVW grandes em cima, oito fontes embaixo', units: [[0, 0, 6, 6], [6, 0, 6, 6], ...[0, 1].flatMap(row => [0, 1, 2, 3].map(col => [col * 3, 6 + row * 3, 3, 3] as const))] },
  { id: 'MV_2X2', label: '2×2', description: 'Quatro células iguais', units: grid(2) },
  { id: 'MV_3X3', label: '3×3', description: 'Nove células iguais', units: grid(3) },
  { id: 'MV_4X4', label: '4×4', description: 'Dezesseis células iguais', units: grid(4) },
  { id: 'MV_1_PLUS_5', label: '1+5', description: 'Uma grande e cinco em L', units: [[0, 0, 8, 8], [8, 0, 4, 4], [8, 4, 4, 4], [0, 8, 4, 4], [4, 8, 4, 4], [8, 8, 4, 4]] },
]

export const MULTIVIEW_QUALITIES: ReadonlyArray<{ id: MultiviewQuality; label: string; description: string }> = [
  { id: 'REFERENCIA', label: 'REFERÊNCIA', description: '1920×1080, cadência do canal, 8 Mbps' },
  { id: 'PADRAO', label: 'PADRÃO', description: '1280×720, até 30 q/s, 3 Mbps' },
  { id: 'LEVE', label: 'LEVE', description: '960×540, 15 q/s, 1,2 Mbps' },
]

/**
 * O nível do multiview é o **teto** do mosaico: o nível de monitor em que ele
 * é composto no engine. Cada espectador escolhe o próprio nível (seletor e
 * troca automática do `Whep`, como PGM e PVW) entre os que não passam do teto.
 */
export const MULTIVIEW_QUALITY_TIER: Record<MultiviewQuality, MonitorTier> = { REFERENCIA: 'ref', PADRAO: 'std', LEVE: 'lite' }

const tierRank = (tier: MonitorTier) => MONITOR_TIERS.length - 1 - MONITOR_TIERS.indexOf(tier)
/** Rebaixa `tier` ao teto (REFERÊNCIA > PADRÃO > LEVE). */
export function clampTier(tier: MonitorTier, ceiling: MonitorTier): MonitorTier {
  return tierRank(tier) > tierRank(ceiling) ? ceiling : tier
}

/** Caminho de cada nível do mosaico que existe com este teto. */
export function multiviewTierPaths(path: string, quality: MultiviewQuality): Partial<Record<MonitorTier, string>> {
  const ceiling = MULTIVIEW_QUALITY_TIER[quality]
  return Object.fromEntries(MONITOR_TIERS.filter(tier => clampTier(tier, ceiling) === tier).map(tier => [tier, monitorTierPath(path, tier)]))
}

export function multiviewLayoutUnits(layout: MultiviewCompositeLayout): readonly MultiviewUnits[] {
  return MULTIVIEW_LAYOUTS.find(entry => entry.id === layout)?.units ?? grid(2)
}

/**
 * Preenchimento automático, na ordem de um master: PGM, PVW, as entradas ao
 * vivo do canal (principal antes do backup), depois NEXT, QC e contingência.
 * No PGM/PVW+8 as duas grandes são PGM e PVW e as oito de baixo são entradas.
 */
export function autoMultiviewCells(layout: MultiviewCompositeLayout, sourceIds: readonly string[]): MultiviewCellSource[] {
  const size = multiviewLayoutUnits(layout).length
  const sources = sourceIds.map(id => ({ kind: 'source', id }) as const)
  const extras: MultiviewCellSource[] = [{ kind: 'next' }, { kind: 'qc' }, { kind: 'contingency' }]
  const order: MultiviewCellSource[] = [{ kind: 'pgm' }, { kind: 'pvw' }, ...sources, ...extras]
  const cells = order.slice(0, size)
  while (cells.length < size) cells.push({ kind: 'empty' })
  return cells
}

export function multiviewCellLabel(cell: MultiviewCellSource, names: ReadonlyMap<string, string> = new Map()): string {
  switch (cell.kind) {
    case 'pgm': return 'PGM'
    case 'pvw': return 'PVW'
    case 'next': return 'NEXT'
    case 'qc': return 'QC'
    case 'contingency': return 'CONTINGÊNCIA'
    case 'source': return names.get(cell.id) ?? 'ENTRADA REMOVIDA'
    case 'empty': return ''
  }
}

export const sameMultiviewCell = (a: MultiviewCellSource, b: MultiviewCellSource) =>
  a.kind === b.kind && (a.kind !== 'source' || (b.kind === 'source' && a.id === b.id))

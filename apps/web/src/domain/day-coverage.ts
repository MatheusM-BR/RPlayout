/**
 * Cobertura real do dia da grade (M2): buracos entre itens e o resto do dia
 * depois do último item. Em loop, o ciclo cobre o dia e não há lacuna, mas a
 * tela diz isso explicitamente em vez de só "LACUNAS: 0".
 */
export interface DayCoverage { loop: boolean; cycleFrames: number; repeats: number; gapFrames: number; gapCount: number; tailFrames: number; lastEnd: number }
export function dayCoverage(blocks: readonly { start: number; end: number }[], loop: boolean, dayFrames: number, fps: number): DayCoverage {
  const live = blocks.filter((block) => block.end > block.start).slice().sort((a, b) => a.start - b.start)
  if (!live.length) return { loop, cycleFrames: 0, repeats: 0, gapFrames: dayFrames, gapCount: 1, tailFrames: dayFrames, lastEnd: 0 }
  const lastEnd = live.reduce((max, block) => Math.max(max, block.end), 0)
  const firstStart = live[0]!.start
  let gapFrames = 0, gapCount = 0, cursor = live[0]!.end
  for (const block of live.slice(1)) {
    if (block.start > cursor + fps) { gapFrames += block.start - cursor; gapCount++ }
    cursor = Math.max(cursor, block.end)
  }
  const tailFrames = !loop && lastEnd < dayFrames - fps ? dayFrames - lastEnd : 0
  if (tailFrames > 0) { gapFrames += tailFrames; gapCount++ }
  const cycleFrames = lastEnd - firstStart
  return { loop, cycleFrames, repeats: loop && cycleFrames > 0 ? Math.ceil(Math.max(0, dayFrames - firstStart) / cycleFrames) : 0, gapFrames, gapCount, tailFrames, lastEnd }
}

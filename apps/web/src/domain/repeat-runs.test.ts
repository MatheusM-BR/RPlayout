import { expect, it } from 'vitest'
import { collapsedRows, findRepeatRuns } from './repeat-runs.js'

it('acha o loop de 4 repetido e recolhe em primeiro ciclo + resumo', () => {
  const keys = ['abertura', ...Array.from({ length: 5 }, () => ['a', 'b', 'c', 'd']).flat(), 'live', 'x', 'x']
  const runs = findRepeatRuns(keys)
  expect(runs).toEqual([{ start: 1, period: 4, repeats: 5 }])
  const rows = collapsedRows(keys.length, runs)
  expect(rows.slice(0, 6)).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }, { summary: runs[0], hidden: 16, lastIndex: 20 }])
  expect(rows.slice(6)).toEqual([{ index: 21 }, { index: 22 }, { index: 23 }])
})

it('não recolhe o que repete menos de 3 vezes', () => {
  expect(findRepeatRuns(['a', 'b', 'a', 'b', 'c'])).toEqual([])
})

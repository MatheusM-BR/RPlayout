import {describe, expect, it} from 'vitest'
import {qcFrameCount, qcParseTimecode, qcRateLabel, qcStepFrame, qcTimecode} from './qc-timecode.js'

const NTSC = {num: 30000, den: 1001}
describe('timecode do QC', () => {
  it('29,97 usa drop-frame com ponto e vírgula', () => {
    expect(qcTimecode(899, NTSC)).toBe('00:00:29;29')
    expect(qcTimecode(1800, NTSC)).toBe('00:01:00;02')
    expect(qcTimecode(17982, NTSC)).toBe('00:10:00;00')
    expect(qcRateLabel(NTSC)).toBe('29,97 DF')
  })
  it('25 e 23,976 contam sem drop', () => {
    expect(qcTimecode(899, {num: 25, den: 1})).toBe('00:00:35:24')
    expect(qcTimecode(1440, {num: 24000, den: 1001})).toBe('00:01:00:00')
    expect(qcRateLabel({num: 24000, den: 1001})).toBe('23,976')
  })
  it('lê o TC digitado de volta no mesmo quadro', () => {
    for (const frame of [0, 1, 899, 1800, 17982, 107892]) expect(qcParseTimecode(qcTimecode(frame, NTSC), NTSC)).toBe(frame)
    expect(qcParseTimecode('00:01:00:00', {num: 24000, den: 1001})).toBe(1440)
  })
  it('passo de quadro fica dentro do arquivo', () => {
    expect(qcFrameCount(10_010_000_000, NTSC)).toBe(300)
    expect(qcStepFrame(299, 1, 300)).toBe(299)
    expect(qcStepFrame(0, -30, 300)).toBe(0)
    expect(qcStepFrame(100, 30, 300)).toBe(130)
  })
})

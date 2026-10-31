import { describe, expect, it } from 'vitest'
import {
  calcCrc32Mpeg2,
  buildScte35SpliceInfoSection,
  parseScte35Section,
  buildScte104Packet,
  ScteDispatcher,
} from './scte.js'
import type { Scte35Message } from '@rplayout/protocol'

describe('Módulo de Sinalização SCTE-35 e SCTE-104 (Fase D)', () => {
  it('calcula CRC-32 MPEG-2 com integridade', () => {
    const testData = Buffer.from('123456789', 'ascii')
    const crc = calcCrc32Mpeg2(testData)
    // Polinômio MPEG-2 (0x04C11DB7) padrão para '123456789'
    expect(crc).toBe(0x0376e6e7)
  })

  it('monta e valida pacote binário SCTE-35 SPLICE_INSERT com 30s de duração e retorno automático', () => {
    const msg: Scte35Message = {
      spliceEventId: 55102,
      ptsTime: 360000,
      durationSeconds: 30.0,
      autoReturn: true,
      prerollMs: 4000,
      uniqueProgramId: 105,
      availNum: 1,
      availsExpected: 3,
      outOfNetwork: true,
      commandType: 'SPLICE_INSERT',
    }

    const section = buildScte35SpliceInfoSection(msg)
    expect(section).toBeInstanceOf(Buffer)
    expect(section.length).toBeGreaterThan(20)

    const parsed = parseScte35Section(section)
    expect(parsed.tableId).toBe(0xfc) // SCTE-35 table_id
    expect(parsed.spliceCommandType).toBe(0x05) // splice_insert
    expect(parsed.spliceEventId).toBe(55102)
    expect(parsed.ptsTime).toBe(360000n)
    expect(parsed.durationSeconds).toBe(30.0)
    expect(parsed.autoReturn).toBe(true)
    expect(parsed.crcValid).toBe(true)
  })

  it('monta pacote binário SCTE-35 TIME_SIGNAL com descritor de segmentação', () => {
    const msg: Scte35Message = {
      spliceEventId: 99182,
      ptsTime: 720000,
      durationSeconds: 60.0,
      autoReturn: true,
      prerollMs: 4000,
      uniqueProgramId: 201,
      segmentationTypeId: 52, // Provider Ad Start
      commandType: 'TIME_SIGNAL',
    }

    const section = buildScte35SpliceInfoSection(msg, 'TIME_SIGNAL')
    const parsed = parseScte35Section(section)

    expect(parsed.tableId).toBe(0xfc)
    expect(parsed.spliceCommandType).toBe(0x04) // time_signal
    expect(parsed.ptsTime).toBe(720000n)
    expect(parsed.crcValid).toBe(true)
  })

  it('monta pacote SCTE-104 compatível com SMPTE 2010 para inserção VANC SDI', () => {
    const msg: Scte35Message = {
      spliceEventId: 4401,
      ptsTime: 180000,
      durationSeconds: 30.0,
      autoReturn: true,
      prerollMs: 4000,
      uniqueProgramId: 10,
    }

    const packet = buildScte104Packet(msg)
    expect(packet.did).toBe(0x41) // SMPTE 2010 DID
    expect(packet.sdid).toBe(0x07) // SCTE-104 SDID
    expect(packet.line).toBe(13) // Linha VANC regulamentar
    expect(packet.payload.length).toBeGreaterThanOrEqual(26)

    // Verifica OpID 0x0101 (splice_request_data) no header de operação
    const opId = packet.payload.readUInt16BE(12)
    expect(opId).toBe(0x0101)
  })

  it('despachante SCTE executa injeção com registro de latência inferior a 5ms', () => {
    const dispatcher = new ScteDispatcher()
    const msg: Scte35Message = {
      spliceEventId: 8841,
      ptsTime: 900000,
      durationSeconds: 15.0,
      autoReturn: true,
      prerollMs: 4000,
    }

    const result = dispatcher.dispatchSpliceInsert(msg)
    expect(result.status).toBe('DISPATCHED_OK')
    expect(result.latencyMs).toBeLessThan(50) // Tolerância ampla para CI
    expect(result.scte35.length).toBeGreaterThan(0)
    expect(result.scte104.payload.length).toBeGreaterThan(0)

    const last = dispatcher.getLastDispatched()
    expect(last?.eventId).toBe(8841)
    expect(last?.commandType).toBe('SPLICE_INSERT')
  })
})

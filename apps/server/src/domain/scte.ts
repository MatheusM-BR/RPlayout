import { randomUUID } from 'node:crypto'
import type { Scte35Message, Scte104Message } from '@rplayout/protocol'

/**
 * Calculador de CRC-32 padrão MPEG-2 (ISO/IEC 13818-1 / ANSI SCTE 35).
 * Polinômio: 0x04C11DB7, valor inicial: 0xFFFFFFFF, sem reflexão.
 */
export function calcCrc32Mpeg2(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= (buf[i]! << 24)
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x80000000) !== 0) {
        crc = ((crc << 1) ^ 0x04c11db7) >>> 0
      } else {
        crc = (crc << 1) >>> 0
      }
    }
  }
  return crc >>> 0
}

/**
 * Utilitário de escrita em nível de bits para montagem de sintaxe SCTE-35.
 */
export class BitWriter {
  private buffer: number[] = []
  private currentByte = 0
  private bitPosition = 0 // 0 a 7

  writeBits(value: number | bigint, numBits: number): void {
    const val = BigInt(value)
    for (let i = numBits - 1; i >= 0; i--) {
      const bit = Number((val >> BigInt(i)) & 1n)
      this.currentByte = (this.currentByte << 1) | bit
      this.bitPosition++
      if (this.bitPosition === 8) {
        this.buffer.push(this.currentByte)
        this.currentByte = 0
        this.bitPosition = 0
      }
    }
  }

  writeBytes(bytes: Uint8Array | number[]): void {
    for (const b of bytes) {
      this.writeBits(b, 8)
    }
  }

  toBuffer(): Buffer {
    if (this.bitPosition > 0) {
      // Preenche restante do byte com bits 0
      this.currentByte = this.currentByte << (8 - this.bitPosition)
      this.buffer.push(this.currentByte)
      this.currentByte = 0
      this.bitPosition = 0
    }
    return Buffer.from(this.buffer)
  }
}

/**
 * Utilitário de leitura em nível de bits para validação e testes de SCTE-35.
 */
export class BitReader {
  private byteOffset = 0
  private bitOffset = 0 // 0 a 7

  constructor(private readonly buf: Uint8Array) {}

  readBits(numBits: number): number {
    let result = 0
    for (let i = 0; i < numBits; i++) {
      if (this.byteOffset >= this.buf.length) return 0
      const currentByte = this.buf[this.byteOffset]!
      const bit = (currentByte >> (7 - this.bitOffset)) & 1
      result = (result << 1) | bit
      this.bitOffset++
      if (this.bitOffset === 8) {
        this.bitOffset = 0
        this.byteOffset++
      }
    }
    return result
  }

  readBits64(numBits: number): bigint {
    let result = 0n
    for (let i = 0; i < numBits; i++) {
      if (this.byteOffset >= this.buf.length) return 0n
      const currentByte = this.buf[this.byteOffset]!
      const bit = BigInt((currentByte >> (7 - this.bitOffset)) & 1)
      result = (result << 1n) | bit
      this.bitOffset++
      if (this.bitOffset === 8) {
        this.bitOffset = 0
        this.byteOffset++
      }
    }
    return result
  }
}

/**
 * Monta pacote binário SCTE-35 `splice_info_section` conforme ANSI/SCTE 35 (2020).
 * Suporta comandos SPLICE_INSERT (0x05) e TIME_SIGNAL (0x04).
 */
export function buildScte35SpliceInfoSection(
  msg: Scte35Message,
  forcedCommandType?: 'SPLICE_INSERT' | 'TIME_SIGNAL',
): Buffer {
  const commandType = forcedCommandType ?? msg.commandType ?? 'SPLICE_INSERT'

  // 1. Constrói o corpo do comando de splice
  const cmdWriter = new BitWriter()
  if (commandType === 'SPLICE_INSERT') {
    const spliceEventId = msg.spliceEventId >>> 0
    const cancelIndicator = 0
    const outOfNetwork = msg.outOfNetwork !== false ? 1 : 0
    const programSpliceFlag = 1
    const hasDuration = msg.durationSeconds !== undefined && msg.durationSeconds > 0 ? 1 : 0
    const spliceImmediate = 0

    cmdWriter.writeBits(spliceEventId, 32)
    cmdWriter.writeBits(cancelIndicator, 1)
    cmdWriter.writeBits(0x7f, 7) // reserved

    cmdWriter.writeBits(outOfNetwork, 1)
    cmdWriter.writeBits(programSpliceFlag, 1)
    cmdWriter.writeBits(hasDuration, 1)
    cmdWriter.writeBits(spliceImmediate, 1)
    cmdWriter.writeBits(0x0f, 4) // reserved

    // time_specified_flag = 1, reserved (6 bits), pts_time (33 bits)
    cmdWriter.writeBits(1, 1)
    cmdWriter.writeBits(0x3f, 6)
    cmdWriter.writeBits(BigInt(Math.floor(msg.ptsTime)), 33)

    if (hasDuration) {
      const autoReturn = msg.autoReturn ? 1 : 0
      const breakDurationTicks = BigInt(Math.round(msg.durationSeconds! * 90000))
      cmdWriter.writeBits(autoReturn, 1)
      cmdWriter.writeBits(0x3f, 6)
      cmdWriter.writeBits(breakDurationTicks, 33)
    }

    cmdWriter.writeBits(msg.uniqueProgramId ?? 1, 16)
    cmdWriter.writeBits(msg.availNum ?? 1, 8)
    cmdWriter.writeBits(msg.availsExpected ?? 1, 8)
  } else {
    // TIME_SIGNAL: time_specified_flag (1) + reserved (6) + pts_time (33)
    cmdWriter.writeBits(1, 1)
    cmdWriter.writeBits(0x3f, 6)
    cmdWriter.writeBits(BigInt(Math.floor(msg.ptsTime)), 33)
  }

  const cmdPayload = cmdWriter.toBuffer()
  const spliceCommandType = commandType === 'SPLICE_INSERT' ? 0x05 : 0x04

  // 2. Constrói descritores de segmentação, se aplicável
  const descWriter = new BitWriter()
  if (msg.segmentationTypeId !== undefined) {
    const segWriter = new BitWriter()
    segWriter.writeBits(0x43554549, 32) // identifier "CUEI"
    segWriter.writeBits(msg.spliceEventId >>> 0, 32) // segmentation_event_id
    segWriter.writeBits(0, 1) // segmentation_event_cancel_indicator
    segWriter.writeBits(0x7f, 7) // reserved

    const hasDuration = msg.durationSeconds !== undefined && msg.durationSeconds > 0 ? 1 : 0
    segWriter.writeBits(1, 1) // program_segmentation_flag
    segWriter.writeBits(hasDuration, 1) // segmentation_duration_flag
    segWriter.writeBits(1, 1) // delivery_not_restricted_flag
    segWriter.writeBits(1, 1) // web_delivery_allowed_flag
    segWriter.writeBits(1, 1) // no_regional_blackout_flag
    segWriter.writeBits(1, 1) // archive_allowed_flag
    segWriter.writeBits(3, 2) // device_restrictions

    if (hasDuration) {
      const segDurationTicks = BigInt(Math.round(msg.durationSeconds! * 90000))
      segWriter.writeBits(segDurationTicks, 40)
    }

    segWriter.writeBits(0x09, 8) // segmentation_upid_type (0x09: ADS Information)
    segWriter.writeBits(4, 8) // segmentation_upid_length
    segWriter.writeBits(msg.uniqueProgramId ?? 1, 32) // segmentation_upid
    segWriter.writeBits(msg.segmentationTypeId, 8) // segmentation_type_id (ex: 52 Provider Ad Start)
    segWriter.writeBits(msg.availNum ?? 1, 8) // segment_num
    segWriter.writeBits(msg.availsExpected ?? 1, 8) // segments_expected

    const segBytes = segWriter.toBuffer()
    descWriter.writeBits(0x02, 8) // splice_descriptor_tag (segmentation_descriptor)
    descWriter.writeBits(segBytes.length, 8) // descriptor_length
    descWriter.writeBytes(segBytes)
  }
  const descPayload = descWriter.toBuffer()

  // 3. Monta cabeçalho da splice_info_section
  const headerWriter = new BitWriter()
  headerWriter.writeBits(0xfc, 8) // table_id = 0xFC (SCTE-35)
  headerWriter.writeBits(0, 1) // section_syntax_indicator = 0
  headerWriter.writeBits(0, 1) // private_indicator = 0
  headerWriter.writeBits(3, 2) // sap_type = 3
  
  // section_length: tamanho dos bytes restantes até o fim do CRC_32
  // Cabeçalho fixo após section_length = 11 bytes + cmdPayload.length + 2 (desc_len) + descPayload.length + 4 (crc32)
  const remainingLengthWithoutCrc = 11 + cmdPayload.length + 2 + descPayload.length
  const sectionLength = remainingLengthWithoutCrc + 4
  headerWriter.writeBits(sectionLength, 12)

  headerWriter.writeBits(0, 8) // protocol_version = 0
  headerWriter.writeBits(0, 1) // encrypted_packet = 0
  headerWriter.writeBits(0, 6) // encryption_algorithm = 0
  headerWriter.writeBits(0n, 33) // pts_adjustment = 0
  headerWriter.writeBits(0, 8) // cw_index = 0
  headerWriter.writeBits(0xfff, 12) // tier = 0xFFF
  headerWriter.writeBits(cmdPayload.length, 12) // splice_command_length
  headerWriter.writeBits(spliceCommandType, 8) // splice_command_type
  headerWriter.writeBytes(cmdPayload)
  headerWriter.writeBits(descPayload.length, 16) // descriptor_loop_length
  headerWriter.writeBytes(descPayload)

  const sectionWithoutCrc = headerWriter.toBuffer()
  const crc = calcCrc32Mpeg2(sectionWithoutCrc)

  const finalBuffer = Buffer.alloc(sectionWithoutCrc.length + 4)
  sectionWithoutCrc.copy(finalBuffer, 0)
  finalBuffer.writeUInt32BE(crc, sectionWithoutCrc.length)

  return finalBuffer
}

/**
 * Decodifica e valida um pacote binário SCTE-35 para testes e verificação de integridade.
 */
export function parseScte35Section(buf: Buffer): {
  tableId: number
  sectionLength: number
  protocolVersion: number
  spliceCommandType: number
  spliceCommandLength: number
  spliceEventId?: number
  ptsTime?: bigint
  durationSeconds?: number
  autoReturn?: boolean
  crc32: number
  crcValid: boolean
} {
  if (buf.length < 17) {
    throw new Error('SCTE-35 buffer muito curto para conter seção válida')
  }

  const reader = new BitReader(buf)
  const tableId = reader.readBits(8)
  const sectionSyntax = reader.readBits(1)
  const privateInd = reader.readBits(1)
  const sapType = reader.readBits(2)
  const sectionLength = reader.readBits(12)
  const protocolVersion = reader.readBits(8)
  const encrypted = reader.readBits(1)
  const encAlgo = reader.readBits(6)
  const ptsAdj = reader.readBits64(33)
  const cwIndex = reader.readBits(8)
  const tier = reader.readBits(12)
  const spliceCommandLength = reader.readBits(12)
  const spliceCommandType = reader.readBits(8)

  let spliceEventId: number | undefined
  let ptsTime: bigint | undefined
  let durationSeconds: number | undefined
  let autoReturn: boolean | undefined

  if (spliceCommandType === 0x05) {
    spliceEventId = reader.readBits(32)
    const cancel = reader.readBits(1)
    reader.readBits(7) // reserved
    if (!cancel) {
      reader.readBits(1) // out of network
      const progSplice = reader.readBits(1)
      const hasDur = reader.readBits(1)
      const imm = reader.readBits(1)
      reader.readBits(4) // reserved
      if (progSplice && !imm) {
        const timeSpecified = reader.readBits(1)
        reader.readBits(6)
        if (timeSpecified) ptsTime = reader.readBits64(33)
      }
      if (hasDur) {
        autoReturn = reader.readBits(1) === 1
        reader.readBits(6)
        const breakTicks = reader.readBits64(33)
        durationSeconds = Number(breakTicks) / 90000
      }
    }
  } else if (spliceCommandType === 0x04) {
    const timeSpecified = reader.readBits(1)
    reader.readBits(6)
    if (timeSpecified) ptsTime = reader.readBits64(33)
  }

  const sectionWithoutCrc = buf.subarray(0, buf.length - 4)
  const expectedCrc = calcCrc32Mpeg2(sectionWithoutCrc)
  const actualCrc = buf.readUInt32BE(buf.length - 4)

  return {
    tableId,
    sectionLength,
    protocolVersion,
    spliceCommandType,
    spliceCommandLength,
    spliceEventId,
    ptsTime,
    durationSeconds,
    autoReturn,
    crc32: actualCrc,
    crcValid: expectedCrc === actualCrc,
  }
}

/**
 * Constrói pacote SCTE-104 (SMPTE 2010 / ANSI SCTE 104) para inserção em linha VANC SDI.
 * Padrão: DID 0x41, SDID 0x07, Linha VANC 13 (SMPTE 2010 single_operation_message).
 */
export function buildScte104Packet(
  msg: Scte104Message | Scte35Message,
): { did: number; sdid: number; line: number; payload: Buffer } {
  const eventId = 'spliceEventId' in msg ? msg.spliceEventId : msg.eventId
  const preRollMs = 'prerollMs' in msg ? msg.prerollMs : msg.preRollMs
  const durationSeconds = msg.durationSeconds ?? 30
  const autoReturn = 'autoReturn' in msg ? Boolean(msg.autoReturn) : true
  const uniqueProgramId = 'uniqueProgramId' in msg ? (msg.uniqueProgramId ?? 1) : 1
  const line = ('vancLine' in msg && msg.vancLine) ? msg.vancLine : 13

  // Operação 0x0101 (splice_request_data)
  // Tamanho do splice_request_data:
  // splice_insert_type (1B), splice_event_id (4B), unique_program_id (2B),
  // pre_roll_time (2B), break_duration (2B), avail_num (1B), avails_expected (1B), auto_return_flag (1B) = 14B
  const opData = Buffer.alloc(14)
  opData.writeUInt8(1, 0) // splice_insert_type = 1 (Start_Normal)
  opData.writeUInt32BE(eventId >>> 0, 1)
  opData.writeUInt16BE(uniqueProgramId & 0xffff, 5)
  opData.writeUInt16BE(Math.min(65535, preRollMs), 7)
  opData.writeUInt16BE(Math.min(65535, Math.round(durationSeconds * 10)), 9) // 1/10th sec
  opData.writeUInt8(1, 11) // avail_num
  opData.writeUInt8(1, 12) // avails_expected
  opData.writeUInt8(autoReturn ? 1 : 0, 13) // auto_return_flag

  // single_operation_message header:
  // opID (2B), data_length (2B), opData
  const opBuffer = Buffer.alloc(4 + opData.length)
  opBuffer.writeUInt16BE(0x0101, 0) // OpID: splice_request_data
  opBuffer.writeUInt16BE(opData.length, 2)
  opData.copy(opBuffer, 4)

  // Mensagem raiz SCTE-104:
  // reserved (2B), messageSize (2B), protocol_version (1B), AS_index (1B), message_number (1B),
  // dpi_pid_index (2B), scte35_protocol_version (1B), timestamp (1B), num_ops (1B) = 12B
  const rootHeader = Buffer.alloc(12)
  rootHeader.writeUInt16BE(0xffff, 0) // reserved
  rootHeader.writeUInt16BE(12 + opBuffer.length, 2) // messageSize
  rootHeader.writeUInt8(0, 4) // protocol_version = 0
  rootHeader.writeUInt8(0, 5) // AS_index = 0
  rootHeader.writeUInt8(Math.floor(Math.random() * 255), 6) // message_number
  rootHeader.writeUInt16BE(0, 7) // dpi_pid_index = 0
  rootHeader.writeUInt8(0, 9) // scte35_protocol_version = 0
  rootHeader.writeUInt8(0, 10) // timestamp type = 0 (none)
  rootHeader.writeUInt8(1, 11) // num_ops = 1

  const finalPayload = Buffer.concat([rootHeader, opBuffer])

  return {
    did: 0x41, // SMPTE 2010
    sdid: 0x07, // SCTE-104
    line,
    payload: finalPayload,
  }
}

/**
 * Despachante SCTE-35 / SCTE-104 para orquestração Master Control.
 */
export class ScteDispatcher {
  private lastDispatched: {
    eventId: number
    commandType: string
    dispatchedAt: string
    latencyMs: number
    scte35Hex: string
    scte104Hex: string
  } | null = null

  dispatchSpliceInsert(msg: Scte35Message): {
    scte35: Buffer
    scte104: { did: number; sdid: number; line: number; payload: Buffer }
    latencyMs: number
    status: 'DISPATCHED_OK'
  } {
    const start = performance.now()
    const scte35 = buildScte35SpliceInfoSection(msg, 'SPLICE_INSERT')
    const scte104 = buildScte104Packet(msg)
    const latencyMs = Math.round((performance.now() - start) * 100) / 100

    this.lastDispatched = {
      eventId: msg.spliceEventId,
      commandType: 'SPLICE_INSERT',
      dispatchedAt: new Date().toISOString(),
      latencyMs,
      scte35Hex: scte35.toString('hex'),
      scte104Hex: scte104.payload.toString('hex'),
    }

    return {
      scte35,
      scte104,
      latencyMs,
      status: 'DISPATCHED_OK',
    }
  }

  dispatchTimeSignal(msg: Scte35Message): {
    scte35: Buffer
    latencyMs: number
    status: 'DISPATCHED_OK'
  } {
    const start = performance.now()
    const scte35 = buildScte35SpliceInfoSection(msg, 'TIME_SIGNAL')
    const latencyMs = Math.round((performance.now() - start) * 100) / 100

    this.lastDispatched = {
      eventId: msg.spliceEventId,
      commandType: 'TIME_SIGNAL',
      dispatchedAt: new Date().toISOString(),
      latencyMs,
      scte35Hex: scte35.toString('hex'),
      scte104Hex: '',
    }

    return {
      scte35,
      latencyMs,
      status: 'DISPATCHED_OK',
    }
  }

  getLastDispatched(): typeof this.lastDispatched {
    return this.lastDispatched
  }
}

export const globalScteDispatcher = new ScteDispatcher()

// Integração nativa sem saídas públicas: gera áudio, faz três takes e preview.
// Uso: node scripts/check-engine-playback.mjs [caminho-do-engine]
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import console from 'node:console'
import { setTimeout, clearTimeout } from 'node:timers'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const dir = mkdtempSync(join(tmpdir(), 'rplayout-native-'))
const wav = Buffer.alloc(44 + 48000 * 5 * 4)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22)
wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28)
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
wav.writeUInt32LE(wav.length - 44, 40)
for (let i = 0; i < 48000 * 5; i++) {
  const value = Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / 48000))
  wav.writeInt16LE(value, 44 + i * 4); wav.writeInt16LE(value, 46 + i * 4)
}
const path = join(dir, 'tone.wav'); writeFileSync(path, wav)
const child = spawn(resolve(process.argv[2] ?? 'apps/engine/target/release/rplayout-engine.exe'),
  ['--channel-id', 'native-regression', '--width', '320', '--height', '180', '--fps-num', '25',
    '--fps-den', '1', '--output', 'null', '--preview', 'srt://127.0.0.1:1?streamid=publish:test/pvw'],
  { windowsHide: true })
const pending = new Map()
const readings = []
let nextId = 1
let ready = false
let spawnError
child.on('error', (error) => { spawnError = error })
child.stdin.on('error', () => {})
child.stderr.on('data', (data) => process.stderr.write(data))
createInterface({ input: child.stdout }).on('line', (line) => {
  let event
  try { event = JSON.parse(line) } catch { return }
  if (event.event === 'ready') ready = true
  if (event.event === 'levels') readings.push({ ...event, at: Date.now() })
  if (event.event === 'ack') {
    const request = pending.get(event.id)
    if (!request) return
    pending.delete(event.id); clearTimeout(request.timeout)
    if (event.ok) request.resolve()
    else request.reject(new Error(event.error))
  }
})
const wait = (ms) => new Promise((done) => setTimeout(done, ms))
const send = (command) => new Promise((resolve, reject) => {
  const id = nextId++
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Engine não confirmou o comando')) }, 30000)
  pending.set(id, { resolve, reject, timeout })
  child.stdin.write(JSON.stringify({ id, ...command }) + '\n')
})
const spec = (id) => ({ itemId: id, path, trimIn: 0, trimOut: 125, gainDb: 0 })
async function signal(bus) {
  // Descarte a transição e avalie apenas o sinal depois de estabilizar.
  await wait(500)
  const since = Date.now(); await wait(800)
  const values = readings.filter((r) => r.bus === bus && r.at >= since).flatMap((r) => r.peak)
  const peak = Math.max(-100, ...values)
  assert(peak > -35, `${bus}: áudio ausente após take (${peak.toFixed(1)} dBFS)`)
  console.log(`${bus}: sinal confirmado (${peak.toFixed(1)} dBFS)`)
}
try {
  for (let i = 0; i < 200 && !ready && !spawnError; i++) await wait(50)
  if (spawnError) throw spawnError
  assert(ready, 'Engine não inicializou')
  for (const id of ['primeiro', 'segundo', 'terceiro']) {
    await send({ cmd: 'load', item: spec(id) })
    if (id !== 'primeiro') await signal('pgm')
    await send({ cmd: 'take' }); await signal('pgm')
  }
  await send({ cmd: 'preview', item: spec('preview') }); await signal('pvw')
  await send({ cmd: 'stop' })
  console.log('OK: três takes e preview com áudio real; nenhuma saída de rede ativada.')
} finally {
  child.kill()
  for (const request of pending.values()) clearTimeout(request.timeout)
  await wait(300)
  rmSync(dir, { recursive: true, force: true })
}

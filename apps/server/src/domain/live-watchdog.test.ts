import { describe, expect, it } from 'vitest'
import { DEFAULT_LIVE_WATCHDOG_POLICY, LiveWatchdogPolicySchema, effectiveWatchdogPolicy, normalizeLiveWatchdogPolicy, type LiveWatchdogPolicy, type WatchdogSample } from '@rplayout/protocol'
import { ChannelLiveWatchdog, WatchdogMachine, detect, effectiveFps, type WatchdogEffect, type WatchdogExecutor } from './live-watchdog.js'

const T0 = Date.parse('2026-10-31T12:00:00.000Z')
const policy = (patch: Partial<LiveWatchdogPolicy> = {}): LiveWatchdogPolicy => ({ ...structuredClone(DEFAULT_LIVE_WATCHDOG_POLICY), mode: 'AUTOMATIC', contingencyRevisionId: 'rev-reserva', ...patch })
/** Amostra saudável de 29,97 quadros/s com áudio, medida "agora". */
function healthy(now: number, patch: Partial<WatchdogSample> = {}): WatchdogSample {
  return { sampledAt: new Date(now).toISOString(), videoAgeMs: 20, audioAgeMs: 15, videoPresent: true, audioPresent: true, rateNum: 30000, rateDen: 1001,
    receivedFrames: 5000, sampledContentUnchangedMs: 0, contentSampleAgeMs: 100, arrivalFps: 29.97, distinctFps: 29.97, lumaMeanPercent: 45, lumaStdPercent: 22,
    lumaSampleAgeMs: 100, audioRmsDbfs: -18, audioSampleRatio: 1, audioStalledMs: null, inputKbps: 4500, ...patch }
}
const lost = (now: number, since: number): WatchdogSample => healthy(now, { videoAgeMs: now - since, audioAgeMs: now - since, arrivalFps: 0, distinctFps: 0 })
const black = (now: number): WatchdogSample => healthy(now, { lumaMeanPercent: 0.4, lumaStdPercent: 0.2, sampledContentUnchangedMs: 1500 })
const context = (now: number) => ({ now, channelFps: 30000 / 1001, audioExpected: true })

/** Roda a máquina em passos de 250 ms, confirmando cada efeito na hora. */
function simulate(machine: WatchdogMachine, from: number, to: number, sampleAt: (now: number) => WatchdogSample | null, p: LiveWatchdogPolicy, effects: Array<{ at: number; effect: WatchdogEffect }>, confirm = (_: WatchdogEffect) => true) {
  for (let now = from; now <= to; now += 250) {
    const result = detect(sampleAt(now), p, context(now))
    for (const effect of machine.step(now, result.detections, p)) {
      effects.push({ at: now - T0, effect }); machine.begin(effect); machine.complete(effect, confirm(effect), now, 'recusado no teste')
    }
  }
}

describe('detectores do watchdog (sinal decodificado)', () => {
  it('perda de sinal usa a idade do último quadro mais o atraso da entrega', () => {
    const now = T0 + 10_000
    expect(detect(healthy(now), policy(), context(now)).detections.SIGNAL_LOSS.raw).toBe(false)
    const result = detect(lost(now, now - 2500), policy(), context(now))
    expect(result.detections.SIGNAL_LOSS).toEqual({ raw: true, measuredMs: 2500 })
    expect(detect(null, policy(), context(now)).detections.SIGNAL_LOSS.raw).toBe(true)
    // Amostra velha (engine parou de falar) também é perda, nunca "sinal OK".
    expect(detect(healthy(now - 5000), policy(), context(now)).detections.SIGNAL_LOSS.raw).toBe(true)
  })
  it('taxa baixa compara a taxa efetiva (quadros novos) com a referência do canal', () => {
    const now = T0
    expect(detect(healthy(now, { arrivalFps: 5, distinctFps: 5 }), policy(), context(now)).detections.LOW_FPS.raw).toBe(true)
    // 30 quadros/s chegando mas só 5 diferentes: fonte repetindo quadro.
    expect(effectiveFps(healthy(now, { arrivalFps: 29.97, distinctFps: 5 }))).toBe(5)
    expect(detect(healthy(now, { arrivalFps: 29.97, distinctFps: 5 }), policy(), context(now)).detections.LOW_FPS.raw).toBe(true)
    // 25p num canal 29,97 é 83 %: acima do limite padrão de 50 %.
    expect(detect(healthy(now, { arrivalFps: 25, distinctFps: 25, rateNum: 25, rateDen: 1 }), policy(), context(now)).detections.LOW_FPS.raw).toBe(false)
    // Referência pela entrada: 5 quadros/s declarados e entregues não é "baixo".
    expect(detect(healthy(now, { arrivalFps: 5, distinctFps: 5, rateNum: 5, rateDen: 1 }), policy({ fpsReference: 'SOURCE' }), context(now)).detections.LOW_FPS.raw).toBe(false)
    // Sem aquecimento (poucos quadros desde a abertura) não decide.
    expect(detect(healthy(now, { arrivalFps: 5, distinctFps: 5, receivedFrames: 10 }), policy(), context(now)).detections.LOW_FPS.raw).toBe(false)
  })
  it('preto exige luma baixa E pouca variância; preto parado não conta como congelado', () => {
    const now = T0
    const result = detect(black(now), policy(), context(now))
    expect(result.detections.BLACK.raw).toBe(true)
    expect(result.detections.FREEZE.raw).toBe(false)
    expect(result.metrics.lumaPercent).toBe(0.4)
    expect(detect(healthy(now, { lumaMeanPercent: 3, lumaStdPercent: 15 }), policy(), context(now)).detections.BLACK.raw).toBe(false)
    // Tela chapada azul do encoder: só com anyFlat.
    const flat = healthy(now, { lumaMeanPercent: 30, lumaStdPercent: 0.5 })
    expect(detect(flat, policy(), context(now)).detections.BLACK.raw).toBe(false)
    const anyFlat = policy(); anyFlat.detections.BLACK.anyFlat = true
    expect(detect(flat, anyFlat, context(now)).detections.BLACK.raw).toBe(true)
  })
  it('congelamento usa a duração medida no engine', () => {
    const now = T0
    expect(detect(healthy(now, { sampledContentUnchangedMs: 4200 }), policy(), context(now)).detections.FREEZE).toEqual({ raw: true, measuredMs: 4200 })
    expect(detect(healthy(now, { sampledContentUnchangedMs: 4200, contentSampleAgeMs: 3000 }), policy(), context(now)).detections.FREEZE.raw).toBe(false)
    // Parado com quadro-chave a cada 1 s: 1 quadro novo/s, mas é congelamento, não taxa baixa.
    expect(detect(healthy(now, { arrivalFps: 30, distinctFps: 1, lumaStaticMs: 3000 }), policy(), context(now)).detections.LOW_FPS.raw).toBe(false)
    // Fonte recodificada: quadro-chave muda bits, mas a grade de luma segue parada.
    expect(detect(healthy(now, { sampledContentUnchangedMs: 300, lumaStaticMs: 6100 }), policy(), context(now)).detections.FREEZE).toEqual({ raw: true, measuredMs: 6100 })
  })
  it('áudio: silêncio, travado (parado, repetido, poucas amostras) e ausente', () => {
    const now = T0
    expect(detect(healthy(now, { audioRmsDbfs: -80 }), policy(), context(now)).detections.SILENCE.raw).toBe(true)
    expect(detect(healthy(now, { audioAgeMs: 1200 }), policy(), context(now)).detections.AUDIO_STALL.raw).toBe(true)
    // Idade de até 1 s é só a cadência da telemetria (500 ms) somada ao atraso de entrega.
    expect(detect(healthy(now, { audioAgeMs: 480 }), policy(), context(now)).detections.AUDIO_STALL.raw).toBe(false)
    expect(detect(healthy(now, { audioStalledMs: 800 }), policy(), context(now)).detections.AUDIO_STALL).toEqual({ raw: true, measuredMs: 800 })
    expect(detect(healthy(now, { audioSampleRatio: 0.3 }), policy(), context(now)).detections.AUDIO_STALL.raw).toBe(true)
    expect(detect(healthy(now, { audioAgeMs: null }), policy(), context(now)).detections.AUDIO_MISSING.raw).toBe(true)
    // Entrada sem áudio por natureza não alarma.
    expect(detect(healthy(now, { audioAgeMs: null }), policy(), { ...context(now), audioExpected: false }).detections.AUDIO_MISSING.raw).toBe(false)
  })
  it('taxa de dados só quando a entrada informa (SRT/RTMP)', () => {
    const now = T0
    expect(detect(healthy(now, { inputKbps: 120 }), policy(), context(now)).detections.LOW_BITRATE.raw).toBe(true)
    expect(detect(healthy(now, { inputKbps: null }), policy(), context(now)).detections.LOW_BITRATE.raw).toBe(false)
  })
})

describe('máquina de estados do watchdog', () => {
  it('queda de 3 s: espera com arte, sem contingência, e retorno automático depois de T2', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy(), states: string[] = []
    const dropFrom = T0 + 2000, dropTo = T0 + 5000
    for (let now = T0; now <= T0 + 20_000; now += 250) {
      simulate(machine, now, now, at => at >= dropFrom && at < dropTo ? lost(at, dropFrom) : healthy(at), p, effects)
      if (states.at(-1) !== machine.state) states.push(machine.state)
    }
    expect(states).toEqual(['OK', 'SUSPEITA', 'ESPERA', 'RETORNO', 'OK'])
    expect(effects.map(row => row.effect)).toEqual(['SHOW_WAIT', 'HIDE_WAIT'])
    // Espera entra ao passar 1 s sem quadro; sai depois da histerese (1,5 s desde a última amostra ruim) + 5 s estáveis.
    expect(effects[0]!.at).toBe(3000)
    expect(effects[1]!.at).toBeGreaterThanOrEqual(4750 + 1500 + 5000)
  })
  it('queda de 15 s: espera, contingência após T1, observação no PVW e retorno à live', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy()
    const dropFrom = T0 + 1000, dropTo = T0 + 16_000
    for (let now = T0; now <= T0 + 40_000; now += 250) {
      // Em contingência o PGM é arquivo: a entrada só aparece no PVW, depois do CUE.
      const sample = (at: number) => at >= dropFrom && at < dropTo ? lost(at, dropFrom) : machine.contingencyOnAir && !machine.monitoring ? null : healthy(at)
      simulate(machine, now, now, sample, p, effects)
    }
    expect(effects.map(row => row.effect)).toEqual(['SHOW_WAIT', 'ENTER_CONTINGENCY', 'MONITOR_SOURCE', 'RETURN_LIVE'])
    // Perda vista quando a idade passa de 750 ms (cadência da telemetria) e confirmada em 1 s.
    expect(effects[0]!.at).toBe(2250)
    expect(effects[1]!.at).toBe(7250) // 5 s de espera (T1)
    expect(effects[3]!.at).toBeGreaterThanOrEqual(16_000 + 5000)
    expect(machine.state).toBe('OK')
    expect(machine.contingencyOnAir).toBe(false)
  })
  it('fade-to-black de 4 s não aciona contingência com os padrões; com limite de 6 s nem a espera entra', () => {
    for (const [threshold, expected] of [[3000, ['SHOW_WAIT', 'HIDE_WAIT']], [6000, []]] as const) {
      const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy()
      p.detections.BLACK.thresholdMs = threshold
      // Fade de 4 s: luma cai até o preto; 4 s de preto; a imagem volta.
      simulate(machine, T0, T0 + 25_000, at => at >= T0 + 2000 && at < T0 + 6000 ? black(at) : at >= T0 && at < T0 + 2000 ? healthy(at, { lumaMeanPercent: 45 - (at - T0) / 50 }) : healthy(at), p, effects)
      expect(effects.map(row => row.effect)).toEqual(expected)
      expect(effects.some(row => row.effect === 'ENTER_CONTINGENCY')).toBe(false)
    }
  })
  it('preto que passa de limite + T1 vira contingência', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy()
    simulate(machine, T0, T0 + 12_000, at => at >= T0 + 1000 ? black(at) : healthy(at), p, effects)
    // Os 2 s iniciais são aquecimento: o preto conta a partir de 2 s; 3 s de limite + 5 s de T1.
    expect(effects.map(row => [row.effect, row.at])).toEqual([['SHOW_WAIT', 5000], ['ENTER_CONTINGENCY', 10000], ['MONITOR_SOURCE', 10250]])
  })
  it('histerese: falha intermitente não fica trocando e acumula até a contingência', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy()
    // 1,5 s sem quadro / 1 s bom, repetidamente.
    simulate(machine, T0, T0 + 12_000, at => { const phase = (at - T0) % 2500; return phase < 1500 ? lost(at, at - phase) : healthy(at) }, p, effects)
    expect(effects.filter(row => row.effect === 'SHOW_WAIT')).toHaveLength(1)
    expect(effects.filter(row => row.effect === 'HIDE_WAIT')).toHaveLength(0)
    expect(effects.some(row => row.effect === 'ENTER_CONTINGENCY')).toBe(true)
    const transitions = machine.drainEvents().filter(event => event.kind === 'TRANSITION')
    expect(transitions.length).toBeLessThanOrEqual(4)
  })
  it('retorno manual espera o operador; "manter contingência" bloqueia o retorno automático', () => {
    for (const variant of ['MANUAL', 'HOLD'] as const) {
      const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy({ returnMode: variant === 'MANUAL' ? 'MANUAL' : 'AUTO' })
      simulate(machine, T0, T0 + 9000, at => at >= T0 + 1000 ? lost(at, T0 + 1000) : healthy(at), p, effects)
      expect(machine.state).toBe('CONTINGENCIA')
      if (variant === 'HOLD') machine.operatorHold(T0 + 9000, true, 'sup')
      simulate(machine, T0 + 9250, T0 + 30_000, at => healthy(at), p, effects)
      expect(machine.state).toBe('RETORNO')
      expect(machine.awaitingOperator).toBe(true)
      expect(effects.some(row => row.effect === 'RETURN_LIVE')).toBe(false)
      expect(machine.operatorReturn(T0 + 30_000, 'op')).toEqual(['RETURN_LIVE'])
    }
  })
  it('canal sem PVW: retorno por tentativa de TAKE depois de T2, repetida se recusada', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy()
    machine.blindReturn = true
    let refuse = true
    simulate(machine, T0, T0 + 40_000, at => at >= T0 + 3000 && !machine.contingencyOnAir ? lost(at, T0 + 3000) : null, p, effects, effect => !(effect === 'RETURN_LIVE' && refuse))
    const returns = effects.filter(row => row.effect === 'RETURN_LIVE').map(row => row.at)
    expect(effects.some(row => row.effect === 'MONITOR_SOURCE')).toBe(false)
    expect(returns[0]).toBe(9250 + 5000)
    expect(returns[1]! - returns[0]!).toBeGreaterThanOrEqual(10_000)
    refuse = false
    simulate(machine, T0 + 40_250, T0 + 60_000, at => machine.contingencyOnAir ? null : healthy(at), p, effects)
    expect(machine.state).toBe('OK')
  })
  it('sem PVW: live que volta e cai de novo logo dobra a espera da próxima tentativa (sem ficar trocando)', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy()
    machine.blindReturn = true
    // A entrada está preta o tempo todo: cada retorno às cegas confirma (há quadro) mas o preto volta.
    simulate(machine, T0, T0 + 120_000, at => machine.contingencyOnAir ? null : black(at), p, effects)
    const returns = effects.filter(row => row.effect === 'RETURN_LIVE').map(row => row.at)
    const gaps = returns.slice(1).map((at, index) => at - returns[index]!)
    expect(returns.length).toBeGreaterThanOrEqual(3)
    expect(returns.length).toBeLessThanOrEqual(6)
    expect(gaps.every((gap, index) => index === 0 || gap > gaps[index - 1]!)).toBe(true)
  })
  it('modo só-alerta nunca mexe no PGM, mas registra a condição uma vez', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy({ mode: 'ALERT_ONLY' })
    simulate(machine, T0, T0 + 20_000, at => at >= T0 + 1000 ? lost(at, T0 + 1000) : healthy(at), p, effects)
    expect(effects).toEqual([])
    expect(machine.state).toBe('SUSPEITA')
    expect(machine.drainEvents().filter(event => event.kind === 'CONDITION')).toHaveLength(1)
  })
  it('contingência recusada não avança e só tenta de novo depois de 10 s', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy()
    simulate(machine, T0, T0 + 20_000, at => at >= T0 + 1000 ? lost(at, T0 + 1000) : healthy(at), p, effects, effect => effect !== 'ENTER_CONTINGENCY')
    const attempts = effects.filter(row => row.effect === 'ENTER_CONTINGENCY').map(row => row.at)
    expect(attempts).toEqual([7250, 17250])
    expect(machine.state).toBe('CONTINGENCIA')
    expect(machine.lastError).toBe('recusado no teste')
    expect(machine.drainEvents().filter(event => event.kind === 'ACTION_FAILED')).toHaveLength(2)
  })
  it('sem playlist de contingência: mantém a arte de espera e avisa', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy({ contingencyRevisionId: null })
    simulate(machine, T0, T0 + 12_000, at => at >= T0 + 1000 ? lost(at, T0 + 1000) : healthy(at), p, effects)
    expect(effects.map(row => row.effect)).toEqual(['SHOW_WAIT'])
    expect(machine.state).toBe('CONTINGENCIA')
    expect(machine.waitArtOnAir).toBe(true)
  })
  it('congelar último quadro não manda arte', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy({ waitArt: { kind: 'HOLD_LAST_FRAME' } })
    simulate(machine, T0, T0 + 4000, at => at >= T0 + 1000 ? lost(at, T0 + 1000) : healthy(at), p, effects)
    expect(machine.state).toBe('ESPERA')
    expect(effects).toEqual([])
  })
})

describe('watchdog do canal com executor', () => {
  it('acompanha a live do PGM, observa no PVW durante a contingência e volta', async () => {
    const calls: string[] = []
    let contingency = false
    const executor: WatchdogExecutor = {
      showWait: async art => { calls.push('show:' + art.kind) },
      hideWait: async () => { calls.push('hide') },
      enterContingency: async revision => { calls.push('enter:' + revision); contingency = true },
      monitorSource: async source => { calls.push('monitor:' + source) },
      returnLive: async () => { calls.push('return'); contingency = false },
      contingencyActive: () => contingency,
    }
    const watchdog = new ChannelLiveWatchdog(executor), p = policy()
    const source = (sample: WatchdogSample | null) => ({ sourceKey: 'srt://cam', sourceId: 'cam', name: 'Câmera leilão', kind: 'SRT', itemId: 'live-1', sample })
    let now = T0
    const step = async (until: number, program: (at: number) => WatchdogSample | null, preview: (at: number) => WatchdogSample | null) => {
      for (; now <= until; now += 250) {
        watchdog.tick({ now, policy: p, channelFps: 29.97, program: contingency ? null : source(program(now)), preview: contingency && preview(now) ? [source(preview(now))] : [] }, () => now)
        await new Promise(resolve => setImmediate(resolve))
      }
    }
    await step(T0 + 1000, at => healthy(at), () => null)
    await step(T0 + 9000, at => lost(at, T0 + 1000), () => null)
    expect(calls).toEqual(['show:SLATE', 'enter:rev-reserva', 'monitor:srt://cam'])
    expect(watchdog.status(now, p)[0]).toMatchObject({ state: 'CONTINGENCIA', contingencyOnAir: true, bus: 'pgm', name: 'Câmera leilão' })
    await step(T0 + 20_000, at => healthy(at), at => healthy(at))
    expect(calls.at(-1)).toBe('return')
    expect(watchdog.status(now, p)[0]).toMatchObject({ state: 'OK', contingencyOnAir: false })
    const events = watchdog.drain()
    expect(events.filter(event => event.kind === 'TRANSITION').map(event => event.to)).toEqual(['SUSPEITA', 'ESPERA', 'CONTINGENCIA', 'RETORNO', 'OK'])
  })
  it('se a entrada some do PVW durante a contingência, volta a sintonizá-la', async () => {
    const calls: string[] = []
    let contingency = false
    const watchdog = new ChannelLiveWatchdog({ showWait: async () => {}, hideWait: async () => {}, enterContingency: async () => { contingency = true }, monitorSource: async source => { calls.push('monitor:' + source) }, returnLive: async () => {}, contingencyActive: () => contingency })
    const p = policy(), source = (sample: WatchdogSample | null) => ({ sourceKey: 'srt://cam', sourceId: null, name: 'cam', kind: 'SRT', itemId: 'live', sample })
    for (let now = T0; now <= T0 + 20_000; now += 250) {
      // Até 12 s a entrada aparece no PVW (sem sinal); depois um CUE do operador a tira.
      const preview = contingency && now < T0 + 12_000 ? [source(lost(now, T0))] : []
      watchdog.tick({ now, policy: p, channelFps: 29.97, program: contingency ? null : source(lost(now, T0)), preview }, () => now)
      await new Promise(resolve => setImmediate(resolve))
    }
    expect(calls).toEqual(['monitor:srt://cam', 'monitor:srt://cam'])
  })
  it('servidor reiniciado com a reserva no ar: retoma a contingência e volta à live', async () => {
    const calls: string[] = []
    let contingency = true
    const origin = { sourceKey: 'srt://cam', sourceId: 'cam', name: 'cam', kind: 'SRT', itemId: 'live', sample: null }
    const watchdog = new ChannelLiveWatchdog({ showWait: async () => {}, hideWait: async () => {}, enterContingency: async () => {}, monitorSource: async () => {}, returnLive: async () => { calls.push('return'); contingency = false },
      contingencyActive: () => contingency, canMonitor: () => false, contingencyOrigin: () => origin })
    const p = policy()
    for (let now = T0; now <= T0 + 12_000; now += 250) {
      watchdog.tick({ now, policy: p, channelFps: 29.97, program: contingency ? null : { ...origin, sample: healthy(now) }, preview: [] }, () => now)
      await new Promise(resolve => setImmediate(resolve))
    }
    expect(calls).toEqual(['return'])
    expect(watchdog.status(T0 + 12_000, p)[0]).toMatchObject({ state: 'OK' })
    expect(watchdog.drain()[0]!.message).toMatch(/retomou/)
  })
  it('TAKE manual para outro item encerra o acompanhamento e retira a arte de espera', async () => {
    const calls: string[] = []
    const watchdog = new ChannelLiveWatchdog({ showWait: async () => { calls.push('show') }, hideWait: async () => { calls.push('hide') }, enterContingency: async () => {}, monitorSource: async () => {}, returnLive: async () => {}, contingencyActive: () => false })
    const p = policy()
    for (let now = T0; now <= T0 + 3000; now += 250) { watchdog.tick({ now, policy: p, channelFps: 29.97, program: { sourceKey: 'srt://cam', sourceId: null, name: 'cam', kind: 'SRT', itemId: 'x', sample: now > T0 + 500 ? lost(now, T0 + 500) : healthy(now) }, preview: [] }, () => now); await new Promise(resolve => setImmediate(resolve)) }
    watchdog.tick({ now: T0 + 3250, policy: p, channelFps: 29.97, program: null, preview: [] }, () => T0 + 3250)
    await new Promise(resolve => setImmediate(resolve))
    expect(calls).toEqual(['show', 'hide'])
    expect(watchdog.status(T0 + 3500, p)).toEqual([])
  })
  it('entrada no PVW é medida e alertada, nunca acionada', async () => {
    const calls: string[] = []
    const watchdog = new ChannelLiveWatchdog({ showWait: async () => { calls.push('show') }, hideWait: async () => {}, enterContingency: async () => {}, monitorSource: async () => {}, returnLive: async () => {}, contingencyActive: () => false })
    const p = policy()
    for (let now = T0; now <= T0 + 8000; now += 250) watchdog.tick({ now, policy: p, channelFps: 29.97, program: null, preview: [{ sourceKey: 'srt://b', sourceId: null, name: 'b', kind: 'SRT', itemId: 'source:srt://b', sample: black(now) }] }, () => now)
    expect(calls).toEqual([])
    expect(watchdog.status(T0 + 8000, p)[0]).toMatchObject({ bus: 'pvw', state: 'SUSPEITA', mode: 'ALERT_ONLY' })
    expect(watchdog.drain().filter(event => event.kind === 'CONDITION' && event.bus === 'pvw')).toHaveLength(1)
  })
})

describe('política configurável do watchdog', () => {
  it('padrões válidos: só alerta, T1 = 5 s, contingência sem playlist', () => {
    expect(LiveWatchdogPolicySchema.safeParse(DEFAULT_LIVE_WATCHDOG_POLICY).success).toBe(true)
    expect(DEFAULT_LIVE_WATCHDOG_POLICY).toMatchObject({ mode: 'ALERT_ONLY', waitMs: 5000, returnMode: 'AUTO' })
  })
  it('recusa limites fora da faixa, campos desconhecidos e perda de sinal desligada no automático', () => {
    const bad = (patch: (value: LiveWatchdogPolicy) => void) => { const value = structuredClone(DEFAULT_LIVE_WATCHDOG_POLICY) as LiveWatchdogPolicy; patch(value); return LiveWatchdogPolicySchema.safeParse(value).success }
    expect(bad(value => { value.waitMs = 120_000 })).toBe(false)
    expect(bad(value => { value.detections.BLACK.thresholdMs = 50 })).toBe(false)
    expect(bad(value => { (value as unknown as Record<string, unknown>).extra = 1 })).toBe(false)
    expect(bad(value => { value.mode = 'AUTOMATIC'; value.detections.SIGNAL_LOSS.action = 'OFF' })).toBe(false)
    expect(bad(value => { value.mode = 'AUTOMATIC'; value.waitArt = { kind: 'GRAPHIC', templateId: 'arte' } })).toBe(true)
  })
  it('lê configuração antiga/incompleta completando com o padrão', () => {
    const stored = normalizeLiveWatchdogPolicy({ version: 1, mode: 'AUTOMATIC', waitMs: 3000, detections: { BLACK: { thresholdMs: 6000 } } })
    expect(stored.mode).toBe('AUTOMATIC')
    expect(stored.waitMs).toBe(3000)
    expect(stored.detections.BLACK).toMatchObject({ thresholdMs: 6000, action: 'ACT', lumaMaxPercent: 6 })
    expect(normalizeLiveWatchdogPolicy('lixo')).toEqual(DEFAULT_LIVE_WATCHDOG_POLICY)
  })
  it('ajuste por entrada: modo próprio e entrada sem áudio', () => {
    const base = policy({ overrides: { cam: { mode: 'ALERT_ONLY', audioExpected: false, actions: { FREEZE: 'ALERT' } } } })
    const effective = effectiveWatchdogPolicy(base, 'cam')
    expect(effective.mode).toBe('ALERT_ONLY')
    expect(effective.detections.SILENCE.action).toBe('OFF')
    expect(effective.detections.AUDIO_STALL.action).toBe('OFF')
    expect(effective.detections.FREEZE.action).toBe('ALERT')
    expect(effectiveWatchdogPolicy(base, 'outra').mode).toBe('AUTOMATIC')
  })
})

describe('paradas da entrada ao vivo (para o AIRED)', () => {
  const outages = (machine: WatchdogMachine) => machine.drainEvents().filter(event => event.kind === 'OUTAGE').map(event => event.outage!)
  it('parada no meio do item: começa quando o sinal sumiu e termina quando a live voltou, com a ação tomada', () => {
    const machine = new WatchdogMachine('srt://x', T0), effects: Array<{ at: number; effect: WatchdogEffect }> = [], p = policy()
    simulate(machine, T0, T0 + 20_000, at => at >= T0 + 4000 && at < T0 + 7000 ? lost(at, T0 + 4000) : healthy(at), p, effects)
    const rows = outages(machine)
    expect(rows[0]).toMatchObject({ phase: 'OPEN', startedAt: T0 + 4000, action: 'NONE', reasons: ['SIGNAL_LOSS'] })
    const close = rows.find(row => row.phase === 'CLOSE')!
    expect(close.action).toBe('WAIT_ART')
    expect(close.closedBy).toBe('SIGNAL_RETURNED')
    // Termina quando a arte sai e a live volta ao ar (sinal estável por T2).
    expect(close.endedAt! - T0).toBeGreaterThanOrEqual(7000 + 5000)
  })
  it('mais de uma parada no mesmo item, inclusive só alerta (termina quando o sinal volta)', () => {
    const machine = new WatchdogMachine('srt://x', T0), p = policy({ mode: 'ALERT_ONLY' })
    const bad = (at: number) => (at >= T0 + 3000 && at < T0 + 6000) || (at >= T0 + 15_000 && at < T0 + 19_000)
    simulate(machine, T0, T0 + 30_000, at => bad(at) ? lost(at, at < T0 + 10_000 ? T0 + 3000 : T0 + 15_000) : healthy(at), p, [])
    const closed = outages(machine).filter(row => row.phase === 'CLOSE')
    expect(closed).toHaveLength(2)
    expect(closed.map(row => [row.startedAt - T0, row.endedAt! - T0, row.action])).toEqual([[3000, 5750, 'NONE'], [15_000, 18_750, 'NONE']])
  })
  it('contingência fica registrada na parada; item que sai do ar fecha a parada aberta', () => {
    const machine = new WatchdogMachine('srt://x', T0), p = policy()
    simulate(machine, T0, T0 + 9000, at => at >= T0 + 3000 ? lost(at, T0 + 3000) : healthy(at), p, [])
    machine.abandon(T0 + 9500, 'TAKE manual')
    const rows = outages(machine)
    expect(rows.at(-1)).toMatchObject({ phase: 'CLOSE', action: 'CONTINGENCY', closedBy: 'ITEM_ENDED', endedAt: T0 + 9500 })
    expect(machine.outage).toBeNull()
  })
})


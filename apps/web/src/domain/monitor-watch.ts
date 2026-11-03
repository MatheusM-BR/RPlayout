import type { MonitorBus } from '@rplayout/protocol'

/**
 * Um só aviso "estou vendo" por aba, para todos os monitores abertos.
 *
 * Cada monitor (PGM, PVW, multiview, cartões da Engenharia) chamava a rota
 * `watching` a cada 5 s por conta própria, e a recuperação de WHEP somava
 * outro relógio: ~1 POST por segundo por aba. Agora cada monitor só "toca" o
 * registro desta aba; um relógio único manda, por canal, um POST com todos
 * os monitores tocados recentemente.
 *
 * - Monitor novo: aviso imediato (a imagem acende sem esperar o intervalo).
 * - Aba oculta: nenhum aviso. Ninguém vê o vídeo; em 20 s o servidor desliga
 *   a codificação e devolve placa/CPU. Ao voltar, o aviso sai na hora.
 * - Monitor fechado (não toca mais): sai do aviso em {@link WATCH_TTL_MS}.
 */
export const WATCH_BEAT_MS = 7_000
/** O servidor desliga um monitor após 20 s sem aviso; 7 s tolera dois perdidos. */
export const WATCH_TTL_MS = 16_000
export type Tier = 'ref' | 'std' | 'lite'
export interface WatchEntry { bus: MonitorBus; tier?: Tier }
export type WatchSender = (channelId: string, monitors: WatchEntry[]) => Promise<unknown>

interface Timers { setInterval: (fn: () => void, ms: number) => number; clearInterval: (id: number) => void; setTimeout: (fn: () => void, ms: number) => number }

export class MonitorWatch {
  private readonly entries = new Map<string, { channelId: string; entry: WatchEntry; touchedAt: number }>()
  private beat: number | null = null
  private pendingFlush = false

  constructor(
    private readonly send: WatchSender,
    private readonly hidden: () => boolean = () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    private readonly now: () => number = () => Date.now(),
    private readonly timers: Timers = { setInterval: (fn, ms) => window.setInterval(fn, ms), clearInterval: id => window.clearInterval(id), setTimeout: (fn, ms) => window.setTimeout(fn, ms) },
  ) {}

  /** Um monitor deste canal está aberto (chamado a cada batida do monitor). */
  touch(channelId: string, bus: MonitorBus, tier?: Tier): void {
    const key = `${channelId}|${bus}|${tier ?? ''}`
    const known = this.entries.has(key)
    this.entries.set(key, { channelId, entry: tier ? { bus, tier } : { bus }, touchedAt: this.now() })
    if (!known) this.flushSoon()
    this.arm()
  }

  /** O monitor fechou: para de avisar já, sem esperar o prazo. */
  release(channelId: string, bus: MonitorBus, tier?: Tier): void {
    for (const [key, value] of this.entries) if (value.channelId === channelId && value.entry.bus === bus && (tier === undefined || value.entry.tier === tier)) this.entries.delete(key)
    this.arm()
  }

  /** A aba voltou a ficar visível: avisa já o que ainda está aberto. */
  visible(): void { this.flushSoon(); this.arm() }

  /** Quantos POSTs a próxima batida faria (um por canal). */
  get channels(): number { return new Set([...this.live()].map(value => value.channelId)).size }

  private *live() {
    const limit = this.now() - WATCH_TTL_MS
    for (const [key, value] of this.entries) {
      if (value.touchedAt < limit) { this.entries.delete(key); continue }
      yield value
    }
  }

  private flushSoon(): void {
    if (this.pendingFlush) return
    this.pendingFlush = true
    // Coalesce: PGM e PVW que abrem juntos saem no mesmo POST.
    this.timers.setTimeout(() => { this.pendingFlush = false; this.flush() }, 30)
  }

  flush(): void {
    if (this.hidden()) return
    const byChannel = new Map<string, WatchEntry[]>()
    for (const value of this.live()) {
      const list = byChannel.get(value.channelId) ?? []
      if (!list.some(entry => entry.bus === value.entry.bus && entry.tier === value.entry.tier)) list.push(value.entry)
      byChannel.set(value.channelId, list)
    }
    for (const [channelId, monitors] of byChannel) void this.send(channelId, monitors.slice(0, 16)).catch(() => undefined)
    this.arm()
  }

  private arm(): void {
    const wanted = this.entries.size > 0 && !this.hidden()
    if (wanted && this.beat === null) this.beat = this.timers.setInterval(() => this.flush(), WATCH_BEAT_MS)
    else if (!wanted && this.beat !== null) { this.timers.clearInterval(this.beat); this.beat = null }
  }
}

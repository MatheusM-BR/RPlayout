import { useEffect, useRef, useState } from 'react'

/**
 * Releitura dirigida pelo servidor, no lugar de polling fixo.
 *
 * O servidor manda pelo WebSocket `{type:'topics', channelId, revs}` quando
 * um estado muda (camadas de GC, sonda PGM, watchdog, retornos, próxima
 * playlist, continuidade, engine, scanner, alertas, relógio). Cada tela relê
 * a sua rota HTTP só quando a revisão do tópico dela sobe. Sobra um polling
 * longo de segurança enquanto a aba está visível, e o polling antigo volta
 * enquanto o WebSocket não está entregando tópicos (servidor antigo, rede
 * caída): perder o aviso nunca congela a tela.
 *
 * Aba oculta não relê nada (exceto quem pede `whileHidden`, como o alarme de
 * pendências); ao voltar a ficar visível, relê o que ficou velho.
 */
export type TopicName = 'graphics' | 'probe' | 'watchdog' | 'interruptions' | 'nextPlaylist' | 'continuity' | 'engine' | 'scan' | 'health' | 'clock'
export interface ProbeLive { lastSampleAt: string | null; metrics: { blackDurationMs: number; freezeDurationMs: number; silenceDurationMs: number; audioDbfs: number | null } }
export interface TopicsMessage { type: 'topics'; channelId: string | null; revs: Partial<Record<TopicName, number>>; probe?: ProbeLive }

type Listener = (channelId: string | null, changed: ReadonlySet<TopicName>) => void
const revisions = new Map<string, Partial<Record<TopicName, number>>>()
const probes = new Map<string, ProbeLive>()
const listeners = new Set<Listener>()
const connectionListeners = new Set<() => void>()
const probeListeners = new Set<() => void>()
let connected = false

const key = (channelId: string | null) => channelId ?? '*'

/** Mensagem `topics` recebida do WebSocket. */
export function applyTopics(message: TopicsMessage): void {
  const previous = revisions.get(key(message.channelId)) ?? {}
  const changed = new Set<TopicName>()
  for (const [topic, rev] of Object.entries(message.revs) as [TopicName, number][]) if (previous[topic] !== rev) changed.add(topic)
  revisions.set(key(message.channelId), { ...previous, ...message.revs })
  if (message.probe && message.channelId) { probes.set(message.channelId, message.probe); for (const listener of probeListeners) listener() }
  if (!connected) { connected = true; for (const listener of connectionListeners) listener() }
  if (!changed.size) return
  for (const listener of listeners) listener(message.channelId, changed)
}

/** WebSocket caiu: as telas voltam ao polling de antes até a próxima mensagem. */
export function topicsDisconnected(): void {
  if (!connected) return
  connected = false
  revisions.clear()
  for (const listener of connectionListeners) listener()
}

export function topicsConnected(): boolean { return connected }

export function latestProbe(channelId: string): ProbeLive | null { return probes.get(channelId) ?? null }

export function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export interface TopicRefreshOptions {
  /** Intervalo de segurança com tópicos chegando (aba visível). Nulo desliga. */
  fallbackMs?: number | null
  /** Intervalo enquanto o WebSocket não entrega tópicos (o polling de antes). */
  degradedMs?: number | null
  /** Relê mesmo com a aba oculta quando o tópico muda (alarme sonoro). */
  whileHidden?: boolean
  /** Desliga tudo (painel fechado, sem canal). */
  enabled?: boolean
}

/**
 * Chama `refresh` quando o tópico muda, quando a aba volta a ficar visível com
 * leitura pendente, e no intervalo de segurança. Não faz a leitura inicial:
 * cada tela continua lendo ao montar, como antes.
 */
export function useTopicRefresh(topics: TopicName | readonly TopicName[], channelId: string | null, refresh: () => void, options: TopicRefreshOptions = {}): void {
  const { fallbackMs = 60_000, degradedMs = null, whileHidden = false, enabled = true } = options
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const list = typeof topics === 'string' ? topics : topics.join(',')
  const [online, setOnline] = useState(connected)
  useEffect(() => {
    const sync = () => setOnline(connected)
    connectionListeners.add(sync); sync()
    return () => { connectionListeners.delete(sync) }
  }, [])
  useEffect(() => {
    if (!enabled) return undefined
    const wanted = new Set(list.split(',') as TopicName[])
    let stale = false
    let timer: number | undefined
    const run = () => { stale = false; refreshRef.current() }
    const interval = online ? fallbackMs : degradedMs
    const arm = () => {
      window.clearInterval(timer); timer = undefined
      if (interval && !documentHidden()) timer = window.setInterval(() => { if (documentHidden()) { stale = true; return } run() }, interval)
    }
    const onTopics: Listener = (changedChannel, changed) => {
      if (changedChannel !== null && changedChannel !== channelId) return
      if (![...changed].some(topic => wanted.has(topic))) return
      if (documentHidden() && !whileHidden) { stale = true; return }
      run()
    }
    const onVisibility = () => {
      if (documentHidden()) { window.clearInterval(timer); timer = undefined; return }
      // Voltou: relê o que mudou escondido e, sem tópicos, o que envelheceu.
      if (stale || !online) run()
      arm()
    }
    listeners.add(onTopics)
    document.addEventListener('visibilitychange', onVisibility)
    arm()
    return () => { listeners.delete(onTopics); document.removeEventListener('visibilitychange', onVisibility); window.clearInterval(timer) }
  }, [list, channelId, online, fallbackMs, degradedMs, whileHidden, enabled])
}

/** Leitura viva da sonda (preto/congelado/silêncio em curso e amostra). */
export function useProbeLive(channelId: string): ProbeLive | null {
  const [value, setValue] = useState<ProbeLive | null>(() => latestProbe(channelId))
  useEffect(() => {
    const sync = () => setValue(latestProbe(channelId))
    probeListeners.add(sync); sync()
    return () => { probeListeners.delete(sync) }
  }, [channelId])
  return value
}

/**
 * Polling simples que respeita a aba: pausa oculta, relê ao voltar. Para o
 * que não tem tópico (telas técnicas, painéis abertos sob demanda).
 */
export function useVisiblePolling(refresh: () => void, intervalMs: number | null, enabled = true): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!enabled || !intervalMs) return undefined
    let timer: number | undefined
    let last = Date.now()
    const run = () => { last = Date.now(); refreshRef.current() }
    const arm = () => { window.clearInterval(timer); timer = documentHidden() ? undefined : window.setInterval(run, intervalMs) }
    const onVisibility = () => { if (!documentHidden() && Date.now() - last >= intervalMs) run(); arm() }
    document.addEventListener('visibilitychange', onVisibility)
    arm()
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.clearInterval(timer) }
  }, [intervalMs, enabled])
}

/** Espera com backoff exponencial e teto, para 425/503/erro de rede. */
export function backoffDelay(attempt: number, baseMs = 1000, capMs = 30_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt))
  // ±20% para várias abas não baterem juntas no mesmo segundo.
  return Math.round(exponential * (0.8 + Math.random() * 0.4))
}

/** Envolve o passo de um polling para não rodar com a aba oculta. */
export function whenVisible(step: () => void): () => void {
  return () => { if (!documentHidden()) step() }
}

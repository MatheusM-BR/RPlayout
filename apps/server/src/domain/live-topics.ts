/**
 * Revisões de tópicos empurradas pelo WebSocket.
 *
 * A interface consultava por HTTP, de 1 em 1 a 3 em 3 segundos, estados que
 * quase nunca mudam (camadas de GC, sonda PGM, watchdog, retornos, próxima
 * playlist, continuidade, engine, scanner, alertas): ~5 requisições por
 * segundo por aba aberta, com o Master parado. Aqui o servidor calcula, uma
 * vez por segundo e só com alguém conectado, uma assinatura de cada tópico a
 * partir do estado em memória (e de poucas consultas indexadas). Quando a
 * assinatura muda, a revisão do tópico sobe e sai uma mensagem pequena:
 *
 *   { type: 'topics', channelId, revs: { graphics: 3, probe: 7, ... }, probe? }
 *
 * A mensagem não carrega dado de domínio, só "mudou": quem precisa relê pela
 * rota HTTP de sempre, com as mesmas checagens de acesso. Campos voláteis
 * (agora, duração em curso, amostra) ficam fora da assinatura -- senão o
 * tópico mudaria a cada segundo e voltaríamos ao polling. As leituras da sonda
 * que mudam o tempo todo (preto/congelado/silêncio em curso e o horário da
 * amostra) seguem junto, compactas, para o banner do Master não precisar
 * consultar a rota a cada 2 s.
 */
export type TopicSignature = () => unknown

export interface TopicsMessage {
  type: 'topics'
  /** Nulo para tópicos do servidor (scanner, alertas, relógio). */
  channelId: string | null
  revs: Record<string, number>
  probe?: unknown
}

interface Scope { signatures: Map<string, string>; revs: Record<string, number>; probe: string | null; probeValue: unknown }

export class LiveTopics {
  private readonly scopes = new Map<string, Scope>()
  private generation = 0

  private scope(key: string): Scope {
    let scope = this.scopes.get(key)
    if (!scope) { scope = { signatures: new Map(), revs: {}, probe: null, probeValue: undefined }; this.scopes.set(key, scope) }
    return scope
  }

  /**
   * Avalia as assinaturas de um escopo (canal ou servidor) e devolve a
   * mensagem a transmitir, ou nulo se nada mudou. Falha numa assinatura não
   * derruba as outras: o tópico só não muda nesta volta.
   */
  sample(channelId: string | null, topics: Record<string, TopicSignature>, probe?: () => unknown): TopicsMessage | null {
    const scope = this.scope(channelId ?? '*')
    let changed = false
    for (const [topic, read] of Object.entries(topics)) {
      let signature: string
      try { signature = JSON.stringify(read()) ?? 'undefined' } catch { continue }
      const previous = scope.signatures.get(topic)
      if (previous === signature) continue
      scope.signatures.set(topic, signature)
      // Revisão crescente e única no processo: um cliente que reconecta nunca
      // confunde o "1" de antes do reinício com o "1" de agora.
      scope.revs[topic] = ++this.generation
      changed = true
    }
    let probeValue: unknown
    if (probe) {
      try {
        probeValue = probe()
        const text = JSON.stringify(probeValue) ?? null
        if (text !== scope.probe) { scope.probe = text; scope.probeValue = probeValue; changed = true }
      } catch { /* sem leitura da sonda nesta volta */ }
    }
    if (!changed) return null
    return this.message(channelId)
  }

  /** Estado atual, para o socket que acabou de conectar. */
  message(channelId: string | null): TopicsMessage | null {
    const scope = this.scopes.get(channelId ?? '*')
    if (!scope) return null
    return { type: 'topics', channelId, revs: { ...scope.revs }, ...(scope.probe !== null ? { probe: scope.probeValue } : {}) }
  }

  /** Canal removido: esquece suas assinaturas (não acumula para sempre). */
  retain(channelIds: Iterable<string>): void {
    const keep = new Set(channelIds)
    for (const key of this.scopes.keys()) if (key !== '*' && !keep.has(key)) this.scopes.delete(key)
  }

  get size(): number { return this.scopes.size }
}

/**
 * Cadência do estado ao vivo por socket.
 *
 * O laço do servidor transmite `live` a 20 Hz (tally, relógio, medidores). Uma
 * aba oculta não desenha nada disso; ela avisa pelo próprio WebSocket e passa
 * a receber no máximo uma mensagem `live` por segundo e por canal -- o
 * suficiente para voltar à tela já atualizada. Grade (`view`), acervo e
 * tópicos continuam chegando na hora.
 */
export const HIDDEN_LIVE_INTERVAL_MS = 1000

export class LiveSocketPacing {
  private readonly hidden = new WeakMap<object, Map<string, number>>()

  setHidden(socket: object, hidden: boolean): void {
    if (hidden) { if (!this.hidden.has(socket)) this.hidden.set(socket, new Map()) }
    else this.hidden.delete(socket)
  }

  isHidden(socket: object): boolean { return this.hidden.has(socket) }

  /** Deve este socket receber agora o `live` deste canal? */
  due(socket: object, channelId: string, now: number): boolean {
    const sent = this.hidden.get(socket)
    if (!sent) return true
    const last = sent.get(channelId)
    if (last !== undefined && now - last < HIDDEN_LIVE_INTERVAL_MS) return false
    sent.set(channelId, now)
    return true
  }

  forget(socket: object): void { this.hidden.delete(socket) }
}

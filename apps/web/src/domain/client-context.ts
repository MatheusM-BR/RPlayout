export interface ContextTicket { readonly session: number; readonly view: number }

export class SupersededContextError extends Error {
  constructor(readonly mayHaveExecuted = false) {
    super(mayHaveExecuted
      ? 'O contexto mudou durante a solicitação. O servidor pode tê-la executado; consulte o estado atual antes de repetir.'
      : 'O contexto mudou; a solicitação antiga foi descartada.')
    this.name = 'SupersededContextError'
  }
}

/** Browser-local fencing only. It cannot undo an already accepted server
 * mutation, and never automatically retries one. */
export class ClientContext {
  private session = 0
  private view = 0
  private readonly provenance = new WeakMap<object, ContextTicket>()
  capture(): ContextTicket { return { session: this.session, view: this.view } }
  nextSession(): void { this.session++; this.view++ }
  nextView(): void { this.view++ }
  sessionCurrent(ticket: ContextTicket): boolean { return ticket.session === this.session }
  current(ticket: ContextTicket): boolean { return this.sessionCurrent(ticket) && ticket.view === this.view }
  assert(ticket: ContextTicket, mayHaveExecuted = false): void {
    if (!this.current(ticket)) throw new SupersededContextError(mayHaveExecuted)
  }
  mark(value: unknown, ticket: ContextTicket): void {
    const pending: unknown[] = [value], seen = new WeakSet<object>()
    while (pending.length) {
      const entry = pending.pop()
      if (!entry || typeof entry !== 'object' || seen.has(entry)) continue
      seen.add(entry); this.provenance.set(entry, ticket)
      pending.push(...Object.values(entry))
    }
  }
  accepts(value: object): boolean {
    const ticket = this.provenance.get(value)
    return !!ticket && this.current(ticket)
  }
}

/** Each context has its own tail. Old queued actions are fenced before send;
 * an in-flight old request does not hold the next session's queue hostage. */
export class ContextCommandQueue {
  private tail: Promise<void> = Promise.resolve()
  private owner: ContextTicket | null = null
  constructor(private readonly context: ClientContext) {}
  enqueue(action: () => Promise<void>): Promise<void> {
    const ticket = this.context.capture()
    if (!this.owner || this.owner.session !== ticket.session || this.owner.view !== ticket.view) this.tail = Promise.resolve()
    this.owner = ticket
    const run = async () => { if (this.context.current(ticket)) await action() }
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => {})
    return next
  }
}

export const clientContext = new ClientContext()

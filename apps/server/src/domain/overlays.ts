import { z } from 'zod'
import { OVERLAY_SLOTS, overlayAnimationOf, renderTemplate, type GraphicTemplate } from '@rplayout/protocol'
import { fitGraphicViewport } from './graphic-viewport.js'
import type { Transport } from './transport.js'

/** Overlays 1–8 do canal, como no vMix. Independentes das camadas fixas
 * (logo, relógio, ticker, tarja): cada slot tem seu título e sua animação.
 * Estado só em memória: depois de reiniciar o servidor os slots voltam vazios;
 * se só o engine reiniciar, o transporte repõe o que estava no ar (em corte). */
export interface OverlaySlot {
  slot: number
  templateId: string
  name: string
  values: Record<string, string>
  animated: boolean
  onAir: boolean
  changedAt: string
  changedBy: string | null
}

export const overlayCommandSchema = z.object({
  action: z.enum(['IN', 'OUT', 'CUT', 'OFF']),
  templateId: z.string().min(1).optional(),
  values: z.record(z.string(), z.string().max(2000)).optional(),
}).strict()
export type OverlayRequest = z.infer<typeof overlayCommandSchema>

export class OverlayDeck {
  private slots = new Map<number, OverlaySlot>()
  private queue: Promise<unknown> = Promise.resolve()

  list(): OverlaySlot[] {
    return Array.from({ length: OVERLAY_SLOTS }, (_, index) => this.slots.get(index + 1) ?? null).filter((slot): slot is OverlaySlot => slot !== null)
  }

  /** Comandos em fila: dois cliques rápidos não cruzam entrada e saída. */
  command(transport: Transport, slot: number, request: OverlayRequest, template: GraphicTemplate | null, actor: string | null): Promise<OverlaySlot | null> {
    const run = async () => {
      if (!Number.isInteger(slot) || slot < 1 || slot > OVERLAY_SLOTS) throw new OverlayError(400, `Overlay ${slot} não existe (1 a ${OVERLAY_SLOTS}).`)
      const current = this.slots.get(slot)
      if (request.action === 'IN' || request.action === 'CUT') {
        if (!template) throw new OverlayError(400, 'Escolha a arte do overlay.')
        const values = request.values ?? current?.values ?? {}
        const svg = fitGraphicViewport(renderTemplate(template, values))
        const animation = overlayAnimationOf(template.svg)
        if (!transport.overlay) throw new OverlayError(409, 'Este canal não aceita overlays.')
        await transport.overlay({ slot, action: request.action === 'IN' ? 'in' : 'cut', svg, animation })
        const next: OverlaySlot = { slot, templateId: template.id, name: template.name, values, animated: animation !== null, onAir: true, changedAt: new Date().toISOString(), changedBy: actor }
        this.slots.set(slot, next)
        return next
      }
      if (!current) {
        if (request.action === 'OFF' && transport.overlay) await transport.overlay({ slot, action: 'off' })
        return null
      }
      if (!transport.overlay) throw new OverlayError(409, 'Este canal não aceita overlays.')
      await transport.overlay({ slot, action: request.action === 'OUT' ? 'out' : 'off' })
      const next = { ...current, onAir: false, changedAt: new Date().toISOString(), changedBy: actor }
      this.slots.set(slot, next)
      return next
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }
}

export class OverlayError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const decks = new WeakMap<object, OverlayDeck>()
export function overlayDeckOf(runtime: object): OverlayDeck {
  let deck = decks.get(runtime)
  if (!deck) { deck = new OverlayDeck(); decks.set(runtime, deck) }
  return deck
}

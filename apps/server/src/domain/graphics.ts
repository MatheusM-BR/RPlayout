import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { framesSinceMidnight, renderTemplate, secondsToFrames } from '@rplayout/protocol'
import type { Channel, GraphicOnAir, GraphicTemplate } from '@rplayout/protocol'
import type { Db } from '../db/client.js'
import { graphicTemplates } from '../db/schema.js'
import type { Transport } from './transport.js'

/**
 * O grafismo no ar de um canal.
 *
 * O estado mora aqui, no servidor, e não no engine: é o servidor que sabe o
 * que é um template e quando ele deve sair sozinho. Para o engine vai só SVG
 * pronto -- e é por isso que o modelo de grafismo pode mudar sem recompilar o
 * processo que está no ar.
 */
export class Graphics {
  private current: GraphicOnAir | null = null

  constructor(
    private readonly channel: Channel,
    private readonly transport: Transport,
  ) {}

  onAir(): GraphicOnAir | null {
    return this.current
  }

  show(template: GraphicTemplate, values: Record<string, string>): GraphicOnAir {
    const endsAt =
      template.holdSeconds === null
        ? null
        : framesSinceMidnight(new Date(), this.channel.rate) +
          secondsToFrames(template.holdSeconds, this.channel.rate)

    this.transport.graphic(renderTemplate(template, values), template.fadeMs)
    this.current = { templateId: template.id, name: template.name, values, endsAt }
    return this.current
  }

  hide(fadeMs = 300): void {
    if (!this.current) return
    this.transport.graphic(null, fadeMs)
    this.current = null
  }

  /**
   * Tira do ar o que tinha hora para sair. Devolve true quando mudou algo, que
   * é o sinal para a interface se atualizar.
   *
   * Crédito que fica no ar porque ninguém lembrou de tirar é erro de operação
   * clássico -- o template diz quanto tempo dura e o servidor cumpre.
   */
  tick(): boolean {
    if (this.current?.endsAt === null || this.current === null) return false
    if (framesSinceMidnight(new Date(), this.channel.rate) < this.current.endsAt) return false
    this.hide()
    return true
  }
}

/**
 * Arte que já vem com o sistema.
 *
 * Um playout sem nenhum template não tem por onde começar: o operador abriria
 * a aba de grafismo e encontraria o vazio. Estes três cobrem o que toda
 * emissora usa -- crédito, selo e tarja de urgente -- e servem de exemplo de
 * como um template é escrito.
 *
 * São criados uma vez, por nome. Editar ou apagar é do operador, e o sistema
 * não os traz de volta.
 */
const DEFAULTS: {
  name: string
  svg: string
  fields: { key: string; label: string; defaultValue: string }[]
  fadeMs: number
  holdSeconds: number | null
}[] = [
  {
    name: 'Crédito',
    fadeMs: 300,
    holdSeconds: 8,
    fields: [
      { key: 'nome', label: 'Nome', defaultValue: 'Nome do entrevistado' },
      { key: 'cargo', label: 'Cargo ou lugar', defaultValue: '' },
    ],
    svg: `<g>
  <rect x="120" y="820" width="960" height="124" rx="3" fill="#0b1220" fill-opacity="0.92"/>
  <rect x="120" y="820" width="8" height="124" fill="#2f6ee0"/>
  <text x="160" y="874" font-family="Inter, Helvetica, sans-serif" font-size="46" fill="#f2f5fb">{{nome}}</text>
  <text x="160" y="918" font-family="Inter, Helvetica, sans-serif" font-size="26" fill="#9dbbf0">{{cargo}}</text>
</g>`,
  },
  {
    name: 'Selo do canal',
    fadeMs: 500,
    holdSeconds: null,
    fields: [{ key: 'texto', label: 'Texto do selo', defaultValue: 'CANAL 1' }],
    svg: `<g opacity="0.9">
  <rect x="1620" y="60" width="220" height="64" rx="3" fill="#0b1220" fill-opacity="0.75"/>
  <text x="1730" y="103" text-anchor="middle" font-family="Inter, Helvetica, sans-serif" font-size="30" fill="#f2f5fb" letter-spacing="4">{{texto}}</text>
</g>`,
  },
  {
    name: 'Tarja urgente',
    fadeMs: 200,
    holdSeconds: 20,
    fields: [{ key: 'texto', label: 'Chamada', defaultValue: 'PLANTÃO' }],
    svg: `<g>
  <rect x="0" y="960" width="1920" height="72" fill="#8f1d1d"/>
  <text x="60" y="1010" font-family="Inter, Helvetica, sans-serif" font-size="38" fill="#ffffff" letter-spacing="2">{{texto}}</text>
</g>`,
  },
]

export async function ensureDefaultGraphics(db: Db): Promise<void> {
  for (const template of DEFAULTS) {
    const [existing] = await db
      .select()
      .from(graphicTemplates)
      .where(eq(graphicTemplates.name, template.name))
    if (existing) continue

    await db.insert(graphicTemplates).values({
      id: randomUUID(),
      channelId: null,
      ...template,
      createdAt: new Date().toISOString(),
    })
  }
}

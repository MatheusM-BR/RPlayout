/**
 * Grafismo: template com campos, preenchido na hora de ir ao ar.
 *
 * O template é SVG porque SVG é texto: entra no banco, sai numa caixa de
 * edição, e o engine não precisa de navegador embutido para desenhar. O que
 * vai para o engine é sempre SVG pronto -- ele não sabe o que é um campo.
 */
export interface GraphicField {
  /** Chave usada no SVG como `{{chave}}`. */
  readonly key: string
  readonly label: string
  readonly defaultValue: string
}

export interface GraphicTemplate {
  readonly id: string
  /** Nulo vale para qualquer canal. */
  readonly channelId: string | null
  readonly name: string
  readonly svg: string
  readonly fields: GraphicField[]
  /** Quanto tempo a entrada e a saída levam, em milissegundos. */
  readonly fadeMs: number
  /**
   * Segundos no ar antes de sair sozinho. Nulo fica até alguém tirar -- que é
   * o certo para um selo de canal e errado para um crédito.
   */
  readonly holdSeconds: number | null
  readonly createdAt: string
}

/**
 * Grafismo preso a um item da grade.
 *
 * É o que transforma o GC de coisa manual em coisa de playout: o crédito do
 * entrevistado entra sozinho aos cinco segundos do VT, toda vez que aquele VT
 * for ao ar, sem ninguém de plantão no teclado.
 */
export interface ItemGraphic {
  readonly id: string
  readonly itemId: string
  readonly templateId: string
  /** Nome do template, para a interface não ter de cruzar as listas. */
  readonly templateName: string
  readonly values: Record<string, string>
  /** Segundos desde o início do item. */
  readonly atSeconds: number
}

/** O que está no ar agora, para a interface mostrar sem adivinhar. */
export interface GraphicOnAir {
  readonly templateId: string
  readonly name: string
  readonly values: Record<string, string>
  /** Quando sai sozinho, em frames desde a meia-noite. Nulo é indefinido. */
  readonly endsAt: number | null
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g

/**
 * Escapa o que o operador digitou.
 *
 * Um `&` num nome próprio quebra o SVG inteiro, e o grafismo simplesmente não
 * aparece no ar -- falha silenciosa, a pior espécie. Escapar aqui é o que
 * garante que o que sai daqui é sempre SVG válido.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Preenche o template. Campo sem valor cai no padrão dele; campo que o
 * template não declara é ignorado, e `{{chave}}` desconhecida vira vazio em
 * vez de ficar aparecendo no ar.
 */
export function renderTemplate(
  template: Pick<GraphicTemplate, 'svg' | 'fields'>,
  values: Record<string, string>,
): string {
  const resolved = new Map<string, string>()
  for (const field of template.fields) {
    const given = values[field.key]
    resolved.set(field.key, given !== undefined && given !== '' ? given : field.defaultValue)
  }

  return template.svg.replace(PLACEHOLDER, (_, key: string) =>
    escapeXml(resolved.get(key) ?? ''),
  )
}

/** Os campos que um SVG usa, para quem escreve template não ter de listar. */
export function fieldsUsedIn(svg: string): string[] {
  const found = new Set<string>()
  for (const match of svg.matchAll(PLACEHOLDER)) {
    if (match[1]) found.add(match[1])
  }
  return [...found]
}

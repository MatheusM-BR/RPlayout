/** Importa títulos GT do vMix (.gtzip / .gtxml) como arte SVG do RPlayout.
 *
 * O .gtzip é um zip com `document.xml` (UTF-16), `resources.xml`, as imagens
 * (nome = GUID) e `thumbnail.png`. A composição descreve camadas, retângulos,
 * elipses, triângulos, imagens e textos, com efeitos (inclinação, sombra),
 * corte, máscara e storyboards de entrada/saída.
 *
 * Saída: SVG com `{{campo}}` nos textos (mesmos nomes do vMix, ex.
 * `Headline.Text`), lista de campos, fade derivado da entrada e um relatório do
 * que foi aproximado. Animações além de fade ficam para o engine (G2). */

export interface GtField { key: string; label: string; defaultValue: string }
export interface GtImport {
  name: string
  svg: string
  fields: GtField[]
  fadeMs: number
  width: number
  height: number
  thumbnail: Uint8Array | null
  report: string[]
  animation: GtAnimation
}
export interface GtObject { n: number; x: number; y: number; w: number; h: number; ax: number; ay: number }
export interface GtStep { n: number; kind: string; delayMs: number; durationMs: number; direction: string; easing: string }
/** Animação contínua (rolagem de Ticker): `fieldKey` diz qual campo dá o
 * texto; o servidor calcula a largura do conteúdo ao pôr no ar. */
export interface GtContinuous { n: number; kind: 'Scroll'; pxPerSec: number; width: number; fieldKey: string; charWidth: number }
export interface GtAnimation { width: number; height: number; objects: GtObject[]; enter: GtStep[]; exit: GtStep[]; continuous?: GtContinuous[] }
export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array>

// ---------------------------------------------------------------- zip

interface ZipEntry { name: string; data: Uint8Array }

export async function readZip(bytes: Uint8Array, inflateRaw: InflateRaw): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Arquivo não é um .gtzip válido (zip sem diretório).')
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  const utf8 = new TextDecoder('utf-8')
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Diretório do zip corrompido.')
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`Entrada ${name} corrompida.`)
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = bytes.subarray(start, start + compressed)
    if (name.endsWith('/')) continue
    if (method === 0) entries.push({ name, data: raw })
    else if (method === 8) entries.push({ name, data: await inflateRaw(raw) })
    else throw new Error(`Compressão ${method} não suportada em ${name}.`)
  }
  return new Map(entries.map(entry => [entry.name.replace(/\\/g, '/'), entry.data]))
}

/** Descompressão no navegador (Chromium/Edge/Firefox atuais). */
export const browserInflateRaw: InflateRaw = async data => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ---------------------------------------------------------------- xml

export interface XmlNode { tag: string; attrs: Record<string, string>; children: XmlNode[] }

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

const entity = (text: string) => text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, code: string) => {
  const lower = code.toLowerCase()
  if (lower === 'amp') return '&'
  if (lower === 'lt') return '<'
  if (lower === 'gt') return '>'
  if (lower === 'quot') return '"'
  if (lower === 'apos') return "'"
  return String.fromCodePoint(lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10))
})

export function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const tagRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let match: RegExpExecArray | null
  let last = 0
  while ((match = tagRe.exec(text))) {
    // Texto entre tags (ex.: conteúdo de <text>) fica em attrs['#text'] do pai.
    const between = text.slice(last, match.index)
    last = tagRe.lastIndex
    if (between.trim()) { const parent = stack[stack.length - 1]!; parent.attrs['#text'] = (parent.attrs['#text'] ?? '') + entity(between) }
    if (!match[2]) continue
    const [, closing, tag, attrText, selfClosing] = match
    if (closing) {
      const open = stack.pop()
      if (!open || open.tag !== tag) throw new Error(`XML do título malformado em </${tag}>.`)
      continue
    }
    const attrs: Record<string, string> = {}
    for (const attr of (attrText ?? '').matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[attr[1]!] = entity(attr[2] ?? attr[3] ?? '')
    const node: XmlNode = { tag: tag!, attrs, children: [] }
    stack[stack.length - 1]!.children.push(node)
    if (!selfClosing) stack.push(node)
  }
  if (stack.length !== 1) throw new Error('XML do título incompleto.')
  return root
}

const child = (node: XmlNode, tag: string) => node.children.find(entry => entry.tag === tag)

// ---------------------------------------------------------------- conversão

const num = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const pair = (value: string | undefined): [number, number] => {
  const parts = (value ?? '').split(',').map(part => num(part))
  return [parts[0] ?? 0, parts[1] ?? 0]
}
const round = (value: number) => Math.round(value * 100) / 100
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `#AARRGGBB` → cor e opacidade SVG. */
export function gtColor(value: string | undefined): { color: string; opacity: number } {
  const hex = /^#([0-9a-f]{8}|[0-9a-f]{6})$/i.exec(value ?? '')
  if (!hex) return { color: 'none', opacity: 0 }
  const digits = hex[1]!
  if (digits.length === 6) return { color: `#${digits.toLowerCase()}`, opacity: 1 }
  return { color: `#${digits.slice(2).toLowerCase()}`, opacity: round(parseInt(digits.slice(0, 2), 16) / 255) }
}

const fieldKey = (name: string, used: Set<string>) => {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'texto'
  let key = base, n = 2
  while (used.has(key)) key = `${base}-${n++}`
  used.add(key)
  return key
}

const mimeOf = (data: Uint8Array) => {
  if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif'
  if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp'
  return null
}
const base64 = (data: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(binary)
}

interface Context {
  defs: string[]
  fields: GtField[]
  usedKeys: Set<string>
  report: Set<string>
  images: (source: string) => Uint8Array | null
  masks: Set<string>
  byName: Map<string, XmlNode>
  ids: number
  prefix: string
  objects: GtObject[]
  numbers: Map<string, number>
  continuous: GtContinuous[]
}

const SHAPES = new Set(['Rectangle', 'Ellipse', 'Triangle', 'RightTriangle', 'Image', 'TextBlock', 'Ticker', 'Layer', 'QRCode'])

function paint(node: XmlNode, kind: 'Fill' | 'Stroke', ctx: Context, box: { w: number; h: number }): { value: string; opacity: number } {
  const holder = child(node, `${node.tag}.${kind}`)
  const brush = holder && child(holder, 'Brush')
  if (!brush) return kind === 'Fill' ? { value: '#ffffff', opacity: 1 } : { value: 'none', opacity: 0 }
  const type = brush.attrs.Type
  if (type === 'Transparent') return { value: 'none', opacity: 0 }
  const stops = child(brush, 'Brush.Stops')
  if (stops && stops.children.length && type !== 'Bitmap') {
    const id = `${ctx.prefix}g${ctx.ids++}`
    const [x1, y1] = brush.attrs.StartPoint ? pair(brush.attrs.StartPoint) : [0, 0]
    const [x2, y2] = brush.attrs.EndPoint ? pair(brush.attrs.EndPoint) : [0, 1]
    const stopTags = stops.children.filter(stop => stop.tag === 'GradientStop').map(stop => {
      const c = gtColor(stop.attrs.Color)
      return `<stop offset="${round(num(stop.attrs.Position))}" stop-color="${c.color}" stop-opacity="${c.opacity}"/>`
    })
    ctx.defs.push(`<linearGradient id="${id}" x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}">${stopTags.join('')}</linearGradient>`)
    return { value: `url(#${id})`, opacity: 1 }
  }
  if (type === 'Bitmap') ctx.report.add('Preenchimento com imagem virou cor sólida.')
  if (box.w <= 0 && box.h <= 0) return { value: 'none', opacity: 0 }
  const c = gtColor(brush.attrs.Color)
  return { value: c.color, opacity: c.opacity }
}

function effects(node: XmlNode, ctx: Context, w: number, h: number): { transform: string; filter: string } {
  const holder = child(node, `${node.tag}.Effects`)
  let transform = '', filter = ''
  for (const effect of holder?.children ?? []) {
    if (effect.attrs.Type === 'Skew') {
      const [ax, ay] = pair(effect.attrs.Angle)
      if (ax) transform += ` translate(${round(w / 2)} ${round(h / 2)}) skewX(${round(-ax)}) translate(${round(-w / 2)} ${round(-h / 2)})`
      if (ay) transform += ` translate(${round(w / 2)} ${round(h / 2)}) skewY(${round(-ay)}) translate(${round(-w / 2)} ${round(-h / 2)})`
    } else if (effect.attrs.Type === 'Shadow') {
      const id = `${ctx.prefix}f${ctx.ids++}`
      const [dx, dy] = effect.attrs.Offset ? pair(effect.attrs.Offset) : [3, 3]
      const c = effect.attrs.Color ? gtColor(effect.attrs.Color) : { color: '#000000', opacity: 0.6 }
      ctx.defs.push(`<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="${round(dx)}" dy="${round(dy)}" stdDeviation="${round(num(effect.attrs.BlurAmount, 3))}" flood-color="${c.color}" flood-opacity="${c.opacity}"/></filter>`)
      filter = ` filter="url(#${id})"`
    } else if (effect.attrs.Type) ctx.report.add(`Efeito ${effect.attrs.Type} não convertido.`)
  }
  const holder2 = child(node, `${node.tag}.Transform`)
  const rotateNode = (holder2 && child(holder2, 'Transform')) ?? child(node, 'Transform')
  const angle = num(rotateNode?.attrs.Rotate?.split(',')[2], 0)
  if (angle) transform += ` rotate(${round((angle * 180) / Math.PI)} ${round(w / 2)} ${round(h / 2)})`
  return { transform, filter }
}

function clipFor(node: XmlNode, ctx: Context, w: number, h: number): string {
  const crop = child(node, `${node.tag}.Crop`)?.children.find(entry => entry.tag === 'Crop')
  const mask = child(node, `${node.tag}.Mask`)?.children.find(entry => entry.tag === 'Mask')
  let attrs = ''
  if (crop?.attrs.Range) {
    const [l, t, r, b] = crop.attrs.Range.split(',').map(value => num(value))
    const id = `${ctx.prefix}c${ctx.ids++}`
    ctx.defs.push(`<clipPath id="${id}"><rect x="${round((l ?? 0) * w)}" y="${round((t ?? 0) * h)}" width="${round(((r ?? 1) - (l ?? 0)) * w)}" height="${round(((b ?? 1) - (t ?? 0)) * h)}"/></clipPath>`)
    attrs += ` clip-path="url(#${id})"`
  }
  if (mask?.attrs.Object) {
    const target = ctx.byName.get(mask.attrs.Object)
    if (target) {
      const id = `${ctx.prefix}m${ctx.ids++}`
      const [tw, th] = pair(target.attrs.Dimensions), [tx, ty] = pair(target.attrs.Location)
      const [ox, oy] = pair(node.attrs.Location)
      ctx.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000"><rect x="${round(tx - ox)}" y="${round(ty - oy)}" width="${round(tw)}" height="${round(th)}" fill="#fff"/></mask>`)
      attrs += ` mask="url(#${id})"`
    } else ctx.report.add(`Máscara "${mask.attrs.Object}" não encontrada.`)
  }
  return attrs
}

function text(node: XmlNode, ctx: Context, w: number, h: number): string {
  const fill = paint(node, 'Fill', ctx, { w, h })
  const stroke = paint(node, 'Stroke', ctx, { w, h })
  const declared = num(node.attrs.FontSize, 0)
  const size = round(declared > 0 ? (node.attrs.AutoSize ? Math.min(declared, h * 0.82) : declared) : Math.max(8, h * 0.78))
  const align = node.attrs.TextAlign ?? 'Left'
  const anchor = align === 'Center' ? 'middle' : align === 'Right' ? 'end' : 'start'
  const x = align === 'Center' ? w / 2 : align === 'Right' ? w : 0
  const valign = node.attrs.VerticalAlign ?? 'Top'
  const y = valign === 'Center' ? h / 2 + size * 0.35 : valign === 'Bottom' ? h - size * 0.22 : size * 0.85
  const name = node.attrs.Name ?? 'Texto'
  const key = fieldKey(name, ctx.usedKeys)
  ctx.fields.push({ key, label: `${name}.Text`, defaultValue: node.attrs.Text ?? '' })
  if (node.tag === 'Ticker') ctx.report.add('Ticker rola da direita para a esquerda no RPlayout (velocidade do vMix aproximada).')
  if (/\{0:[^}]+\}/.test(node.attrs.Text ?? '')) ctx.report.add(`"${name}" usa formato de relógio/dado do vMix; ficou como campo de texto.`)
  if (node.attrs.TextWordWrapping === 'Wrap') ctx.report.add(`"${name}" quebra linha no vMix; aqui fica em uma linha.`)
  const weight = node.attrs.FontWeight ? ` font-weight="${node.attrs.FontWeight.toLowerCase() === 'bold' ? 'bold' : esc(node.attrs.FontWeight.toLowerCase())}"` : ''
  const italic = node.attrs.FontStyle?.toLowerCase() === 'italic' ? ' font-style="italic"' : ''
  const family = esc(`${node.attrs.FontFamily ?? 'Segoe UI'}, Arial, sans-serif`)
  const strokeWidth = num(node.attrs.StrokeThickness, 0)
  const strokeAttr = stroke.value !== 'none' && strokeWidth > 0 ? ` stroke="${stroke.value}" stroke-opacity="${stroke.opacity}" stroke-width="${round(strokeWidth)}" paint-order="stroke"` : ''
  return `<text x="${round(x)}" y="${round(y)}" text-anchor="${anchor}" font-family="${family}" font-size="${size}"${weight}${italic} fill="${fill.value}" fill-opacity="${fill.opacity}"${strokeAttr}>{{${key}}}</text>`
}

function shape(node: XmlNode, ctx: Context, parent: [number, number] = [0, 0]): string {
  if (node.attrs.Visible === 'False') return ''
  if (node.attrs.Name && ctx.masks.has(node.attrs.Name)) return ''
  const [w, h] = pair(node.attrs.Dimensions)
  const [x, y] = pair(node.attrs.Location)
  // Objeto animável: `data-a` seguido de `transform` é o ponto em que o engine
  // prefixa o movimento (espaço do pai) e põe opacidade/recorte do quadro.
  const name = node.attrs.Name
  let marker = ''
  if (name && !ctx.numbers.has(name)) {
    const n = ctx.objects.length + 1
    ctx.numbers.set(name, n)
    ctx.objects.push({ n, x: round(x), y: round(y), w: round(w), h: round(h), ax: round(parent[0] + x), ay: round(parent[1] + y) })
    marker = ` data-a="${n}"`
  }
  const { transform, filter } = effects(node, ctx, w, h)
  const clip = clipFor(node, ctx, w, h)
  const opacity = node.attrs.Opacity !== undefined ? ` opacity="${round(num(node.attrs.Opacity, 1))}"` : ''
  let body = ''
  const fill = () => paint(node, 'Fill', ctx, { w, h })
  const strokeAttrs = () => {
    const stroke = paint(node, 'Stroke', ctx, { w, h }), width = num(node.attrs.StrokeThickness, 0)
    return stroke.value !== 'none' && width > 0 ? ` stroke="${stroke.value}" stroke-opacity="${stroke.opacity}" stroke-width="${round(width)}"` : ''
  }
  switch (node.tag) {
    case 'Rectangle': {
      const f = fill(), [rx, ry] = node.attrs.Radius?.includes(',') ? pair(node.attrs.Radius) : [num(node.attrs.Radius, 0), num(node.attrs.Radius, 0)]
      body = `<rect width="${round(w)}" height="${round(h)}"${rx || ry ? ` rx="${round(Math.min(rx, w / 2))}" ry="${round(Math.min(ry || rx, h / 2))}"` : ''} fill="${f.value}" fill-opacity="${f.opacity}"${strokeAttrs()}/>`
      break
    }
    case 'Ellipse': {
      const f = fill()
      body = `<ellipse cx="${round(w / 2)}" cy="${round(h / 2)}" rx="${round(w / 2)}" ry="${round(h / 2)}" fill="${f.value}" fill-opacity="${f.opacity}"${strokeAttrs()}/>`
      break
    }
    case 'Triangle':
    case 'RightTriangle': {
      const f = fill()
      const points = node.tag === 'Triangle' ? `${round(w / 2)},0 ${round(w)},${round(h)} 0,${round(h)}` : `0,0 0,${round(h)} ${round(w)},${round(h)}`
      body = `<polygon points="${points}" fill="${f.value}" fill-opacity="${f.opacity}"${strokeAttrs()}/>`
      break
    }
    case 'Image': {
      const source = child(child(node, 'Image.Bitmap') ?? { tag: '', attrs: {}, children: [] }, 'Bitmap')?.attrs.Source
      const data = source ? ctx.images(source) : null
      const mime = data && mimeOf(data)
      if (data && mime) body = `<image width="${round(w)}" height="${round(h)}" preserveAspectRatio="${node.attrs.SizeMode === 'Stretch' ? 'none' : 'xMidYMid meet'}" href="data:${mime};base64,${base64(data)}"/>`
      else ctx.report.add(`Imagem "${node.attrs.Name ?? ''}" sem arquivo no pacote; ficou vazia.`)
      break
    }
    case 'TextBlock':
    case 'Ticker':
      body = text(node, ctx, w, h)
      break
    case 'QRCode':
      ctx.report.add('QR Code não convertido.')
      return ''
    case 'Layer': {
      const composition = child(child(node, 'Layer.Composition') ?? { tag: '', attrs: {}, children: [] }, 'Composition')
      body = composition ? composition.children.filter(entry => SHAPES.has(entry.tag)).map(entry => shape(entry, ctx, [parent[0] + x, parent[1] + y])).join('') : ''
      break
    }
  }
  if (!body) return ''
  if (node.tag === 'Ticker' && marker) {
    // Rolagem: o grupo animado (data-a) anda dentro de um recorte fixo do tamanho
    // da faixa; o recorte fica no pai para não andar junto.
    const n = ctx.numbers.get(name!)!
    const key = ctx.fields[ctx.fields.length - 1]!.key
    const size = Number(/font-size="([\d.]+)"/.exec(body)?.[1] ?? h * 0.78)
    ctx.continuous.push({ n, kind: 'Scroll', pxPerSec: Math.round(num(node.attrs.Speed, 4) * 60), width: round(w), fieldKey: key, charWidth: round(size * 0.55) })
    const clipId = `${ctx.prefix}t${ctx.ids++}`
    ctx.defs.push(`<clipPath id="${clipId}"><rect width="${round(w)}" height="${round(h)}"/></clipPath>`)
    const left = body.replace(/text-anchor="(middle|end)"/, 'text-anchor="start"').replace(/<text x="[^"]*"/, '<text x="0"')
    return `<g transform="translate(${round(x)} ${round(y)})${transform}"${opacity}${filter} clip-path="url(#${clipId})"><g${marker} transform="translate(0 0)" data-gt="${esc(name!)}">${left}</g></g>`
  }
  const all = `translate(${round(x)} ${round(y)})${transform}`
  const inner = opacity || clip || filter ? `<g${opacity}${clip}${filter}>${body}</g>` : body
  return `<g${marker} transform="${all}"${name ? ` data-gt="${esc(name)}"` : ''}>${inner}</g>`
}

function hash(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}

function walk(node: XmlNode, visit: (node: XmlNode) => void) { visit(node); for (const entry of node.children) walk(entry, visit) }

/** Duração da entrada do storyboard, em ms (Delay + Duration). */
export function transitionInMs(composition: XmlNode): number {
  const boards = composition.children.filter(entry => entry.tag === 'Storyboard' && (!entry.attrs.Type || entry.attrs.Type === 'TransitionIn'))
  let end = 0
  for (const board of boards) for (const animation of child(board, 'Storyboard.Animations')?.children ?? []) {
    if (animation.tag === 'None' || animation.tag === 'Hidden') continue
    end = Math.max(end, num(animation.attrs.Delay, 0) + num(animation.attrs.Duration, 0.5))
  }
  return Math.round(end * 1000)
}

export function convertGtDocument(documentXml: string, name: string, images: (source: string) => Uint8Array | null = () => null): Omit<GtImport, 'thumbnail'> {
  const root = parseXml(documentXml)
  const composition = root.children.find(entry => entry.tag === 'Composition')
  if (!composition) throw new Error('Título GT sem <Composition>.')
  const width = num(composition.attrs.Width, 1920), height = num(composition.attrs.Height, 1080)
  const prefix = `gt${hash(documentXml)}_`
  const ctx: Context = { defs: [], fields: [], usedKeys: new Set(), report: new Set(), images, masks: new Set(), byName: new Map(), ids: 1, prefix, objects: [], numbers: new Map(), continuous: [] }
  walk(composition, node => {
    if (node.attrs.Name && SHAPES.has(node.tag)) ctx.byName.set(node.attrs.Name, node)
    if (node.tag === 'Mask' && node.attrs.Object) ctx.masks.add(node.attrs.Object)
  })
  const body = composition.children.filter(entry => SHAPES.has(entry.tag)).map(entry => shape(entry, ctx)).join('')
  const kinds = new Set<string>()
  for (const board of composition.children.filter(entry => entry.tag === 'Storyboard')) for (const animation of child(board, 'Storyboard.Animations')?.children ?? []) kinds.add(animation.tag)
  const approximated = [...kinds].filter(kind => !['Fade', 'None', 'Hidden'].includes(kind))
  const continuous = approximated.filter(kind => ['FillOffset', 'StrokeOffset', 'RotateContinuous', 'Scroll', 'ImageSequenceLoop'].includes(kind))
  if (continuous.length) ctx.report.add(`Animações contínuas ${continuous.sort().join(', ')} ficam paradas por enquanto.`)
  const inMs = transitionInMs(composition)
  const fadeMs = Math.min(5000, Math.max(0, inMs || 300))
  if (inMs > 5000) ctx.report.add('Entrada do vMix passa de 5 s; fade limitado a 5 s.')
  const steps = (type: 'in' | 'out') => composition.children
    .filter(entry => entry.tag === 'Storyboard' && (type === 'out' ? entry.attrs.Type === 'TransitionOut' : !entry.attrs.Type || entry.attrs.Type === 'TransitionIn'))
    .flatMap(board => child(board, 'Storyboard.Animations')?.children ?? [])
    .flatMap(step => {
      const n = ctx.numbers.get(step.attrs.Object ?? '')
      return n ? [{ n, kind: step.tag, delayMs: Math.round(num(step.attrs.Delay, 0) * 1000), durationMs: Math.round(num(step.attrs.Duration, 0.5) * 1000), direction: step.attrs.Direction ?? '', easing: step.attrs.Interpolation ?? '' }] : []
    })
  const animation: GtAnimation = { width, height, objects: ctx.objects, enter: steps('in'), exit: steps('out'), ...(ctx.continuous.length ? { continuous: ctx.continuous } : {}) }
  const metadata = `<metadata id="rplayout-gt">${esc(JSON.stringify(animation))}</metadata>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}">${metadata}${ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : ''}${body}</svg>`
  if (svg.length > 1_000_000) throw new Error('Título grande demais para arte (imagens somam mais de 1 MB). Reduza as imagens no GT Designer.')
  return { name, svg, fields: ctx.fields, fadeMs, width, height, report: [...ctx.report], animation }
}

export async function importGtzip(bytes: Uint8Array, fileName: string, inflateRaw: InflateRaw = browserInflateRaw): Promise<GtImport> {
  const name = fileName.replace(/\.(gtzip|gtxml)$/i, '').trim() || 'Título GT'
  if (/\.gtxml$/i.test(fileName)) return { ...convertGtDocument(decodeText(bytes), name), thumbnail: null }
  const files = await readZip(bytes, inflateRaw)
  const document = files.get('document.xml')
  if (!document) throw new Error('Pacote sem document.xml: não é um título GT.')
  const resources = new Map<string, string>()
  const resourceXml = files.get('resources.xml')
  if (resourceXml) for (const resource of parseXml(decodeText(resourceXml)).children[0]?.children ?? []) {
    const source = resource.children.find(entry => entry.tag === 'source')
    if (resource.attrs.filename && source?.attrs.guid) resources.set(resource.attrs.filename.replace(/\\/g, '/'), source.attrs.guid)
  }
  const images = (source: string) => {
    const path = source.replace(/\\/g, '/')
    const guid = resources.get(path)
    return (guid && files.get(guid)) || files.get(path) || files.get(path.split('/').pop() ?? '') || null
  }
  return { ...convertGtDocument(decodeText(document), name, images), thumbnail: files.get('thumbnail.png') ?? null }
}

// ---------------------------------------------------------------- exportação (.gtzip)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  return table
})()
function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Zip sem compressão (como os .gtzip do vMix). */
export function writeZip(files: Array<[string, Uint8Array]>): Uint8Array {
  const encoder = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0
  for (const [name, data] of files) {
    const nameBytes = encoder.encode(name), crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    const entry = new Uint8Array(46 + nameBytes.length), cv = new DataView(entry.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true)
    entry.set(nameBytes, 46)
    parts.push(local, data); central.push(entry); offset += local.length + data.length
  }
  const size = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22), ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of all) { out.set(part, at); at += part.length }
  return out
}

const xmlAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Cor SVG (#rrggbb + opacidade) → `#AARRGGBB` do vMix. */
export function toGtColor(color: string | undefined, opacity = 1): string {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color ?? '')
  if (!hex) return '#00000000'
  const rgb = hex[1]!.length === 3 ? hex[1]!.split('').map(ch => ch + ch).join('') : hex[1]!
  return `#${Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0')}${rgb}`.toUpperCase()
}

interface GtExportOptions { name: string; fields: GtField[]; thumbnail?: Uint8Array | null; randomId?: () => string }

/** Arte SVG do RPlayout → título GT (.gtzip) que abre no GT Designer e no vMix.
 * Achata a composição em posições absolutas: retângulo, elipse, polígono
 * (vira triângulo pela caixa), imagem e texto; campos `{{chave}}` viram
 * TextBlocks com o nome do vMix (rótulo sem `.Text`). Storyboards gravados na
 * importação voltam para os objetos de cada grupo. */
export function exportGtzip(svg: string, options: GtExportOptions): { bytes: Uint8Array; report: string[] } {
  const report = new Set<string>()
  const randomId = options.randomId ?? (() => crypto.randomUUID())
  const root = parseXml(svg).children.find(node => node.tag === 'svg')
  if (!root) throw new Error('Arte sem <svg>.')
  const [, , vw, vh] = (root.attrs.viewBox ?? '0 0 1920 1080').split(/[\s,]+/).map(Number)
  const width = Math.round(vw || 1920), height = Math.round(vh || 1080)
  const gradients = new Map<string, string>()
  for (const node of root.children.find(entry => entry.tag === 'defs')?.children ?? []) {
    if (node.tag === 'linearGradient' && node.attrs.id) {
      const stop = node.children.find(entry => entry.tag === 'stop')
      if (stop) gradients.set(node.attrs.id, toGtColor(stop.attrs['stop-color'], num(stop.attrs['stop-opacity'], 1)))
    }
  }
  const meta = /<metadata id="rplayout-gt">([\s\S]*?)<\/metadata>/.exec(svg)
  const animation = meta ? (JSON.parse(meta[1]!.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) as GtAnimation) : null
  const labelOf = new Map(options.fields.map(field => [field.key, field.label.replace(/\.Text$/, '')]))
  const defaultOf = new Map(options.fields.map(field => [field.key, field.defaultValue]))
  const elements: string[] = [], resources: Array<{ file: string; guid: string; data: Uint8Array }> = []
  const members = new Map<number, string[]>(), used = new Set<string>()
  const unique = (base: string) => { let name = base || 'Objeto', n = 2; while (used.has(name)) name = `${base} ${n++}`; used.add(name); return name }
  const paint = (node: XmlNode, attr: 'fill' | 'stroke') => {
    const value = node.attrs[attr]
    if (!value || value === 'none') return attr === 'fill' && !value ? '#FFFFFFFF' : '#00000000'
    const ref = /^url\(#(.+)\)$/.exec(value)
    if (ref) { report.add('Gradiente exportado como cor sólida (primeira parada).'); return gradients.get(ref[1]!) ?? '#FFFFFFFF' }
    return toGtColor(value, num(node.attrs[`${attr}-opacity`], 1))
  }
  const brush = (tag: string, kind: 'Fill' | 'Stroke', color: string) => `<${tag}.${kind}><Brush Color="${color}" /></${tag}.${kind}>`
  const walk = (node: XmlNode, ox: number, oy: number, group: number[]) => {
    let x = ox, y = oy
    const transform = node.attrs.transform ?? ''
    for (const match of transform.matchAll(/translate\(\s*([-\d.eE]+)[\s,]+([-\d.eE]+)\s*\)/g)) { x += Number(match[1]); y += Number(match[2]) }
    if (/skew|rotate|scale/.test(transform)) report.add('Inclinação/rotação/escala não exportadas (o objeto sai reto).')
    const groups = node.attrs['data-a'] ? [...group, Number(node.attrs['data-a'])] : group
    const named = node.attrs['data-gt']
    const add = (xml: string, name: string) => { elements.push(xml); for (const n of groups) members.set(n, [...(members.get(n) ?? []), name]) }
    const nameFor = () => unique(named ?? `${node.tag}`)
    switch (node.tag) {
      case 'rect': {
        const name = nameFor(), w = num(node.attrs.width), h = num(node.attrs.height), r = num(node.attrs.rx)
        add(`<Rectangle Name="${xmlAttr(name)}" Dimensions="${round(w)},${round(h)},0" Location="${round(x + num(node.attrs.x))},${round(y + num(node.attrs.y))},0"${r ? ` Radius="${round(r)},${round(num(node.attrs.ry, r))}"` : ''}${node.attrs['stroke-width'] ? ` StrokeThickness="${round(num(node.attrs['stroke-width']))}"` : ''}>${brush('Rectangle', 'Fill', paint(node, 'fill'))}${brush('Rectangle', 'Stroke', paint(node, 'stroke'))}</Rectangle>`, name)
        return
      }
      case 'ellipse': case 'circle': {
        const name = nameFor(), rx = num(node.attrs.rx ?? node.attrs.r), ry = num(node.attrs.ry ?? node.attrs.r)
        add(`<Ellipse Name="${xmlAttr(name)}" Dimensions="${round(rx * 2)},${round(ry * 2)},0" Location="${round(x + num(node.attrs.cx) - rx)},${round(y + num(node.attrs.cy) - ry)},0">${brush('Ellipse', 'Fill', paint(node, 'fill'))}${brush('Ellipse', 'Stroke', paint(node, 'stroke'))}</Ellipse>`, name)
        return
      }
      case 'polygon': {
        const points = (node.attrs.points ?? '').trim().split(/[\s,]+/).map(Number)
        const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2 === 1)
        if (!xs.length) return
        const name = nameFor(), minX = Math.min(...xs), minY = Math.min(...ys)
        report.add('Polígono exportado como triângulo pela caixa.')
        add(`<Triangle Name="${xmlAttr(name)}" Dimensions="${round(Math.max(...xs) - minX)},${round(Math.max(...ys) - minY)},0" Location="${round(x + minX)},${round(y + minY)},0">${brush('Triangle', 'Fill', paint(node, 'fill'))}</Triangle>`, name)
        return
      }
      case 'image': {
        const href = node.attrs.href ?? node.attrs['xlink:href'] ?? ''
        const data = /^data:image\/(png|jpeg|gif|bmp);base64,(.+)$/.exec(href)
        if (!data) { report.add('Imagem externa (não embutida) não exportada.'); return }
        const name = nameFor(), guid = randomId(), file = `${randomId()}\\IMAGE${resources.length + 1}.${data[1] === 'jpeg' ? 'jpg' : data[1]}`
        const binary = atob(data[2]!), bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        resources.push({ file, guid, data: bytes })
        add(`<Image Name="${xmlAttr(name)}" Dimensions="${round(num(node.attrs.width))},${round(num(node.attrs.height))},0" Location="${round(x + num(node.attrs.x))},${round(y + num(node.attrs.y))},0"${node.attrs.preserveAspectRatio === 'none' ? ' SizeMode="Stretch"' : ''}><Image.Bitmap><Bitmap Source="${xmlAttr(file)}" /></Image.Bitmap></Image>`, name)
        return
      }
      case 'text': {
        const raw = textOf(node) ?? ''
        const key = /^\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}$/.exec(raw.trim())?.[1]
        const size = num(node.attrs['font-size'], 48)
        const anchor = node.attrs['text-anchor'] ?? 'start'
        const text = key ? defaultOf.get(key) ?? '' : raw
        const name = unique(key ? labelOf.get(key) ?? key : named ?? 'Texto')
        const boxW = Math.max(size, (text.length || 8) * size * 0.62), boxH = size * 1.25
        const tx = x + num(node.attrs.x), ty = y + num(node.attrs.y)
        const left = anchor === 'middle' ? tx - boxW / 2 : anchor === 'end' ? tx - boxW : tx
        const family = (node.attrs['font-family'] ?? 'Segoe UI').split(',')[0]!.trim().replace(/^['"]|['"]$/g, '')
        add(`<TextBlock Name="${xmlAttr(name)}" Dimensions="${round(boxW)},${round(boxH)},0" Location="${round(left)},${round(ty - size * 0.95)},0" Text="${xmlAttr(text)}" FontFamily="${xmlAttr(family)}" FontSize="${round(size)}"${node.attrs['font-weight'] === 'bold' ? ' FontWeight="Bold"' : ''}${anchor === 'middle' ? ' TextAlign="Center"' : anchor === 'end' ? ' TextAlign="Right"' : ''} VerticalAlign="Center" TextWordWrapping="NoWrap" AutoSize="Shrink">${brush('TextBlock', 'Fill', paint(node, 'fill'))}</TextBlock>`, name)
        return
      }
      case 'metadata': case 'defs': return
      default: for (const child of node.children) walk(child, x, y, groups)
    }
  }
  for (const child of root.children) walk(child, 0, 0, [])
  const boards: string[] = []
  if (animation) {
    const board = (steps: GtStep[], type: string | null) => {
      const lines = steps.flatMap(step => (members.get(step.n) ?? []).map(name => `<${step.kind} Object="${xmlAttr(name)}"${step.delayMs ? ` Delay="${step.delayMs / 1000}"` : ''}${step.durationMs !== 500 ? ` Duration="${step.durationMs / 1000}"` : ''}${step.direction ? ` Direction="${step.direction}"` : ''}${step.easing ? ` Interpolation="${step.easing}"` : ''} />`))
      if (lines.length) boards.push(`<Storyboard${type ? ` Type="${type}"` : ''}><Storyboard.Animations>${lines.join('')}</Storyboard.Animations></Storyboard>`)
    }
    board(animation.enter, null)
    board(animation.exit, 'TransitionOut')
  } else report.add('Arte sem animação gravada: entra e sai como corte no vMix.')
  const documentXml = `<?xml version="1.0" encoding="utf-8"?>\r\n<Composition Width="${width}" Height="${height}">\r\n<Layer Name="RPlayout" Dimensions="${width},${height},0" Locked="False"><Layer.Composition><Composition Width="${width}" Height="${height}">${elements.join('')}</Composition></Layer.Composition></Layer>${boards.join('')}</Composition>`
  const encoder = new TextEncoder()
  const resourcesXml = `<resources>${resources.map(entry => `<resource filename="${xmlAttr(entry.file)}"><source guid="${entry.guid}">${xmlAttr(entry.file)}</source></resource>`).join('')}</resources>`
  const types = `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="text/xml" /><Default Extension="png" ContentType="image/png" />${resources.map(entry => `<Override PartName="/${entry.guid}" ContentType="application/octet-stream" />`).join('')}</Types>`
  const files: Array<[string, Uint8Array]> = [['document.xml', encoder.encode(documentXml)], ...resources.map(entry => [entry.guid, entry.data] as [string, Uint8Array]), ['resources.xml', encoder.encode(resourcesXml)]]
  if (options.thumbnail) files.push(['thumbnail.png', options.thumbnail])
  files.push(['[Content_Types].xml', encoder.encode(types)])
  return { bytes: writeZip(files), report: [...report] }
}

function textOf(node: XmlNode): string | null { return node.attrs['#text'] ?? null }

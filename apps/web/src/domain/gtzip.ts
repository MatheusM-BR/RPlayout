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
export interface GtAnimation { width: number; height: number; objects: GtObject[]; enter: GtStep[]; exit: GtStep[] }
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
  while ((match = tagRe.exec(text))) {
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
  if (node.tag === 'Ticker') ctx.report.add('Ticker importado como texto fixo; a rolagem fica para o engine (G2).')
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
  const ctx: Context = { defs: [], fields: [], usedKeys: new Set(), report: new Set(), images, masks: new Set(), byName: new Map(), ids: 1, prefix, objects: [], numbers: new Map() }
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
  const animation: GtAnimation = { width, height, objects: ctx.objects, enter: steps('in'), exit: steps('out') }
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

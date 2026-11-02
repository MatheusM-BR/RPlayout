import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { renderTemplate } from '@rplayout/protocol'
import { convertGtDocument, exportGtzip, gtColor, importGtzip, parseXml, readZip, transitionInMs } from './gtzip.js'

const doc = `<?xml version="1.0" encoding="utf-16"?>
<Composition Width="1920" Height="1080">
  <Layer Name="Base Layer" Dimensions="1560,190,0" Location="180,832,0">
    <Layer.Composition>
      <Composition Width="1560" Height="190">
        <Rectangle Name="Fundo" Dimensions="1500,190,0" Radius="8">
          <Rectangle.Fill><Brush Type="LinearGradient" Color="#FF808080" EndPoint="1,0"><Brush.Stops><GradientStop Color="#FF808080" /><GradientStop Position="1" Color="#80005490" /></Brush.Stops></Brush></Rectangle.Fill>
        </Rectangle>
        <Image Name="Logo Image" Dimensions="140,140,0" Location="42,25,0"><Image.Bitmap><Bitmap Source="abc\\IMAGE1.png" /></Image.Bitmap></Image>
        <Rectangle Name="Linha" Dimensions="31,190,0" Location="216,0,0">
          <Rectangle.Effects><Effect Type="Skew" Angle="10,0" /><Effect Type="Shadow" BlurAmount="3" /></Rectangle.Effects>
          <Rectangle.Fill><Brush Color="#FF005490" /></Rectangle.Fill>
        </Rectangle>
      </Composition>
    </Layer.Composition>
  </Layer>
  <TextBlock Name="Headline" Dimensions="1163,71,0" Location="322,860,0" Text="NOME &amp; CARGO" FontFamily="Century Gothic" FontSize="84" FontWeight="Bold" VerticalAlign="Center" AutoSize="ShrinkOnly">
    <TextBlock.Fill><Brush Color="#FF000000" /></TextBlock.Fill>
  </TextBlock>
  <TextBlock Name="Description" Dimensions="1103,59,0" Location="382,950,0" Text="Descrição" TextAlign="Center" />
  <Storyboard><Storyboard.Animations><Fly Object="Fundo" Delay="0.2" /><Fade Object="Headline" Delay="1.2" Duration="0.4" /><None Object="Logo Image" Delay="3" /></Storyboard.Animations></Storyboard>
  <Storyboard Type="TransitionOut"><Storyboard.Animations><Fly Object="Base Layer" Direction="Right" /></Storyboard.Animations></Storyboard>
</Composition>`

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const utf16 = (text: string) => { const out = new Uint8Array(2 + text.length * 2); out[0] = 0xff; out[1] = 0xfe; for (let i = 0; i < text.length; i++) { out[2 + i * 2] = text.charCodeAt(i) & 0xff; out[3 + i * 2] = text.charCodeAt(i) >> 8 } return out }

function zip(files: Record<string, Uint8Array>): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name), body = deflateRawSync(data)
    const local = new Uint8Array(30 + nameBytes.length + body.length), lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, body.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30); local.set(body, 30 + nameBytes.length)
    const central = new Uint8Array(46 + nameBytes.length), cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, body.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local); centrals.push(central); offset += local.length
  }
  const size = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22), ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true)
  const all = [...locals, ...centrals, end], out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
  let at = 0; for (const part of all) { out.set(part, at); at += part.length }
  return out
}
const inflate = async (data: Uint8Array) => new Uint8Array((await import('node:zlib')).inflateRawSync(data))

describe('importação de título GT do vMix', () => {
  it('cor #AARRGGBB vira cor e opacidade', () => {
    expect(gtColor('#80005490')).toEqual({ color: '#005490', opacity: 0.5 })
    expect(gtColor('#FF000000')).toEqual({ color: '#000000', opacity: 1 })
    expect(gtColor('lixo').color).toBe('none')
  })

  it('parser lê atributos com entidades e aninhamento', () => {
    const root = parseXml('<a x="1 &amp; 2"><b/><c y=\'3\'></c></a>')
    expect(root.children[0]).toMatchObject({ tag: 'a', attrs: { x: '1 & 2' } })
    expect(root.children[0]!.children.map(node => node.tag)).toEqual(['b', 'c'])
    expect(() => parseXml('<a><b></a>')).toThrow('malformado')
  })

  it('converte camadas, gradiente, efeitos e textos com campos do vMix', () => {
    const result = convertGtDocument(doc, 'Tarja', source => (source.endsWith('IMAGE1.png') ? png : null))
    expect(result.fields).toEqual([
      { key: 'Headline', label: 'Headline.Text', defaultValue: 'NOME & CARGO' },
      { key: 'Description', label: 'Description.Text', defaultValue: 'Descrição' },
    ])
    expect(result.svg).toContain('viewBox="0 0 1920 1080"')
    expect(result.svg).toMatch(/<linearGradient id="gt\w+_g1" x1="0" y1="0" x2="1" y2="0">/)
    expect(result.svg).toContain('stop-opacity="0.5"')
    expect(result.svg).toContain('<g data-a="1" transform="translate(180 832)" data-gt="Base Layer">')
    expect(result.svg).toContain('skewX(-10)')
    expect(result.svg).toContain('feDropShadow')
    expect(result.svg).toContain('href="data:image/png;base64,')
    expect(result.svg).toContain(`rx="8" ry="8"`)
    expect(result.svg).toMatch(/font-size="58\.22"[^>]*font-weight="bold"/)
    expect(result.svg).toContain('text-anchor="middle"')
    expect(result.fadeMs).toBe(1600)
    expect(result.animation.objects.find(object => object.n === 2)).toMatchObject({ x: 0, y: 0, w: 1500, h: 190, ax: 180, ay: 832 })
    expect(result.animation.enter).toEqual([
      { n: 2, kind: 'Fly', delayMs: 200, durationMs: 500, direction: '', easing: '' },
      { n: 5, kind: 'Fade', delayMs: 1200, durationMs: 400, direction: '', easing: '' },
      { n: 3, kind: 'None', delayMs: 3000, durationMs: 500, direction: '', easing: '' },
    ])
    expect(result.animation.exit).toEqual([{ n: 1, kind: 'Fly', delayMs: 0, durationMs: 500, direction: 'Right', easing: '' }])
    expect(result.svg).toContain('<metadata id="rplayout-gt">{&quot;width&quot;:1920')
    const rendered = renderTemplate({ svg: result.svg, fields: result.fields }, { Headline: 'JOÃO <SILVA>' })
    expect(rendered).toContain('JOÃO &lt;SILVA&gt;')
    expect(rendered).toContain('>Descrição<')
  })

  it('entrada do storyboard ignora None e soma atraso + duração', () => {
    const composition = parseXml(doc).children[0]!
    expect(transitionInMs(composition)).toBe(1600)
  })

  it('lê o .gtzip (UTF-16, recursos com GUID, miniatura)', async () => {
    const resources = '<resources><resource filename="abc\\IMAGE1.png"><source guid="1111-2222">abc\\IMAGE1.png</source></resource></resources>'
    const bytes = zip({ 'document.xml': utf16(doc), 'resources.xml': new TextEncoder().encode(resources), '1111-2222': png, 'thumbnail.png': png })
    expect([...(await readZip(bytes, inflate)).keys()]).toContain('document.xml')
    const result = await importGtzip(bytes, 'Title 1- Element Blue.gtzip', inflate)
    expect(result.name).toBe('Title 1- Element Blue')
    expect(result.svg).toContain('data:image/png;base64,')
    expect(result.thumbnail).toEqual(png)
    expect(result.report.some(line => line.includes('Imagem'))).toBe(false)
  })

  it('recusa arquivo que não é título GT', async () => {
    await expect(importGtzip(new Uint8Array([1, 2, 3]), 'x.gtzip', inflate)).rejects.toThrow('zip')
    await expect(importGtzip(zip({ 'a.txt': new Uint8Array([1]) }), 'x.gtzip', inflate)).rejects.toThrow('document.xml')
  })
})

describe('exportação para .gtzip', () => {
  it('ida e volta mantém campos, objetos, imagem e animação', async () => {
    const first = convertGtDocument(doc, 'Tarja', source => (source.endsWith('IMAGE1.png') ? png : null))
    let n = 0
    const { bytes, report } = exportGtzip(first.svg, { name: 'Tarja', fields: first.fields, randomId: () => `id-${++n}` })
    const again = await importGtzip(bytes, 'Tarja.gtzip', inflate)
    expect(again.fields.map(field => [field.label, field.defaultValue])).toEqual([['Headline.Text', 'NOME & CARGO'], ['Description.Text', 'Descrição']])
    expect(again.svg).toContain('data:image/png;base64,')
    expect(again.animation.enter.map(step => step.kind).sort()).toEqual(['Fade', 'Fly', 'None'])
    expect(again.animation.exit.map(step => step.direction)).toContain('Right')
    expect(report.join(' ')).toContain('Gradiente')
    const files = await readZip(bytes, inflate)
    expect([...files.keys()].sort()).toEqual(['[Content_Types].xml', 'document.xml', 'id-1', 'resources.xml'])
  })
  it('arte SVG comum vira título com texto e retângulo', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect x="60" y="900" width="800" height="120" fill="#0b2a4a" fill-opacity="0.8"/><text x="100" y="980" font-family="Inter, Helvetica" font-size="46" fill="#f2f5fb">{{nome}}</text></svg>'
    const { bytes } = exportGtzip(svg, { name: 'Crédito', fields: [{ key: 'nome', label: 'Nome', defaultValue: 'FULANO' }] })
    const back = await importGtzip(bytes, 'Crédito.gtzip', inflate)
    expect(back.fields).toEqual([{ key: 'Nome', label: 'Nome.Text', defaultValue: 'FULANO' }])
    expect(back.svg).toContain('fill="#0b2a4a" fill-opacity="0.8"')
  })
})

it('Ticker vira rolagem contínua com recorte fixo', () => {
  const ticker = `<Composition Width="1920" Height="1080"><Ticker Name="Ticker" Dimensions="1920,130,0" Location="0,950,0" FontFamily="Segoe UI" FontSize="48" FontWeight="Bold" VerticalAlign="Center" TextAlign="Center" Speed="4"><Ticker.Fill><Brush Color="#FFFFFFFF" /></Ticker.Fill></Ticker></Composition>`
  const result = convertGtDocument(ticker, 'Rodapé')
  expect(result.animation.continuous).toEqual([{ n: 1, kind: 'Scroll', pxPerSec: 240, width: 1920, fieldKey: 'Ticker', charWidth: 26.4 }])
  expect(result.svg).toMatch(/<g transform="translate\(0 950\)" clip-path="url\(#gt\w+_t\d+\)"><g data-a="1" transform="translate\(0 0\)" data-gt="Ticker"><text x="0" y="[\d.]+" text-anchor="start"/)
})

import { expect, it } from 'vitest'
import { OverlayDeck, OverlayError } from './overlays.js'
import type { OverlayCommand, Transport } from './transport.js'

const meta = '<metadata id="rplayout-gt">{&quot;width&quot;:1920,&quot;height&quot;:1080,&quot;objects&quot;:[],&quot;enter&quot;:[],&quot;exit&quot;:[]}</metadata>'
const template = { id: 't1', name: 'Tarja GT', channelId: null, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">${meta}<text>{{Headline}}</text></svg>`, fields: [{ key: 'Headline', label: 'Headline.Text', defaultValue: 'NOME' }], fadeMs: 300, holdSeconds: null } as never
function transport() {
  const sent: OverlayCommand[] = []
  return { sent, transport: { overlay: async (command: OverlayCommand) => { sent.push(command) } } as unknown as Transport }
}

it('entra com animação do GT, sai e repete com os mesmos valores', async () => {
  const deck = new OverlayDeck(), { sent, transport: t } = transport()
  const shown = await deck.command(t, 3, { action: 'IN', values: { Headline: 'JOÃO & CIA' } }, template, 'op')
  expect(shown).toMatchObject({ slot: 3, onAir: true, animated: true, values: { Headline: 'JOÃO & CIA' } })
  expect(sent[0]).toMatchObject({ slot: 3, action: 'in', animation: { width: 1920 } })
  expect(sent[0]!.svg).toContain('JOÃO &amp; CIA')
  expect(sent[0]!.svg).toContain('width="1920" height="1080"')
  await deck.command(t, 3, { action: 'OUT' }, null, 'op')
  expect(sent[1]).toEqual({ slot: 3, action: 'out' })
  expect(deck.list()[0]).toMatchObject({ onAir: false })
  await deck.command(t, 3, { action: 'CUT' }, template, 'op')
  expect(sent[2]!.svg).toContain('JOÃO &amp; CIA')
})

it('recusa slot fora de 1–8 e entrada sem arte; OFF em slot vazio só limpa o engine', async () => {
  const deck = new OverlayDeck(), { sent, transport: t } = transport()
  await expect(deck.command(t, 9, { action: 'IN' }, template, null)).rejects.toBeInstanceOf(OverlayError)
  await expect(deck.command(t, 1, { action: 'IN' }, null, null)).rejects.toThrow('arte')
  expect(await deck.command(t, 2, { action: 'OFF' }, null, null)).toBeNull()
  expect(sent).toEqual([{ slot: 2, action: 'off' }])
})

it('falha do engine não marca o overlay como no ar', async () => {
  const deck = new OverlayDeck()
  const t = { overlay: async () => { throw new Error('engine fora') } } as unknown as Transport
  await expect(deck.command(t, 1, { action: 'IN' }, template, null)).rejects.toThrow('engine fora')
  expect(deck.list()).toEqual([])
})

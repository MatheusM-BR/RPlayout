import { describe, expect, it } from 'vitest'
import { confirmAction, confirmOpen, notify, settleConfirm, subscribeConfirm, type ConfirmRequest } from './confirm.js'

describe('confirmação na página', () => {
  it('resolve pela escolha, em fila, e marca aberta enquanto há pedido', async () => {
    let seen: ConfirmRequest[] = []
    const off = subscribeConfirm(queue => { seen = queue })
    const first = confirmAction('Remover a pasta do acervo?')
    const second = confirmAction({ message: 'Publicar?', tone: 'normal' })
    expect(confirmOpen()).toBe(true)
    expect(seen.map(entry => entry.tone)).toEqual(['danger', 'normal'])
    settleConfirm(seen[0]!.id, true)
    settleConfirm(seen[0]!.id, false)
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
    expect(confirmOpen()).toBe(false)
    const done = notify('Erro ao copiar')
    expect(seen[0]!.cancelLabel).toBeNull()
    settleConfirm(seen[0]!.id, true)
    await expect(done).resolves.toBeUndefined()
    off()
  })
})

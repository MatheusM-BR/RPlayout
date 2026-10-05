import type { RundownView } from './plan.js'
import type { TransportState } from './transport.js'

export class TakeTargetError extends Error {
  constructor(message: string, readonly statusCode: 400 | 409 = 400) { super(message) }
}
/** Omitting the item means the confirmed CUE, never Next. Explicit IDs remain
 * available for scheduled/service integrations, always in the active plan. */
export function resolveTakeTarget(execution: RundownView, state: TransportState, explicitItemId?: string | null) {
  let itemId = explicitItemId || (state.preview?.kind === 'ITEM' ? state.preview.id : null)
  if (!itemId && state.preview?.kind === 'SOURCE') {
    const source = state.preview.source
    const candidates = execution.items.filter(entry => entry.item.sourceRef === source)
    if (candidates.length > 1) throw new TakeTargetError('Esta fonte aparece em mais de um evento publicado. Faça CUE na linha desejada para definir qual evento entra no ar.', 409)
    itemId = candidates[0]?.item.id ?? null
    if (!itemId) throw new TakeTargetError('A fonte está aberta no PVW, mas ainda não foi adicionada à grade. Adicione-a antes de usar TAKE.')
  }
  if (!itemId) throw new TakeTargetError(state.preview?.kind === 'ASSET'
    ? 'O arquivo está em inspeção no MAM/QC. Adicione-o à playlist publicada e faça CUE na linha desejada antes do TAKE, preservando cortes e duração.'
    : 'TAKE envia o CUE/PVW ao ar. Selecione um item publicado ou entrada no preview; Próximo é uma operação distinta.')
  const item = execution.items.find(entry => entry.item.id === itemId)?.item
  if (!item) throw new TakeTargetError('O item não pertence à playlist operacional ativa. Publique a alteração antes de colocar o item no ar.', 409)
  return { itemId, item }
}

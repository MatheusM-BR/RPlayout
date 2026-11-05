import { qcApproved } from '@rplayout/protocol'

interface AssetLike { isLiveSource?: boolean; ignored?: boolean; probeError?: string | null; qcStatus?: string | null }

/** Rótulo curto do estado de QC (o mesmo da coluna STATUS / QC da grade). */
export function qcStatusLabel(asset: AssetLike): string {
  if (asset.isLiveSource) return 'AO VIVO'
  if (asset.probeError || asset.ignored) return 'INDISPONÍVEL'
  switch (asset.qcStatus) {
    case 'APPROVED_WITH_NOTES': return 'QC RESSALVA'
    case 'REJECTED': return 'REJEITADO'
    case 'BLOCKED': return 'BLOQUEADO'
    case 'ANALYSIS': return 'EM ANÁLISE'
    default: return qcApproved((asset.qcStatus ?? 'PENDING') as never) ? 'QC OK' : 'QC PEND.'
  }
}

/** Por que um arquivo do acervo ainda não pode entrar na grade (B16: o botão
 * "Inserir" ficava ativo e o erro só vinha do servidor depois do clique).
 * Nulo = pode inserir. Mesmas regras de POST /api/rundowns/:id/items. */
export function insertBlockReason(asset: AssetLike): string | null {
  if (asset.isLiveSource) return null
  if (asset.ignored) return 'Arquivo ignorado: aceite-o no acervo antes de inserir na grade.'
  if (asset.probeError) return 'Arquivo sem leitura técnica válida: confira no QC antes de inserir.'
  const status = asset.qcStatus ?? 'PENDING'
  if (qcApproved(status as never)) return null
  if (status === 'REJECTED') return 'Reprovado no QC: não pode ir para a grade.'
  if (status === 'BLOCKED') return 'Bloqueado no QC para o PGM: não pode ir para a grade.'
  if (status === 'ANALYSIS') return 'Em análise no QC: aguarde a decisão antes de inserir.'
  return 'Pendente de QC: aprove no Quality Control antes de inserir na grade.'
}

export type AssetTone = 'ok' | 'pending' | 'blocked' | 'live'

/** Tom da tarja da linha na biblioteca: laranja = aguardando QC (pendente ou
 * em análise), vermelho = não pode ir ao ar (ignorado, sem leitura, reprovado,
 * bloqueado), nenhum = aprovado. Substitui os badges que escondiam o nome. */
export function assetTone(asset: AssetLike): AssetTone {
  if (asset.isLiveSource) return 'live'
  if (asset.ignored || asset.probeError) return 'blocked'
  const status = asset.qcStatus ?? 'PENDING'
  if (status === 'REJECTED' || status === 'BLOCKED') return 'blocked'
  return qcApproved(status as never) ? 'ok' : 'pending'
}

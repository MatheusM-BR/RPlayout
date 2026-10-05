import type { MediaAsset } from './media.js'
export interface QcProfile {
  codecs: string[]
  width: number | null; height: number | null; fps: number | null
  scan: 'ANY' | 'PROGRESSIVE' | 'INTERLACED'
  requireAudio: boolean; minDurationSeconds: number
  requireLoudness: boolean; minLufs: number; maxLufs: number; maxTruePeakDbtp: number
}
export const DEFAULT_QC_PROFILE: QcProfile = {
  codecs: [], width: null, height: null, fps: null, scan: 'ANY', requireAudio: false,
  minDurationSeconds: 0, requireLoudness: false, minLufs: -25, maxLufs: -21, maxTruePeakDbtp: -1,
}
export function assessQc(asset: MediaAsset, profile: QcProfile = DEFAULT_QC_PROFILE) {
  const errors: string[] = [], warnings: string[] = [], probe = asset.probe
  if (asset.probeError) errors.push(asset.probeError)
  if (asset.kind !== 'VIDEO') errors.push('O perfil de playout requer arquivo de vídeo.')
  if (!probe) warnings.push('Geometria/cadência ainda não sondadas.')
  if (profile.codecs.length && (!probe?.codec || !profile.codecs.includes(probe.codec))) errors.push(`Codec ${probe?.codec ?? 'não identificado'} não permitido (${profile.codecs.join(', ')}).`)
  if (profile.width && probe?.width !== profile.width) errors.push(`Largura exigida: ${profile.width}; detectada: ${probe?.width ?? 'N/D'}.`)
  if (profile.height && probe?.height !== profile.height) errors.push(`Altura exigida: ${profile.height}; detectada: ${probe?.height ?? 'N/D'}.`)
  if (profile.fps && (!probe || Math.abs(probe.rate.num/probe.rate.den-profile.fps) > 0.01)) errors.push(`Cadência exigida: ${profile.fps} fps.`)
  if (profile.scan !== 'ANY' && (!probe || (profile.scan === 'PROGRESSIVE' ? probe.interlaceMode !== 'progressive' : probe.interlaceMode !== 'interleaved'))) errors.push(`Varredura exigida: ${profile.scan}.`)
  if (profile.requireAudio && !probe?.hasAudio) errors.push('Áudio obrigatório ausente ou não sondado.')
  if (profile.minDurationSeconds > 0 && (asset.durationNs == null || asset.durationNs/1e9 < profile.minDurationSeconds)) errors.push(`Duração mínima: ${profile.minDurationSeconds}s.`)
  const loudness = asset.loudnessFile
  if (!loudness && (profile.requireLoudness || probe?.hasAudio)) (profile.requireLoudness ? errors : warnings).push('Loudness do original não medida; execute a varredura com medição.')
  if (loudness && profile.requireLoudness) {
    if (!Number.isFinite(loudness.integratedLufs) || !Number.isFinite(loudness.truePeakDbtp)) errors.push('Medição de loudness inválida; refaça a análise do original.')
    if (loudness.integratedLufs < profile.minLufs || loudness.integratedLufs > profile.maxLufs) errors.push(`Loudness ${loudness.integratedLufs.toFixed(1)} LUFS fora da faixa ${profile.minLufs} a ${profile.maxLufs}.`)
    if (loudness.truePeakDbtp > profile.maxTruePeakDbtp) errors.push(`True peak ${loudness.truePeakDbtp.toFixed(1)} dBTP excede ${profile.maxTruePeakDbtp}.`)
  }
  return { playable: errors.length === 0, errors, warnings }
}
export const qcApproved = (status: string | null | undefined) => status === 'APPROVED' || status === 'APPROVED_WITH_NOTES'

/** A reviewed snapshot, not a hash-only authorization. The monotonic asset
 * revision includes every writer of technical metadata and QC decisions. */
export interface QcReview {
  assetId: string; channelId: string; contentHash: string
  assetRevision: number; configurationRevision: number
}
export const qcAssetETag = (id: string, revision: number) => `"qc-asset:${encodeURIComponent(id)}:${revision}"`
export const qcDecisionETag = (review: QcReview) =>
  `"qc:${encodeURIComponent(review.assetId)}:${review.assetRevision}:${encodeURIComponent(review.channelId)}:${review.configurationRevision}"`

import type { MediaAsset } from './media.js'
import type {LiveSignalPolicy} from './live-signal.js'
import type { Rate } from './rate.js'
/** O que o canal entrega. Comparação padrão: diferença vira AVISO (nunca bloqueia). */
export interface QcChannelReference {
  readonly width: number; readonly height: number; readonly rate: Rate
  readonly scan: 'PROGRESSIVE' | 'INTERLACED'; readonly audioChannels?: number
}
/** Abaixo disto a medição EBU R128 está no gate: o arquivo é, na prática, mudo. */
export const QC_SILENT_LUFS = -60
export interface QcProfile {
  /** Explicit isolated rendered-bus policy. Absence is unconfigured, not pass. */
  renderedBusPairs?:Array<{outputPair:number;loudness:{minLufs:number;maxLufs:number}|null;maxTruePeakDbtp:number}>
  /** Undefined is legacy compatibility, not evidence of complete probing. */
  requireProbe?:boolean
  /** Live warning settings; never alter file eligibility or TAKE readiness. */
  liveSignalPolicy?:LiveSignalPolicy
  codecs: string[]
  width: number | null; height: number | null; fps: number | null
  scan: 'ANY' | 'PROGRESSIVE' | 'INTERLACED'
  requireAudio: boolean; minDurationSeconds: number
  requireLoudness: boolean; minLufs: number; maxLufs: number; maxTruePeakDbtp: number
}
export const DEFAULT_QC_PROFILE: QcProfile = {
  requireProbe:false,
  codecs: [], width: null, height: null, fps: null, scan: 'ANY', requireAudio: false,
  minDurationSeconds: 0, requireLoudness: false, minLufs: -25, maxLufs: -21, maxTruePeakDbtp: -1,
}
/** Faixa padrão de aceitação derivada do alvo do canal (±2 LU). Só para
 * preencher perfis novos ou exibir uma sugestão; nunca reescreve um perfil gravado. */
export const qcLoudnessRangeFor = (targetLufs: number) => ({ minLufs: targetLufs - 2, maxLufs: targetLufs + 2 })
/** Perfil efetivo de um canal sem perfil gravado: o padrão, com a faixa de
 * loudness centrada no alvo do canal (−23 → −25/−21; −14 → −16/−12). Perfis
 * já gravados não são reescritos (sem migração destrutiva). */
export function defaultQcProfileFor(targetLufs: number | null | undefined): QcProfile {
  return Number.isFinite(targetLufs) ? { ...DEFAULT_QC_PROFILE, ...qcLoudnessRangeFor(targetLufs as number) } : DEFAULT_QC_PROFILE
}
const fmt = (value: number) => String(Math.round(value * 1000) / 1000).replace('.', ',')
/**
 * Avaliação técnica de um arquivo para um canal.
 *
 * - `errors` bloqueiam (só o que o perfil exige explicitamente).
 * - `warnings` são sempre calculados: loudness/TP fora da faixa do perfil e
 *   diferenças de cadência, raster, varredura e canais de áudio em relação ao
 *   canal aparecem em âmbar mesmo quando o perfil não exige nada. Um arquivo
 *   não precisa ser recusado para o engenheiro saber que ele será convertido.
 */
export function assessQc(asset: MediaAsset, profile: QcProfile = DEFAULT_QC_PROFILE, channel?: QcChannelReference | null) {
  const errors: string[] = [], warnings: string[] = [], probe = asset.probe
  if (asset.probeError) errors.push(asset.probeError)
  if (asset.kind !== 'VIDEO') errors.push('O perfil de playout requer arquivo de vídeo.')
  if (!probe) warnings.push('Geometria/cadência ainda não sondadas.')
  if(profile.requireProbe){
    if(!probe)errors.push('Sondagem técnica completa obrigatória; analise o original antes de aprovar.')
    if(asset.durationNs==null)errors.push('Duração do original não sondada; análise completa obrigatória.')
    if(probe){
      if(typeof probe.codec!=='string'||!probe.codec.trim())errors.push('Codec do original não identificado; análise completa obrigatória.')
      if(!['progressive','interleaved','mixed'].includes(probe.interlaceMode))errors.push('Varredura do original não identificada; análise completa obrigatória.')
      if(typeof probe.hasAudio!=='boolean'||probe.hasAudio&&(!Number.isSafeInteger(probe.audioChannels)||probe.audioChannels<1))errors.push('Declaração de áudio incompleta; sonde a presença e o número de canais do original.')
    }
  }else if(!probe||asset.durationNs==null||!probe.codec)warnings.push('Compatibilidade de legado: este perfil não exige sondagem completa. Aprovação humana não comprova os metadados ausentes.')
  const validRate=Boolean(probe&&Number.isSafeInteger(probe.rate?.num)&&probe.rate.num>0&&Number.isSafeInteger(probe.rate?.den)&&probe.rate.den>0)
  if(probe&&!validRate)errors.push('Cadência sondada inválida; refaça a análise do original.')
  if(probe&&(!Number.isSafeInteger(probe.width)||probe.width<=0||!Number.isSafeInteger(probe.height)||probe.height<=0))errors.push('Geometria sondada inválida; refaça a análise do original.')
  if(asset.durationNs!=null&&(!Number.isFinite(asset.durationNs)||asset.durationNs<=0))errors.push('Duração sondada inválida; refaça a análise do original.')
  if (profile.codecs.length && (!probe?.codec || !profile.codecs.includes(probe.codec))) errors.push(`Codec ${probe?.codec ?? 'não identificado'} não permitido (${profile.codecs.join(', ')}).`)
  if (profile.width && probe?.width !== profile.width) errors.push(`Largura exigida: ${profile.width}; detectada: ${probe?.width ?? 'N/D'}.`)
  if (profile.height && probe?.height !== profile.height) errors.push(`Altura exigida: ${profile.height}; detectada: ${probe?.height ?? 'N/D'}.`)
  if (profile.fps && (!validRate || Math.abs(probe!.rate.num/probe!.rate.den-profile.fps) > 0.01)) errors.push(`Cadência exigida: ${profile.fps} fps.`)
  if (profile.scan !== 'ANY' && (!probe || (profile.scan === 'PROGRESSIVE' ? probe.interlaceMode !== 'progressive' : probe.interlaceMode !== 'interleaved'))) errors.push(`Varredura exigida: ${profile.scan}.`)
  if (profile.requireAudio && !probe?.hasAudio) errors.push('Áudio obrigatório ausente ou não sondado.')
  if (profile.minDurationSeconds > 0 && (asset.durationNs == null || !Number.isFinite(asset.durationNs) || asset.durationNs/1e9 < profile.minDurationSeconds)) errors.push(`Duração mínima: ${profile.minDurationSeconds}s.`)
  const loudness = asset.loudnessFile
  if (!loudness && (profile.requireLoudness || probe?.hasAudio)) (profile.requireLoudness ? errors : warnings).push('Loudness do original não medida; execute a varredura com medição.')
  if (loudness && profile.requireLoudness) {
    if(loudness.scope!=='FILE')errors.push('O perfil exige loudness do arquivo inteiro; uma medição de trecho não aprova o original.')
    if(loudness.input&&loudness.input.contentHash!==asset.contentHash)errors.push('A medição de loudness pertence a outra versão do arquivo; refaça a análise do original.')
    if (!Number.isFinite(loudness.integratedLufs) || !Number.isFinite(loudness.truePeakDbtp) || !Number.isFinite(loudness.lra) || loudness.lra<0 || !Number.isFinite(Date.parse(loudness.measuredAt))) errors.push('Medição de loudness inválida; refaça a análise do original.')
    if (loudness.integratedLufs < profile.minLufs || loudness.integratedLufs > profile.maxLufs) errors.push(`Loudness ${loudness.integratedLufs.toFixed(1)} LUFS fora da faixa ${profile.minLufs} a ${profile.maxLufs}.`)
    if (loudness.truePeakDbtp > profile.maxTruePeakDbtp) errors.push(`True peak ${loudness.truePeakDbtp.toFixed(1)} dBTP excede ${profile.maxTruePeakDbtp}.`)
  }
  if (loudness && !profile.requireLoudness && Number.isFinite(loudness.integratedLufs) && Number.isFinite(loudness.truePeakDbtp)) {
    const part = loudness.scope === 'FILE' ? '' : ' (medição de trecho)'
    if (loudness.integratedLufs > QC_SILENT_LUFS && (loudness.integratedLufs < profile.minLufs || loudness.integratedLufs > profile.maxLufs)) warnings.push(`Loudness ${loudness.integratedLufs.toFixed(1)} LUFS fora da faixa ${profile.minLufs} a ${profile.maxLufs}${part}. Não bloqueia: o perfil não exige loudness.`)
    if (loudness.truePeakDbtp > profile.maxTruePeakDbtp) warnings.push(`True peak ${loudness.truePeakDbtp.toFixed(1)} dBTP excede ${profile.maxTruePeakDbtp}${part}. Não bloqueia: o perfil não exige loudness.`)
  }
  if (loudness && Number.isFinite(loudness.integratedLufs) && loudness.integratedLufs <= QC_SILENT_LUFS) warnings.push(`Áudio mudo ou abaixo do gate (${loudness.integratedLufs.toFixed(1)} LUFS): confira se o silêncio é intencional.`)
  if (asset.suggestedTrim && asset.durationFrames > 0 && asset.suggestedTrim.out - asset.suggestedTrim.in <= 0) warnings.push('Preto/silêncio detectado no arquivo inteiro.')
  if (channel && probe && asset.kind === 'VIDEO') {
    const fileFps = validRate ? probe.rate.num / probe.rate.den : null, channelFps = channel.rate.num / channel.rate.den
    if (!profile.fps && fileFps != null && Math.abs(fileFps - channelFps) > 0.01) warnings.push(`Cadência ${fmt(fileFps)} fps difere do canal (${fmt(channelFps)} fps): haverá conversão de cadência.`)
    if (!profile.width && !profile.height && Number.isSafeInteger(probe.width) && Number.isSafeInteger(probe.height) && probe.width > 0 && probe.height > 0 && (probe.width !== channel.width || probe.height !== channel.height)) warnings.push(`Raster ${probe.width}x${probe.height} difere do canal (${channel.width}x${channel.height}): a imagem será escalada.`)
    if (profile.scan === 'ANY') {
      if (channel.scan === 'PROGRESSIVE' && (probe.interlaceMode === 'interleaved' || probe.interlaceMode === 'mixed')) warnings.push(`Varredura ${probe.interlaceMode === 'mixed' ? 'mista' : 'entrelaçada'} num canal progressivo: haverá desentrelaçamento.`)
      if (channel.scan === 'INTERLACED' && probe.interlaceMode === 'progressive') warnings.push('Varredura progressiva num canal entrelaçado: confira movimento e ordem de campos.')
    }
    const busChannels = channel.audioChannels ?? 2
    if (probe.hasAudio === false && !profile.requireAudio) warnings.push('Arquivo sem áudio: o PGM ficará mudo durante este item.')
    else if (probe.hasAudio && Number.isSafeInteger(probe.audioChannels) && probe.audioChannels > 0 && probe.audioChannels !== busChannels) warnings.push(`Áudio com ${probe.audioChannels} canal(is); o barramento do canal tem ${busChannels}${probe.audioChannels === 1 ? ' (mono será duplicado)' : probe.audioChannels > busChannels ? ' (canais excedentes não vão ao ar sem roteamento)' : ''}.`)
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

import { msToFrames, type Frames, type Rate } from './rate.js'
import { frameConverter } from './cadence.js'

/** Ponto de entrada e de saída, em frames, sobre a timeline do arquivo. */
export interface Trim {
  readonly in: Frames
  readonly out: Frames
}

export const trimDuration = (trim: Trim): Frames => Math.max(0, trim.out - trim.in)

export type LoudnessScope = 'FILE' | 'TRIM'

/** Resultado de uma análise EBU R128. */
export interface LoudnessMeasurement {
  /** Loudness integrada do programa, em LUFS. */
  readonly integratedLufs: number
  /** Loudness range — a faixa dinâmica, em LU. */
  readonly lra: number
  /** Pico verdadeiro, em dBTP, medido com oversampling. */
  readonly truePeakDbtp: number
  /** Se foi medido o arquivo inteiro ou só o trecho que vai ao ar. */
  readonly scope: LoudnessScope
  readonly measuredAt: string
  /** Exact pre-gain stereo input that was measured, not another track/mix. */
  readonly input?:{readonly contentHash:string;readonly audioTrack:number;readonly routing:AudioRouting;readonly trim?:{readonly inNs:number;readonly outNs:number}}
}

/** TRIM has no persisted cut identity yet, so cannot stand in for FILE. */
export function validFileLoudness(measured:LoudnessMeasurement|null|undefined,contentHash?:string):measured is LoudnessMeasurement & {readonly scope:'FILE'} {
  return Boolean(measured&&measured.scope==='FILE'&&[measured.integratedLufs,measured.lra,measured.truePeakDbtp].every(Number.isFinite)&&measured.lra>=0&&Number.isFinite(Date.parse(measured.measuredAt))&&(!measured.input||measured.input.contentHash===contentHash))
}
export interface AudioCutIdentity {readonly inNs:number;readonly outNs:number}
export function audioCutIdentity(trim:Trim,rate:Rate):AudioCutIdentity {
  const inNs=Math.round(trim.in*rate.den*1e9/rate.num),outNs=Math.round(trim.out*rate.den*1e9/rate.num)
  if(!Number.isSafeInteger(inNs)||!Number.isSafeInteger(outNs)||inNs<0||outNs<=inNs)throw new Error('Corte de áudio inválido.')
  return {inNs,outNs}
}
export function sameAudioCut(a:AudioCutIdentity|undefined,b:AudioCutIdentity|undefined):boolean {
  return Boolean(a&&b&&a.inNs===b.inNs&&a.outNs===b.outNs&&Number.isSafeInteger(a.inNs)&&Number.isSafeInteger(a.outNs)&&a.inNs>=0&&a.outNs>a.inNs)
}

export type AudioMode =
  /** Ganho calculado a partir da medição de loudness. */
  | 'AUTO'
  /** Ganho digitado pelo operador. */
  | 'MANUAL'
  /** Sem nivelamento — o arquivo vai ao ar como está. */
  | 'OFF'

export interface AudioLevel {
  readonly mode: AudioMode
  readonly gainDb: number
  readonly measured: LoudnessMeasurement | null
  /** Quais pares de canais SDI entram no mix. Vazio significa todos. */
  readonly channelMap?: readonly number[]
  /** Input-channel routing into the stereo PGM, before gain/limiter. */
  readonly routing?: AudioRouting
  /** Durable server-owned measurement. Client values alone are not evidence. */
  readonly analysisId?:string
  /** One-based pairs from the selected track; output pair 1 is master. */
  readonly auxiliaryPairs?: readonly AuxiliaryAudioPair[]
}

export interface AuxiliaryAudioPair {
  readonly outputPair:number
  readonly inputPair:number
  /** Independent of master leveling; default 0dB. */
  readonly gainDb?:number
}
export function validateAuxiliaryPairs(pairs:readonly AuxiliaryAudioPair[],outputChannels:number,inputChannels?:number):string|null {
  if(![2,8,16].includes(outputChannels))return 'O barramento de áudio deve ter 2, 8 ou 16 canais.'
  if(pairs.length>7)return 'Escolha no máximo sete pares auxiliares.'
  const outputs=new Set<number>()
  for(const pair of pairs){
    if(!Number.isInteger(pair.outputPair)||pair.outputPair<2||pair.outputPair>outputChannels/2)return `Par auxiliar fora do barramento de ${outputChannels} canais. O par 1–2 é reservado ao master.`
    if(outputs.has(pair.outputPair))return 'Cada par de saída pode receber somente uma atribuição.'
    outputs.add(pair.outputPair)
    if(!Number.isInteger(pair.inputPair)||pair.inputPair<1||pair.inputPair>32)return 'Escolha um par de entrada entre 1 e 32.'
    if(!Number.isFinite(pair.gainDb??0)||(pair.gainDb??0)<-60||(pair.gainDb??0)>12)return 'Ganho auxiliar deve estar entre -60 e +12 dB.'
    if(inputChannels!==undefined && pair.inputPair*2>inputChannels)return `A trilha tem ${inputChannels} canal(is); o par auxiliar exige ${pair.inputPair*2}.`
  }
  return null
}

export type AudioRoutingMode='DEFAULT'|'STEREO_1_2'|'STEREO_3_4'|'DOWNMIX_MONO'|'LEFT_ONLY'|'RIGHT_ONLY'|'MATRIX'|'PAIR_MIX'
export interface AudioRouting {
  readonly mode:AudioRoutingMode
  /** Two output rows, one coefficient per actual input channel. */
  readonly matrix?:readonly (readonly number[])[]
  /** Zero-based embedded pair indexes, not output destinations. */
  readonly pairs?:readonly number[]
}
export interface AudioMixAnalysisView {
  readonly id:string;readonly itemId:string;readonly contentHash:string;readonly audioTrack:number;readonly routing:AudioRouting
  readonly state:'PENDING'|'RUNNING'|'READY'|'FAILED';readonly measurement:LoudnessMeasurement|null;readonly error:string|null;readonly updatedAt:string
  readonly trim?:{readonly inNs:number;readonly outNs:number}
}
export function resolvedAudioRouting(audio:AudioLevel):AudioRouting {
  return audio.routing ?? (audio.channelMap?.length?{mode:'PAIR_MIX',pairs:audio.channelMap}:{mode:'DEFAULT'})
}
export function audioRoutingKey(routing:AudioRouting):string {
  return JSON.stringify({mode:routing.mode,...(routing.mode==='MATRIX'?{matrix:routing.matrix}:{}),...(routing.mode==='PAIR_MIX'?{pairs:routing.pairs}:{})})
}
export function hasMatchingAudioMeasurement(audio:AudioLevel,contentHash:string|undefined,audioTrack=0,cut?:AudioCutIdentity):boolean {
  const input=audio.measured?.input
  const measured=audio.measured
  const valid=validFileLoudness(measured,contentHash)||(measured?.scope==='TRIM'&&sameAudioCut(input?.trim,cut)&&[measured.integratedLufs,measured.lra,measured.truePeakDbtp].every(Number.isFinite)&&measured.lra>=0&&Number.isFinite(Date.parse(measured.measuredAt)))
  return Boolean(audio.analysisId && valid && input && input.contentHash===contentHash && input.audioTrack===audioTrack && audioRoutingKey(input.routing)===audioRoutingKey(resolvedAudioRouting(audio)))
}
export function validateAudioRouting(routing:AudioRouting,inputChannels?:number):string|null {
  if(!['DEFAULT','STEREO_1_2','STEREO_3_4','DOWNMIX_MONO','LEFT_ONLY','RIGHT_ONLY','MATRIX','PAIR_MIX'].includes(routing.mode))return 'Modo de canais inválido.'
  if(routing.mode==='MATRIX') {
    const matrix=routing.matrix
    if(!matrix || matrix.length!==2 || !matrix[0]?.length || matrix[0].length>64 || matrix[1]?.length!==matrix[0].length || matrix.some(row=>row.some(value=>!Number.isFinite(value)||Math.abs(value)>1)))return 'Matriz deve ter duas linhas iguais de 1 a 64 canais, com coeficientes entre -1 e 1.'
    if(inputChannels!==undefined && matrix[0].length!==inputChannels)return 'A matriz não corresponde ao número real de canais da trilha selecionada.'
  } else if(routing.matrix!==undefined)return 'Matriz só pode ser enviada no modo MATRIX.'
  if(routing.mode==='PAIR_MIX') {
    if(!routing.pairs?.length || routing.pairs.length>32 || routing.pairs.some(pair=>!Number.isInteger(pair)||pair<0||pair>31) || new Set(routing.pairs).size!==routing.pairs.length)return 'Escolha pares distintos entre 1-2 e 63-64.'
  } else if(routing.pairs!==undefined)return 'Pares só podem ser enviados no modo PAIR_MIX.'
  const required=routing.mode==='STEREO_3_4'?4:routing.mode==='RIGHT_ONLY'||routing.mode==='STEREO_1_2'||routing.mode==='DOWNMIX_MONO'?2:routing.mode==='LEFT_ONLY'?1:routing.mode==='PAIR_MIX'?Math.max(...routing.pairs!)*2+2:0
  if(inputChannels!==undefined && required>inputChannels)return `A trilha tem ${inputChannels} canal(is); esta seleção exige ${required}.`
  return null
}

/** Zero in an old normalized probe means unknown channel count. Only an
 * explicit hasAudio=false proves absence; complete geometry is not required. */
export function knownInputAudioChannels(asset:Pick<MediaAsset,'probe'|'audioMetadata'>|null|undefined,track=0):number|undefined {
  const metadata=asset?.audioMetadata
  if(metadata?.hasAudio===false || !metadata&&asset?.probe?.hasAudio===false)return 0
  const channels=metadata?metadata.tracks?.find(t=>t.index===track)?.channels??(track===0?metadata.channels:undefined)
    :asset?.probe?.audioTracks?.find(t=>t.index===track)?.channels??(track===0?asset?.probe?.audioChannels:undefined)
  return channels&&channels>0?channels:undefined
}

export const NO_AUDIO_LEVEL: AudioLevel = { mode: 'OFF', gainDb: 0, measured: null }

export type MediaKind = 'VIDEO' | 'AUDIO' | 'STILL'

/** Only a failed probe needs an extension hint. A successfully identified
 * video remains a video with any extension; this is not a decoder whitelist. */
const VIDEO_FILE_SUFFIXES = new Set(['mp4', 'm4v', 'mov', 'mkv', 'avi', 'mxf', 'mpg', 'mpeg', 'mpe', 'm2v', 'm1v', 'm2t', 'm2ts', 'mts', 'ts', 'vob', 'webm', 'wmv', 'asf', 'flv', 'f4v', 'ogv', '3gp', '3g2', 'divx', 'dv', 'qt', 'rm', 'rmvb', 'dvr-ms', 'wtv', 'y4m', 'h264', '264', 'h265', '265', 'hevc'])
export function hasVideoFileSuffix(path: string): boolean {
  return VIDEO_FILE_SUFFIXES.has(path.split(/[\\/]/).pop()?.split('.').slice(1).pop()?.toLowerCase() ?? '')
}
export function isIgnoredVideo(asset: { ignored?: boolean; kind: MediaKind; path: string; probeError?: string | null }): boolean {
  return Boolean(asset.ignored && asset.kind === 'VIDEO' && (!asset.probeError || hasVideoFileSuffix(asset.path)))
}

/** Decisão operacional do QC. Arquivos legados entram como aprovados para não
 * interromper uma grade existente; todo conteúdo novo precisa ser liberado. */
export type QcStatus = 'PENDING' | 'ANALYSIS' | 'APPROVED' | 'APPROVED_WITH_NOTES' | 'REJECTED' | 'FAILED' | 'BLOCKED'

/** Uma trilha de áudio do arquivo, na ordem em que ele a declara. */
export interface AudioTrack {
  readonly index: number
  readonly rate: number
  readonly channels: number
  /** Só quando o arquivo declara. A maioria não declara. */
  readonly language?: string
}

/** O que a sonda achou dentro do arquivo. Vazio para o que ela não abriu. */
export interface MediaProbe {
  readonly codec?: string | null
  readonly width: number
  readonly height: number
  /** Cadência do arquivo como razão exata, nunca decimal. */
  readonly rate: Rate
  readonly interlaceMode: 'progressive' | 'interleaved' | 'mixed'
  readonly hasAudio: boolean
  readonly audioChannels: number
  /**
   * Todas as trilhas de áudio. Vazio no que foi sondado antes disto existir,
   * e é por isso que uma lista vazia significa "não sei", não "não tem".
   */
  readonly audioTracks: AudioTrack[]
}

export interface MediaAsset {
  readonly id: string
  /** SHA-256 do conteúdo: reconhece o mesmo arquivo renomeado ou movido. */
  readonly contentHash: string
  readonly path: string
  readonly title: string
  readonly kind: MediaKind
  /**
   * Duração em frames.
   *
   * Só existe relativa a uma cadência, e a cadência que importa é a do canal.
   * Use `durationIn` em vez deste campo sempre que houver um canal por perto:
   * este aqui é o valor herdado de quando o acervo era do seed.
   */
  readonly durationFrames: Frames
  /** Duração de verdade, independente de cadência. */
  readonly durationNs: number | null
  /** O que a sonda leu do arquivo. */
  readonly probe: MediaProbe | null
  /** Raw declarations survive a partial video probe. Null is unknown, not silence. */
  readonly audioMetadata?:{readonly hasAudio:boolean|null;readonly channels:number|null;readonly tracks:readonly AudioTrack[]|null}
  /**
   * Por que a sonda não abriu o arquivo.
   *
   * Arquivo que não abre continua no acervo, com o motivo à vista. Sumir com
   * ele esconde justamente o caso em que o operador precisa fazer alguma coisa
   * -- instalar um plugin, refazer a cópia, trocar o formato.
   */
  readonly probeError: string | null
  readonly categoryId: string | null

  /** Corte padrão do acervo. Item novo criado a partir dele já nasce cortado. */
  readonly defaultTrim: Trim | null
  /** Cadência na qual o padrão foi marcado. Nulo no legado: não inventar FPS. */
  readonly defaultTrimRate?: Rate | null
  /** Nivelamento padrão do acervo. */
  readonly defaultAudio: AudioLevel | null
  /** Medição do arquivo inteiro, feita no ingest. */
  readonly loudnessFile: LoudnessMeasurement | null

  /** Pontas de preto e de silêncio detectadas, como sugestão de corte. */
  readonly suggestedTrim: Trim | null
  /** Estado persistido da conferência humana/técnica antes de usar na grade. */
  readonly qcStatus: QcStatus
  /** Registro curto da decisão ou do motivo de falha. */
  readonly qcNotes: string | null
  readonly qcCheckedAt: string | null
  /** Arquivo deliberadamente oculto do acervo ativo pelo operador. */
  readonly ignored?: boolean
  readonly createdAt: string
}

/** De onde veio o valor que está valendo — a interface mostra isso como selo. */
export type ValueSource = 'ITEM' | 'ASSET' | 'FILE' | 'NONE'

/**
 * Duração do arquivo na cadência de um canal.
 *
 * A duração de verdade é em nanossegundos; frame só existe relativo a uma
 * cadência. Converter aqui, com o canal em mãos, é o que impede um acervo de
 * 29,97 de contar errado num canal de 50 -- e é o mesmo motivo de o resto do
 * sistema contar em frames e não em milissegundos.
 */
/**
 * Imagem parada: o arquivo tem quadro mas não tem tempo.
 *
 * Quem diz quanto ela fica no ar é a grade, como num item ao vivo -- por isso
 * ela não tem duração própria e nunca deve herdar zero.
 */
export function isStill(asset: Pick<MediaAsset, 'kind' | 'probe'>): boolean {
  return asset.kind === 'STILL' || asset.probe?.rate.num === 0
}

/** Quanto uma imagem parada fica no ar quando ninguém disse. */
export const STILL_DEFAULT_SECONDS = 10

export function durationIn(
  asset: Pick<MediaAsset, 'durationNs' | 'durationFrames'>,
  rate: Rate,
): Frames {
  if (asset.durationNs === null) return asset.durationFrames
  return msToFrames(asset.durationNs / 1_000_000, rate)
}

export interface Resolved<T> {
  readonly value: T
  readonly source: ValueSource
}

/** Preserve elapsed time across channels; endpoints round to the nearest frame. */
export function convertTrim(trim: Trim, from: Rate, to: Rate): Trim {
  const converter = frameConverter(from, to)
  const value = { in: converter.frames(trim.in), out: converter.frames(trim.out) }
  if (value.out <= value.in) throw new Error('O corte ficaria vazio na cadência de destino. Aumente o trecho antes de aplicar.')
  return value
}

/**
 * Precedência do corte: item > padrão do asset > arquivo inteiro.
 *
 * O corte é contado na cadência do **canal**, não na do arquivo: é assim que o
 * engine faz o seek, e é o que mantém a grade inteira numa unidade só. Por isso
 * o arquivo inteiro precisa da cadência para virar um corte.
 */
export function resolveTrim(
  itemTrim: Trim | null | undefined,
  asset: Pick<MediaAsset, 'defaultTrim' | 'defaultTrimRate' | 'durationFrames' | 'durationNs'>,
  rate: Rate,
): Resolved<Trim> {
  if (itemTrim) return { value: itemTrim, source: 'ITEM' }
  if (asset.defaultTrim) return { value: asset.defaultTrimRate ? convertTrim(asset.defaultTrim, asset.defaultTrimRate, rate) : asset.defaultTrim, source: 'ASSET' }
  return { value: { in: 0, out: durationIn(asset, rate) }, source: 'FILE' }
}

/**
 * Precedência do nivelamento: item > padrão do asset > sem nivelamento.
 *
 * Quando cai no padrão do asset, a medição do arquivo é anexada — é ela que o
 * modo AUTO usa para calcular o ganho.
 */
export function resolveAudio(
  itemAudio: AudioLevel | null | undefined,
  asset: Pick<MediaAsset, 'defaultAudio' | 'loudnessFile'> & {contentHash?:string},
  audioTrack=0,
  cut?:AudioCutIdentity,
): Resolved<AudioLevel> {
  // A medição do arquivo é do arquivo, não do nível. Um AUTO gravado sem
  // medição é um AUTO que ainda não sabe o que fazer — aqui ele passa a saber.
  const withMeasurement = (level: AudioLevel): AudioLevel =>
    hasMatchingAudioMeasurement(level,asset.contentHash,audioTrack,cut)?level
    : resolvedAudioRouting(level).mode!=='DEFAULT' || audioTrack!==0 || level.analysisId ? {...level,measured:null}
    : { ...level, measured: validFileLoudness(asset.loudnessFile,asset.contentHash)?asset.loudnessFile:validFileLoudness(level.measured,asset.contentHash)?level.measured:null }

  if (itemAudio) return { value: withMeasurement(itemAudio), source: 'ITEM' }
  if (asset.defaultAudio) return { value: withMeasurement(asset.defaultAudio), source: 'ASSET' }
  return {
    value: withMeasurement(NO_AUDIO_LEVEL),
    source: asset.loudnessFile ? 'FILE' : 'NONE',
  }
}

export interface AutoGain {
  readonly gainDb: number
  /** true quando o true peak limitou o ganho antes de chegar no alvo. */
  readonly capped: boolean
  readonly projectedLufs: number
  readonly projectedPeakDbtp: number
  readonly reason: string | null
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Ganho estático para levar a loudness medida até o alvo do canal.
 *
 * O ganho é limitado pelo pico verdadeiro: se subir até o alvo estouraria o
 * ceiling, sobe só até onde dá e diz por quê. Empurrar o resto para o limiter
 * seria trocar um problema de gain staging por distorção.
 */
export function computeAutoGain(
  measured: LoudnessMeasurement | null,
  targetLufs: number,
  ceilingDbtp: number,
): AutoGain {
  if (!measured) {
    return {
      gainDb: 0,
      capped: false,
      projectedLufs: 0,
      projectedPeakDbtp: 0,
      reason: 'Sem medição de loudness — rode a análise antes de nivelar.',
    }
  }

  const desired = targetLufs - measured.integratedLufs
  const headroom = ceilingDbtp - measured.truePeakDbtp

  if (desired > headroom) {
    const gainDb = round1(headroom)
    return {
      gainDb,
      capped: true,
      projectedLufs: round1(measured.integratedLufs + gainDb),
      projectedPeakDbtp: round1(ceilingDbtp),
      reason:
        `O arquivo já vem quente: subir até ${targetLufs} LUFS passaria de ` +
        `${ceilingDbtp} dBTP. Ganho limitado a ${gainDb} dB.`,
    }
  }

  const gainDb = round1(desired)
  return {
    gainDb,
    capped: false,
    projectedLufs: round1(targetLufs),
    projectedPeakDbtp: round1(measured.truePeakDbtp + gainDb),
    reason: null,
  }
}

/** O ganho que o engine realmente aplica no `volume` daquele item. */
export function effectiveGainDb(
  audio: AudioLevel,
  targetLufs: number,
  ceilingDbtp: number,
): number {
  switch (audio.mode) {
    case 'OFF':
      return 0
    case 'MANUAL':
      return audio.gainDb
    case 'AUTO':
      return computeAutoGain(audio.measured, targetLufs, ceilingDbtp).gainDb
  }
}

/** Escopo de aplicação de uma edição de corte ou de nível. */
export type EditScope =
  /** Só este item do rundown. */
  | 'ITEM'
  /** Todos os itens que apontam para o mesmo arquivo, neste rundown. */
  | 'RUNDOWN'
  /** Todos os itens que apontam para o mesmo arquivo, em todos os rundowns. */
  | 'ALL_RUNDOWNS'
  /** Grava como padrão do acervo: item novo já nasce assim. */
  | 'ASSET_DEFAULT'

/** A reviewed, immutable precondition, not permission to edit other channels. */
export interface EditScopeReview {
  readonly itemId:string
  readonly scope:EditScope
  readonly sourceRevision:number
  readonly token:string
  readonly itemsAffected:number
  readonly assetUpdated:boolean
  readonly references:number
  readonly owners:readonly {
    readonly rundownId:string
    readonly rundownName:string
    readonly date:string
    readonly channelId:string
    readonly channelName:string
    readonly count:number
  }[]
}

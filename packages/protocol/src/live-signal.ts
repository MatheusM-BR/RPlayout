import { signalBufferIsRecent, signalSampleAge } from './signal-freshness.js'

/** Operational selection and measured signal are deliberately independent. */
export type LiveSignalStatus = 'UNMONITORED' | 'CONNECTING' | 'SIGNAL_OK' | 'NO_VIDEO' | 'NO_AUDIO' | 'UNSTABLE' | 'FAILED' | 'UNKNOWN' | 'SIMULATED'
export interface LiveSignalSample {
  sampledAt: string
  videoPresent: boolean
  audioPresent: boolean
  videoAgeMs: number | null
  audioAgeMs: number | null
  rateNum?: number | null
  rateDen?: number | null
  receivedFrames?: number
  /** Decoder-pad arrival variation, NOT network packet jitter or RTT. */
  arrivalJitterMs?: number | null
  sampledContentUnchangedMs?:number|null
  contentSampleAgeMs?:number|null
  contentSampleFrames?:number
}
export interface LiveSignalAssessment {
  status: LiveSignalStatus
  videoRecent: boolean
  audioRecent: boolean
  sampleAgeMs: number | null
  instability?: {arrivalJitterMs:number;thresholdMs:number}
  contentStall?:{unchangedMs:number;sampledFrames:number}
}

/** Operational warning policy, not a standards-compliance threshold. Require
 * measured cadence and warm-up before interpreting native arrival variation. */
export const LIVE_ARRIVAL_WARNING_FRAME_INTERVALS = 3
export const LIVE_ARRIVAL_WARNING_MIN_FRAMES = 50
export interface LiveSignalPolicy {arrivalWarningEnabled:boolean;warningFrameIntervals:number;minimumReceivedFrames:number}
export const DEFAULT_LIVE_SIGNAL_POLICY:Readonly<LiveSignalPolicy>={arrivalWarningEnabled:true,warningFrameIntervals:LIVE_ARRIVAL_WARNING_FRAME_INTERVALS,minimumReceivedFrames:LIVE_ARRIVAL_WARNING_MIN_FRAMES}

function arrivalInstability(sample:LiveSignalSample,policy:LiveSignalPolicy=DEFAULT_LIVE_SIGNAL_POLICY):LiveSignalAssessment['instability'] {
  // HTTP rejects invalid settings; defensive fallback also protects old/imported
  // data from disabling diagnostics via NaN, negative or oversized thresholds.
  if(typeof policy.arrivalWarningEnabled!=='boolean'||!Number.isFinite(policy.warningFrameIntervals)||policy.warningFrameIntervals<0.5||policy.warningFrameIntervals>20||!Number.isInteger(policy.minimumReceivedFrames)||policy.minimumReceivedFrames<1||policy.minimumReceivedFrames>10000)policy=DEFAULT_LIVE_SIGNAL_POLICY
  if(!policy.arrivalWarningEnabled)return undefined
  const {rateNum,rateDen,receivedFrames,arrivalJitterMs}=sample
  if(typeof rateNum!=='number'||typeof rateDen!=='number'||typeof receivedFrames!=='number'||typeof arrivalJitterMs!=='number')return undefined
  if(![rateNum,rateDen,receivedFrames,arrivalJitterMs].every(Number.isFinite)||rateNum<=0||rateDen<=0||receivedFrames<policy.minimumReceivedFrames||arrivalJitterMs<0)return undefined
  const thresholdMs=1000*rateDen/rateNum*policy.warningFrameIntervals
  return Number.isFinite(thresholdMs)&&arrivalJitterMs>thresholdMs?{arrivalJitterMs,thresholdMs}:undefined
}

/** Pure diagnosis, not TAKE permission. No measurement is UNKNOWN, not failure
 * or success. NO_AUDIO describes buffers, not measured silence/loudness. */
export function assessLiveSignal(input: {
  mode?: 'NATIVE' | 'SIMULATED'
  active: boolean
  lifecycle?: string
  sample?: LiveSignalSample
  policy?:LiveSignalPolicy
}, now = Date.now()): LiveSignalAssessment {
  const empty = { videoRecent: false, audioRecent: false, sampleAgeMs: null }
  if (input.mode === 'SIMULATED') return { ...empty, status: 'SIMULATED' }
  if (!input.active) return { ...empty, status: 'UNMONITORED' }
  if (input.lifecycle === 'FAILED') return { ...empty, status: 'FAILED' }
  const sampleAgeMs = input.sample ? signalSampleAge(input.sample.sampledAt, now) : null
  const videoRecent = input.mode === 'NATIVE' && !!input.sample && signalBufferIsRecent(input.sample.videoPresent, input.sample.videoAgeMs, sampleAgeMs)
  const audioRecent = input.mode === 'NATIVE' && !!input.sample && signalBufferIsRecent(input.sample.audioPresent, input.sample.audioAgeMs, sampleAgeMs)
  const measured = { videoRecent, audioRecent, sampleAgeMs }
  if (input.mode !== 'NATIVE') return { ...empty, status: 'UNKNOWN' }
  if (videoRecent) {
    const instability=input.sample?arrivalInstability(input.sample,input.policy):undefined
    const sample=input.sample!,unchanged=sample.sampledContentUnchangedMs,age=sample.contentSampleAgeMs,frames=sample.contentSampleFrames
    const contentStall=typeof unchanged==='number'&&Number.isFinite(unchanged)&&unchanged>=2000&&typeof age==='number'&&Number.isFinite(age)&&age>=0&&age<=500&&typeof frames==='number'&&Number.isSafeInteger(frames)&&frames>=9?{unchangedMs:unchanged,sampledFrames:frames}:undefined
    return { ...measured,...(instability?{instability}:{}),...(contentStall?{contentStall}:{}),status:!audioRecent?'NO_AUDIO':instability||contentStall?'UNSTABLE':'SIGNAL_OK' }
  }
  if (sampleAgeMs !== null || input.lifecycle === 'LOST') return { ...measured, status: 'NO_VIDEO' }
  if (input.lifecycle === 'CUEING' || input.lifecycle === 'TAKE_PENDING') return { ...measured, status: 'CONNECTING' }
  return { ...measured, status: 'UNKNOWN' }
}

import {sameLiveSource} from '../liveSource.js'
import type {Live} from '../types.js'
import {assessLiveSignal} from '@rplayout/protocol'

/** A tuning notice belongs to one explicit selection, not every subsequent
 * signal loss. Readiness must still come from qcLivePreviewReady, not an ACK. */
export function qcLiveTuningFeedback(requestKey:string|null,selectionKey:string,sourceName:string|undefined,previewReady:boolean):string|null {
  return requestKey!==null && requestKey===selectionKey && sourceName && !previewReady
    ? `Sintonizando ${sourceName} diretamente no preview…` : null
}

/** Never label another operator's PVW, or PGM-only readiness, as this QC source. */
export function qcLivePreviewReady(source:string|null,preview:Live['transport']['preview']|undefined,signals:Live['transport']['liveSources'],mode?:Live['transport']['mode'],now=Date.now()):boolean {
  if(!source || preview?.kind!=='SOURCE' || !sameLiveSource(source,preview.source))return false
  const signal=signals.find(entry=>sameLiveSource(entry.source,source))
  return signal?.busStates?.pvw==='PVW_READY'
    && assessLiveSignal({mode,active:true,lifecycle:signal.busStates.pvw,sample:signal.measurements?.pvw},now).videoRecent
}

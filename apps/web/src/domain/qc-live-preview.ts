import {sameLiveSource} from '../liveSource.js'
import type {Live} from '../types.js'

/** Never label another operator's PVW, or PGM-only readiness, as this QC source. */
export function qcLivePreviewReady(source:string|null,preview:Live['transport']['preview']|undefined,signals:Live['transport']['liveSources']):boolean {
  if(!source || preview?.kind!=='SOURCE' || !sameLiveSource(source,preview.source))return false
  const signal=signals.find(entry=>sameLiveSource(entry.source,source))
  return signal?.busStates?.pvw==='PVW_READY'
}

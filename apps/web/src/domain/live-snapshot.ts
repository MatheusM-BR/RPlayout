import type {Live} from '../types.js'

/** Keep HTTP and WebSocket operational state identical. */
export function liveSnapshot(message: Live): Live {
  const {transport,reconfiguration,graphic,alerts,now,meters}=message
  return {transport,reconfiguration,graphic,alerts,now,meters}
}

import type {Live} from '../types.js'

/** Keep HTTP and WebSocket operational state identical. Every operational
 * field must be listed: an omitted one silently vanished from the Master after
 * the first WebSocket tick (the live-source swap and the shared-PVW warning). */
export function liveSnapshot(message: Live): Live {
  const {transport,reconfiguration,liveReplacement,qcInspection,graphic,alerts,now,meters}=message
  return {transport,reconfiguration,liveReplacement,qcInspection,graphic,alerts,now,meters}
}

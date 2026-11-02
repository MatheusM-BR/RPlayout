import type {Snapshot} from '../types.js'
import type {ClientContext} from './client-context.js'

/** An API response may be an editorial preview or a native transport ack.
 * Only a response issued in this browser context can replace its operation. */
export function commitSnapshot(context:ClientContext,snapshot:Snapshot,currentChannelId:string|null,apply:(value:Snapshot)=>void):boolean {
  if(!context.accepts(snapshot))return false
  if(snapshot.view && currentChannelId!==snapshot.view.channel.id)context.nextView()
  apply(snapshot)
  return true
}

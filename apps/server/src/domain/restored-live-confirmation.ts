import type {TransportState} from './transport.js'
/** Restored live must be delivering recent decoded video on the exact PGM
 * item/bus. Selection, ACK, cached PVW signal and simulation are not proof.
 * Audio absence remains a separate operational diagnostic, not invented audio. */
export function restoredLiveVideoConfirmed(state:TransportState,itemId:string):boolean{
  return state.mode==='NATIVE'&&state.playing&&state.onAir?.itemId===itemId&&state.liveSources.some(source=>source.busItemIds?.pgm===itemId&&source.busStates?.pgm==='ON_PGM'&&source.busSignals?.pgm?.videoRecent===true&&source.busSignals.pgm.status!=='FAILED')
}

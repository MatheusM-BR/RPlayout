/** Opt-in lifecycle markers only; never paths, credentials, SQL or payloads. */
export function startupTrace(stage:string):void{
  if(process.env.RPLAYOUT_STARTUP_TRACE==='1')console.error(`[rplayout startup] ${stage}`)
}

/** A newly enabled encoder may not yet exist in MediaMTX. Retry only a
 * not-ready response, on the same SDP offer; never retry an accepted session.
 * Missing paths still fail after a finite grace, and cancellation stops waits. */
export async function postWhepOffer(endpoint:string,sdp:string,signal:AbortSignal,request:typeof fetch=fetch,now:()=>number=Date.now):Promise<Response>{
  const expires=now()+5000
  let attempts=0
  for(;;){
    signal.throwIfAborted()
    const response=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/sdp'},body:sdp,signal})
    if(response.ok)return response // caller owns Location, even if subsequently cancelled
    const detail=await response.text()
    signal.throwIfAborted()
    if(detail.toLowerCase().includes('codecs'))throw new Error('CODEC')
    if(![404,503].includes(response.status)||now()>=expires||attempts>=8)throw new Error(`HTTP ${response.status}`)
    const delay=Math.min(250*2**Math.min(attempts++,2),Math.max(0,expires-now()))
    await new Promise<void>((resolve,reject)=>{
      const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(signal.reason??new DOMException('Aborted','AbortError'))}
      const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve()},delay)
      signal.addEventListener('abort',cancel,{once:true})
      if(signal.aborted)cancel()
    })
  }
}

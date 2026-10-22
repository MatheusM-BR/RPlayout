/** Receives arbitrary pipe chunks without retaining an ever-growing recording. */
export class BoundedRawFrames {
  private filling:Buffer
  private latest:Buffer
  private offset=0
  private count=0
  constructor(readonly frameBytes:number){
    if(!Number.isSafeInteger(frameBytes)||frameBytes<1||frameBytes>8*1024*1024)throw new Error('Invalid bounded frame size')
    this.filling=Buffer.alloc(frameBytes);this.latest=Buffer.alloc(frameBytes)
  }
  push(chunk:Uint8Array){
    let at=0
    while(at<chunk.length){
      const take=Math.min(this.frameBytes-this.offset,chunk.length-at)
      this.filling.set(chunk.subarray(at,at+take),this.offset);this.offset+=take;at+=take
      if(this.offset===this.frameBytes){
        const previous=this.latest;this.latest=this.filling;this.filling=previous
        this.offset=0;this.count++
      }
    }
  }
  get framesDecoded(){return this.count}
  get decodedBytes(){return this.count*this.frameBytes}
  get retainedPixelBytes(){return 2*this.frameBytes}
  snapshot():Buffer|null{return this.count?Buffer.from(this.latest):null}
}

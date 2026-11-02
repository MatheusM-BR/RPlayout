import assert from 'node:assert/strict'

/** Read-only evidence from tightly packed GRAY8, not decoder telemetry.
 * Dimensions must be negotiated by the native reader; reject padding/truncation.
 * A moving picture does not prove frame-accurate restoration of an old cursor. */
export function graySequenceStatistics(bytes:Buffer,width:number,height:number){
  assert.ok(Number.isSafeInteger(width)&&width>0&&width%4===0,'Aligned GRAY8 width required')
  assert.ok(Number.isSafeInteger(height)&&height>0)
  const size=width*height
  assert.ok(Number.isSafeInteger(size)&&bytes.length>=size*2&&bytes.length%size===0,'Complete consecutive GRAY8 frames required')
  const frames=bytes.length/size,differences:number[]=[],deviations:number[]=[]
  for(let frame=0;frame<frames;frame++){
    let sum=0,squares=0,difference=0
    const offset=frame*size
    for(let at=0;at<size;at++){
      const value=bytes[offset+at]!
      sum+=value;squares+=value*value
      if(frame>0)difference+=Math.abs(value-bytes[offset-size+at]!)
    }
    deviations.push(Math.sqrt(Math.max(0,squares/size-(sum/size)**2)))
    if(frame>0)differences.push(difference/size)
  }
  return {width,height,frames,minDeviation:Math.min(...deviations),maxDeviation:Math.max(...deviations),differences,movingTransitions:differences.filter(value=>value>0.05).length}
}

export function assertMovingPublishedGray(bytes:Buffer,width:number,height:number){
  const statistics=graySequenceStatistics(bytes,width,height)
  assert.ok(statistics.frames>=25,'At least one second at fixture 25fps required')
  assert.ok(statistics.minDeviation>10,'Every observed frame must contain picture, not a uniform placeholder')
  assert.ok(statistics.movingTransitions>=5,'TAKE must restore picture motion, not just cursor/audio or a frozen frame')
  return statistics
}

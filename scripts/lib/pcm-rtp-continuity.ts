type Phase='BEFORE'|'DURING'|'AFTER'
const empty=()=>({packets:0,frames:0,energy:[0,0],peak:[0,0],silentFrames:0})
/** Bounded statistics from decoded stereo PCM RTP, no growing audio recording. */
export class PcmRtpContinuity {
  private phase:Phase|null=null
  private previous:{sequence:number;timestamp:number;ssrc:number;frames:number}|null=null
  private phases={BEFORE:empty(),DURING:empty(),AFTER:empty()}
  private invalidPackets=0
  private sequenceDiscontinuities=0
  private timestampDiscontinuities=0
  private ssrcChanges=0
  setPhase(phase:Phase){this.phase=phase}
  push(packet:Buffer){
    if(!this.phase)return
    let offset=12,end=packet.length
    if(end<12||packet[0]!>>>6!==2||(packet[1]!&127)!==96){this.invalidPackets++;return}
    offset+=(packet[0]!&15)*4
    if(packet[0]!&16){
      if(offset+4>end){this.invalidPackets++;return}
      offset+=4+packet.readUInt16BE(offset+2)*4
    }
    if(packet[0]!&32){const padding=packet[end-1]!;if(!padding){this.invalidPackets++;return}end-=padding}
    if(offset>=end||(end-offset)%4!==0){this.invalidPackets++;return}
    const current={sequence:packet.readUInt16BE(2),timestamp:packet.readUInt32BE(4),ssrc:packet.readUInt32BE(8),frames:(end-offset)/4}
    if(this.previous){
      if(((current.sequence-this.previous.sequence)&65535)!==1)this.sequenceDiscontinuities++
      if(((current.timestamp-this.previous.timestamp)>>>0)!==this.previous.frames)this.timestampDiscontinuities++
      if(current.ssrc!==this.previous.ssrc)this.ssrcChanges++
    }
    this.previous=current
    const phase=this.phases[this.phase],energy=[0,0]
    for(let at=offset;at<end;at+=4)for(let channel=0;channel<2;channel++){
      const value=packet.readInt16BE(at+channel*2)/32768
      energy[channel]!+=value*value
      phase.peak[channel]=Math.max(phase.peak[channel]!,Math.abs(value))
    }
    phase.packets++;phase.frames+=current.frames
    for(let channel=0;channel<2;channel++)phase.energy[channel]!+=energy[channel]!
    if(energy.every(value=>Math.sqrt(value/current.frames)<0.001))phase.silentFrames+=current.frames
  }
  snapshot(){
    return {rate:48000,channels:2,invalidPackets:this.invalidPackets,sequenceDiscontinuities:this.sequenceDiscontinuities,timestampDiscontinuities:this.timestampDiscontinuities,ssrcChanges:this.ssrcChanges,
      phases:Object.fromEntries(Object.entries(this.phases).map(([name,value])=>[name,{packets:value.packets,frames:value.frames,rms:value.energy.map(energy=>value.frames?Math.sqrt(energy/value.frames):0),peak:[...value.peak],silentFrames:value.silentFrames}])) as Record<Phase,{packets:number;frames:number;rms:number[];peak:number[];silentFrames:number}>}
  }
}

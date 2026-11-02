import {expect,it} from 'vitest'
import {PcmRtpContinuity} from '../../../../scripts/lib/pcm-rtp-continuity.js'
function packet(sequence:number,timestamp:number,ssrc=1,sample=1000){
  const bytes=Buffer.alloc(12+400);bytes[0]=128;bytes[1]=96
  bytes.writeUInt16BE(sequence&65535,2);bytes.writeUInt32BE(timestamp>>>0,4);bytes.writeUInt32BE(ssrc,8)
  for(let at=12;at<bytes.length;at+=2)bytes.writeInt16BE(sample,at)
  return bytes
}
it('mede áudio contínuo por fase, inclusive wrap de sequência/timestamp',()=>{
  const meter=new PcmRtpContinuity()
  meter.push(packet(3,0));expect(meter.snapshot().phases.BEFORE.frames).toBe(0)
  meter.setPhase('BEFORE');meter.push(packet(65535,0xffffffce))
  meter.setPhase('DURING');meter.push(packet(0,50))
  meter.setPhase('AFTER');meter.push(packet(1,150))
  const result=meter.snapshot()
  expect(result).toMatchObject({invalidPackets:0,sequenceDiscontinuities:0,timestampDiscontinuities:0,ssrcChanges:0})
  for(const phase of Object.values(result.phases)){expect(phase.frames).toBe(100);expect(phase.silentFrames).toBe(0);expect(phase.rms[0]).toBeCloseTo(1000/32768)}
})
it('detecta perda, descontinuidade de timestamp e mudança de SSRC sem descartar evidência',()=>{
  const meter=new PcmRtpContinuity();meter.setPhase('BEFORE')
  meter.push(packet(1,0));meter.push(packet(3,250,2))
  expect(meter.snapshot()).toMatchObject({sequenceDiscontinuities:1,timestampDiscontinuities:1,ssrcChanges:1})
})
it('conta silêncio por pacote e não confunde frames com amostras estéreo',()=>{
  const meter=new PcmRtpContinuity();meter.setPhase('DURING');meter.push(packet(1,0,1,0))
  expect(meter.snapshot().phases.DURING).toMatchObject({frames:100,silentFrames:100,rms:[0,0]})
})
it('recusa pacotes truncados/formato errado e snapshots não alteram estado interno',()=>{
  const meter=new PcmRtpContinuity();meter.setPhase('BEFORE')
  meter.push(Buffer.alloc(1));const bad=packet(1,0);bad[1]=97;meter.push(bad)
  const extension=packet(1,0);extension[0]=144;extension.writeUInt16BE(65535,14);meter.push(extension)
  expect(meter.snapshot().invalidPackets).toBe(3)
  meter.push(packet(1,0));const result=meter.snapshot();result.phases.BEFORE.peak[0]=999
  expect(meter.snapshot().phases.BEFORE.peak[0]).toBeLessThan(1)
})

import {expect,it} from 'vitest'
import {stereoToneStatistics,syntheticToneSpectrum,syntheticToneWindows} from '../../../../scripts/lib/verify-published-audio.js'

function pcm(frequency:number,amplitude=0.05){const bytes=Buffer.alloc(48000*8);for(let frame=0;frame<48000;frame++)for(let channel=0;channel<2;channel++)bytes.writeFloatLE(amplitude*Math.sin(2*Math.PI*frequency*frame/48000),frame*8+channel*4);return bytes}
it.each([997,1511])('mede o tom real %s em ambos os canais, não só presença de bytes',frequency=>{
  const result=stereoToneStatistics(pcm(frequency));for(const value of result.frequencyHz)expect(Math.abs(value-frequency)).toBeLessThan(2)
  for(const rms of result.rms)expect(rms).toBeCloseTo(0.05/Math.sqrt(2),4)
})
it('silêncio tem energia zero, não aprova presença de som',()=>{
  const result=stereoToneStatistics(Buffer.alloc(48000*8));expect(result.rms).toEqual([0,0]);expect(result.frequencyHz).toEqual([0,0])
})
it('recusa PCM truncado, curto e não finito',()=>{
  expect(()=>stereoToneStatistics(Buffer.alloc(7))).toThrow();expect(()=>stereoToneStatistics(Buffer.alloc(8))).toThrow()
  const invalid=pcm(997);invalid.writeFloatLE(NaN,0);expect(()=>stereoToneStatistics(invalid)).toThrow('Non-finite PCM')
})
it.each([440,997,1511])('espectro cego identifica %s sem receber o tom esperado',frequency=>{
  const result=syntheticToneSpectrum(pcm(frequency))
  for(const hz of result.frequencyHz)expect(Math.abs(hz-frequency)).toBeLessThan(1)
  for(const ratio of result.toneEnergyRatio)expect(ratio).toBeGreaterThan(0.95)
})
it('ruído pequeno junto do zero não muda o tom; mistura forte não é aprovada',()=>{
  const noisy=pcm(440),mixed=pcm(440)
  for(let i=0;i<48000;i++)for(let c=0;c<2;c++){
    const index=i*8+c*4
    noisy.writeFloatLE(noisy.readFloatLE(index)+0.001*Math.sin(2*Math.PI*9000*i/48000),index)
    mixed.writeFloatLE(mixed.readFloatLE(index)+0.05*Math.sin(2*Math.PI*997*i/48000),index)
  }
  for(const hz of syntheticToneSpectrum(noisy).frequencyHz)expect(Math.abs(hz-440)).toBeLessThan(1)
  for(const ratio of syntheticToneSpectrum(mixed).toneEnergyRatio)expect(ratio).toBeLessThan(0.6)
  expect(syntheticToneSpectrum(Buffer.alloc(48000*8)).toneEnergyRatio).toEqual([0,0])
})
it('janela de meio segundo não perde 440 Hz nos zeros da grade espectral',()=>{
  const result=syntheticToneSpectrum(pcm(440).subarray(0,28800*8))
  expect(result.frequencyHz).toEqual([440,440])
  for(const ratio of result.toneEnergyRatio)expect(ratio).toBeGreaterThan(0.95)
})
it('presença por janelas tolera um salto de fase, não mistura forte ou silêncio',()=>{
  const bytes=pcm(440),mixed=pcm(440)
  for(let i=0;i<48000;i++)for(let c=0;c<2;c++){
    if(i>=15000)bytes.writeFloatLE(0.05*Math.sin(2*Math.PI*440*i/48000+Math.PI/2),i*8+c*4)
    mixed.writeFloatLE(mixed.readFloatLE(i*8+c*4)+0.05*Math.sin(2*Math.PI*997*i/48000),i*8+c*4)
  }
  const spectrum=syntheticToneSpectrum(bytes)
  for(const count of syntheticToneWindows(bytes,spectrum.frequencyHz).concentratedWindows)expect(count).toBeGreaterThanOrEqual(4)
  expect(syntheticToneWindows(mixed,[440,440]).concentratedWindows).toEqual([0,0])
  expect(syntheticToneWindows(Buffer.alloc(48000*8),[440,440]).concentratedWindows).toEqual([0,0])
})

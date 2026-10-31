import {expect,it} from 'vitest'
import {openingWithoutSignalMessage} from './engine.js'
it('abrindo há mais de 5 s sem quadro vira "sem sinal" com orientação por tipo de entrada',()=>{
  const t0=Date.parse('2026-10-21T20:00:00Z')
  expect(openingWithoutSignalMessage('sdi:0','2026-10-21T20:00:00Z',t0+4000)).toBeNull()
  expect(openingWithoutSignalMessage('sdi:0','2026-10-21T20:00:00Z',t0+12000)).toContain('Sem sinal na entrada SDI/HDMI')
  expect(openingWithoutSignalMessage('ndi:X','2026-10-21T20:00:00Z',t0+12000)).toContain('emissor')
  expect(openingWithoutSignalMessage('sdi:0','invalido',t0)).toBeNull()
})

// NOT_RUN: fixtures de contrato; não abrem servidor nem comprovam sinal físico.
import {it,expect} from 'vitest'
import {MediaMtx} from './mediamtx.js'
const unopened=()=>new MediaMtx({binary:'NOT_A_RUNTIME',configPath:'NOT_A_CONFIG',bind:'127.0.0.1',logLevel:'warn',requireAppliedConfig:true})
it('recusa admissão sem posse/cerca/autoridade atuais antes de spawn — NOT_RUN',async()=>{
  const media=unopened();await expect(media.startConfirmed()).rejects.toThrow('exige posse');expect(media.processId).toBeNull();expect(media.readyForPublish).toBe(false)
  expect(await media.stopConfirmed()).toEqual({ownedMediaProcessesStopped:true})
})
it('encerramento confirmado de instância nunca aberta impede abertura posterior — NOT_RUN',async()=>{
  const media=unopened();expect(await media.stopConfirmed()).toEqual({ownedMediaProcessesStopped:true})
  await expect(media.start()).rejects.toThrow('encerrado');expect(media.processId).toBeNull()
})
it('recusa prazos inválidos sem efeitos — NOT_RUN',async()=>{
  const media=unopened();await expect(media.stopConfirmed(0)).rejects.toThrow('Prazo');await expect(media.startConfirmed(30001)).rejects.toThrow('Prazo');expect(media.processId).toBeNull()
  await media.stopConfirmed()
})
it('readiness não é inferida sem processo próprio e cerca — NOT_RUN',async()=>{
  const media=unopened();expect(await media.refreshReadiness()).toBe(false);expect(media.readyForPublish).toBe(false);await media.stopConfirmed()
})

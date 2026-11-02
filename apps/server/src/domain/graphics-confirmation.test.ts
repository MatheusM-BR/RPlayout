import {afterEach,expect,it,vi} from 'vitest'
import {Graphics,fitGraphicViewport} from './graphics.js'
import type {Transport} from './transport.js'
import type {Channel} from '@rplayout/protocol'
const channel={id:'ch',width:320,height:180,rate:{num:25,den:1}} as Channel
afterEach(()=>vi.useRealTimers())
it('viewport normaliza SD/HD/UHD e preserva coordenadas e viewBox explícito',()=>{
  for(const [w,h] of [[640,360],[1280,720],[3840,2160]] as const){
    const fitted=fitGraphicViewport(`<svg width="${w}" height="${h}"><rect x="0" y="${h/2}" width="${w}" height="${h/2}"/></svg>`)
    expect(fitted).toContain(`viewBox="0 0 ${w} ${h}"`);expect(fitted).toContain('width="1920" height="1080"')
    expect(fitted).toContain(`y="${h/2}"`)
  }
  expect(fitGraphicViewport('<svg viewBox="10 20 640 360" width="100%" height="100%"><g/></svg>')).toContain('viewBox="10 20 640 360"')
  expect(fitGraphicViewport('<g><rect width="320" height="180"/></g>')).toBe('<g><rect width="320" height="180"/></g>')
  expect(fitGraphicViewport('<svg stroke-width="2" width="640" height="360"/>')).toBe('<svg stroke-width="2" viewBox="0 0 640 360" width="1920" height="1080"/>')
})
function setup(){
  const graphic=vi.fn(),graphicConfirmed=vi.fn(async(_svg:string|null,_fade:number,authorize?:()=>void)=>{authorize?.()})
  const transport={graphic,graphicConfirmed,state:()=>({mode:'NATIVE'})} as unknown as Transport
  return {graphics:new Graphics(channel,transport),graphic,graphicConfirmed}
}
it('estado fica anterior até ACK e não envia composição duas vezes',async()=>{
  const {graphics,graphic,graphicConfirmed}=setup();let confirm!:()=>void
  graphicConfirmed.mockImplementation((_s,_f,authorize)=>{authorize?.();return new Promise<void>(resolve=>{confirm=resolve})})
  const result=graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{name:'Estúdio Çãó'},()=>{})
  await vi.waitFor(()=>expect(graphicConfirmed).toHaveBeenCalledTimes(1))
  expect(graphics.getLayers().LOWER_THIRD.active).toBe(false);expect(graphics.onAir()).toBeNull()
  expect(graphics.commandPending).toBe(true);expect(graphics.tick()).toBe(false)
  confirm();await result;expect(graphics.getLayers().LOWER_THIRD.active).toBe(true)
  expect(graphics.commandPending).toBe(false);expect(graphic).not.toHaveBeenCalled()
})
it('recusa nativa conserva camada e permite retirada confirmada posterior',async()=>{
  const {graphics,graphicConfirmed}=setup()
  await graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{name:'Original'},()=>{})
  const before=graphics.getLayers();graphicConfirmed.mockRejectedValueOnce(new Error('NATIVE_REJECTED'))
  await expect(graphics.hideConfirmed(()=>{})).rejects.toThrow('NATIVE_REJECTED')
  expect(graphics.getLayers()).toEqual(before);expect(graphics.onAir()?.name).toBe('Original')
  await graphics.hideConfirmed(()=>{});expect(graphics.onAir()).toBeNull()
})
it('HIDE da camada limpa identidade atual mesmo sem reenviar templateId',async()=>{
  const {graphics}=setup()
  await graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{templateId:'white-test',name:'White'},()=>{})
  await graphics.triggerLayerConfirmed('STATION_LOGO','SHOW',{templateId:'white-test',name:'Logo'},()=>{})
  await graphics.triggerLayerConfirmed('LOWER_THIRD','HIDE',{},()=>{})
  expect(graphics.onAir()?.name).toBe('Logo')
  await graphics.triggerLayerConfirmed('STATION_LOGO','HIDE',{},()=>{});expect(graphics.onAir()).toBeNull()
})
it('comandos concorrentes compõem em sequência, não sobrescrevem camadas confirmadas',async()=>{
  const {graphics,graphicConfirmed}=setup()
  await Promise.all([graphics.triggerLayerConfirmed('STATION_LOGO','SHOW',{name:'Logo'},()=>{}),graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{name:'Tarja'},()=>{})])
  const svg=graphicConfirmed.mock.calls[1]![0]!
  expect(svg).toContain('layer-station_logo');expect(svg).toContain('layer-lower_third')
})
it('revogação reconferida na fila não envia nem altera o estado',async()=>{
  const {graphics,graphicConfirmed}=setup();let permitted=true
  const authority=()=>{if(!permitted)throw new Error('REVOKED')}
  graphicConfirmed.mockImplementation(async(_s,_f,authorize)=>{permitted=false;authorize?.()})
  await expect(graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{},authority)).rejects.toThrow('REVOKED')
  expect(graphics.onAir()).toBeNull();expect(graphics.commandPending).toBe(false)
})
it('transporte nativo sem ACK é recusado, não degradado para envio sem confirmação',async()=>{
  const graphic=vi.fn(),graphics=new Graphics(channel,{graphic,state:()=>({mode:'NATIVE'})} as unknown as Transport)
  await expect(graphics.hideConfirmed(()=>{})).rejects.toThrow('não confirma')
  expect(graphic).not.toHaveBeenCalled()
})
it('expiração atravessa meia-noite sem ficar presa aos quadros do dia anterior',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(2026,9,10,23,59,59))
  const {graphics}=setup()
  await graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{durationFrames:75},()=>{})
  vi.setSystemTime(new Date(2026,9,11,0,0,1));expect(graphics.hasExpiredLayers()).toBe(false)
  vi.setSystemTime(new Date(2026,9,11,0,0,2));expect(graphics.hasExpiredLayers()).toBe(true)
  await graphics.expireConfirmed(()=>{});expect(graphics.getLayers().LOWER_THIRD.active).toBe(false)
})
it('duração começa após ACK lento e retirada confirmada não estende outra camada',async()=>{
  vi.useFakeTimers({toFake:['Date']});const time=new Date(2026,9,10,12).getTime();vi.setSystemTime(time)
  const {graphics,graphicConfirmed}=setup()
  await graphics.triggerLayerConfirmed('STATION_LOGO','SHOW',{durationFrames:250},()=>{})
  graphicConfirmed.mockImplementationOnce(async(_s,_f,guard)=>{guard?.();vi.setSystemTime(time+5000)})
  await graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{durationFrames:75},()=>{})
  vi.setSystemTime(time+7000);expect(graphics.hasExpiredLayers()).toBe(false)
  vi.setSystemTime(time+8000);await graphics.expireConfirmed(()=>{})
  expect(graphics.getLayers().LOWER_THIRD.active).toBe(false);expect(graphics.getLayers().STATION_LOGO.active).toBe(true)
  vi.setSystemTime(time+10000);expect(graphics.hasExpiredLayers()).toBe(true)
})

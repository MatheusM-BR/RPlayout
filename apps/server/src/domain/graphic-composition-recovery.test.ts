import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {openDatabase} from '../db/client.js'
import {Graphics} from './graphics.js'
import {GraphicCommandLedger} from './graphic-command-ledger.js'
import type {Transport} from './transport.js'
import type {Channel,SecondaryEvent} from '@rplayout/protocol'
let database:ReturnType<typeof openDatabase>,ledger:GraphicCommandLedger,graphics:Graphics,sent:(string|null)[]
const channel={id:'a',rate:{num:25,den:1}} as Channel
function transport():Transport{return {state:()=>({mode:'NATIVE'}),graphicConfirmed:async(svg:string|null,_fade:number,authorize:()=>void)=>{authorize();sent.push(svg)},graphic:()=>{throw new Error('No unconfirmed product send')}} as unknown as Transport}
const event:SecondaryEvent={id:'manual-secondary',channelId:'a',rundownItemId:'live',type:'GRAPHICS_OVERLAY',targetLayer:'LOWER_THIRD',triggerMode:'MANUAL',offsetFrames:0,templateId:'',payload:{title:'OLD SECONDARY'},enabled:true}
const input=(key:string)=>({key,actorId:null,actorName:'TEST',native:true,selection:{action:'LAYER'}})
async function show(key:string,layer:'STATION_LOGO'|'LOWER_THIRD',title:string,durationFrames?:number){return ledger.execute(input(key),()=>{},send=>graphics.triggerLayerConfirmed(layer,'SHOW',{payload:{title},durationFrames},()=>{},send))}
beforeEach(()=>{
  database=openDatabase(':memory:');database.sqlite.exec("INSERT INTO channels(id,name,width,height,rate_num,rate_den,target_lufs,ceiling_dbtp,limiter_lookahead_ms,created_at) VALUES('a','A',320,180,25,1,-23,-1,5,'now')")
  ledger=new GraphicCommandLedger(database.db,'a');sent=[];graphics=new Graphics(channel,transport())
})
afterEach(()=>{vi.useRealTimers();database.sqlite.close()})
it('durable whole composition restores simultaneous layers, not one historical event',async()=>{
  await show('logo-first','STATION_LOGO','LOGO')
  const lower=await show('lower-next','LOWER_THIRD','LIVE NAME')
  const snapshot=ledger.confirmedDisplay(lower.receipt.id),restored=new Graphics(channel,transport())
  const authorize=()=>{ledger.confirmedDisplay(lower.receipt.id)}
  await ledger.execute({...input('restore-whole'),selection:{action:'COMPOSITION_RESTORE',sourceReceipt:lower.receipt.id}},authorize,send=>restored.restoreDisplayConfirmed(snapshot,authorize,send))
  expect(restored.getLayers().STATION_LOGO.active).toBe(true)
  expect(restored.getLayers().LOWER_THIRD.active).toBe(true)
  expect(sent.at(-1)).toContain('layer-station_logo');expect(sent.at(-1)).toContain('layer-lower_third')
  expect(ledger.list()).toHaveLength(3)
})
it('later manual replacement survives restart and prevents resurrection of secondary owner',async()=>{
  graphics=new Graphics(channel,transport(),{template:()=>undefined,execute:(_event,_mode,work)=>ledger.execute(input('secondary-show'),()=>{},send=>work(()=>{},send)).then(()=>{})})
  graphics.scheduler.setEvents([event]);await graphics.scheduler.triggerManual(event.id)
  const old=ledger.latestNativeCompositionId()!
  expect(ledger.confirmedDisplay(old).owners.LOWER_THIRD?.eventId).toBe(event.id)
  const replacement=await show('replace-manual','LOWER_THIRD','NEW OPERATOR')
  expect(()=>ledger.confirmedDisplay(old)).toThrow('Composição mudou')
  const saved=ledger.confirmedDisplay(replacement.receipt.id),restored=new Graphics(channel,transport())
  expect(saved.owners.LOWER_THIRD).toBeUndefined()
  await restored.restoreDisplayConfirmed(saved,()=>{},()=>{})
  expect(sent.at(-1)).toContain('NEW OPERATOR');expect(sent.at(-1)).not.toContain('OLD SECONDARY')
})
it('absolute hold expires during downtime while persistent logo remains',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(1000)
  await show('persistent-logo','STATION_LOGO','LOGO')
  const lower=await show('short-lower','LOWER_THIRD','SHORT',25)
  const saved=ledger.confirmedDisplay(lower.receipt.id)
  vi.setSystemTime(2500);const restored=new Graphics(channel,transport())
  await restored.restoreDisplayConfirmed(saved,()=>{},()=>{})
  expect(restored.getLayers().LOWER_THIRD.active).toBe(false)
  expect(restored.getLayers().STATION_LOGO.active).toBe(true)
  expect(restored.displaySnapshot().deadlines.LOWER_THIRD).toBeUndefined()
})
it('restoring an unexpired hold does not restart or extend its deadline',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(1000)
  const lower=await show('hold-original','LOWER_THIRD','HOLD',25)
  const saved=ledger.confirmedDisplay(lower.receipt.id)
  vi.setSystemTime(1500);const restored=new Graphics(channel,transport())
  await restored.restoreDisplayConfirmed(saved,()=>{},()=>{})
  expect(restored.displaySnapshot().deadlines.LOWER_THIRD).toBe(2000)
})
it('uncertain native command blocks previous display even after operator review',async()=>{
  const prior=await show('before-unknown','LOWER_THIRD','OLD')
  await expect(ledger.execute(input('unknown-send'),()=>{},async send=>{send();throw new Error('ACK_LOST')})).rejects.toMatchObject({status:409})
  expect(()=>ledger.confirmedDisplay(prior.receipt.id)).toThrow('inconclusivo')
  const unknown=ledger.list().find(command=>command.state==='UNCERTAIN')!
  ledger.review(unknown.id,unknown.reviewToken,'Incidente reconhecido; resultado físico não comprovado','admin',()=>{})
  const restored=new GraphicCommandLedger(database.db,'a')
  expect(restored.hasUnresolved()).toBe(false)
  expect(()=>restored.confirmedDisplay(prior.receipt.id)).toThrow('Incidente reconhecido')
  const before=sent.length,work=vi.fn()
  await expect(restored.execute({...input('restore-reviewed'),selection:{action:'COMPOSITION_RESTORE',sourceReceipt:prior.receipt.id}},()=>{restored.confirmedDisplay(prior.receipt.id)},work)).rejects.toThrow('Incidente reconhecido')
  expect(work).not.toHaveBeenCalled();expect(sent).toHaveLength(before)
  const fresh=await show('explicit-new-result','LOWER_THIRD','KNOWN NEW RESULT')
  expect(restored.confirmedDisplay(fresh.receipt.id).layers.LOWER_THIRD.svg).toContain('KNOWN NEW RESULT')
})
it('definitive native refusal after the snapshot does not create a reviewed uncertainty gap',async()=>{
  const prior=await show('before-refused','LOWER_THIRD','KNOWN')
  const {EngineCommandRejected}=await import('./engine.js')
  await expect(ledger.execute(input('refused-command'),()=>{},async send=>{send();throw new EngineCommandRejected('native refusal')})).rejects.toMatchObject({status:409})
  expect(ledger.confirmedDisplay(prior.receipt.id).layers.LOWER_THIRD.active).toBe(true)
})
it('latest legacy receipt without a composition never falls back to an older snapshot',async()=>{
  const prior=await show('known-display','LOWER_THIRD','KNOWN')
  const legacy=await ledger.execute(input('legacy-command'),()=>{},async send=>{send()})
  expect(()=>ledger.confirmedDisplay(prior.receipt.id)).toThrow('Composição mudou')
  expect(()=>ledger.confirmedDisplay(legacy.receipt.id)).toThrow()
})
it('snapshot reads are isolated and invalid layer ownership is refused before send',async()=>{
  const prior=await show('snapshot-copy','LOWER_THIRD','KEEP')
  const saved=ledger.confirmedDisplay(prior.receipt.id);saved.layers.LOWER_THIRD.active=false
  expect(ledger.confirmedDisplay(prior.receipt.id).layers.LOWER_THIRD.active).toBe(true)
  const wrong=ledger.confirmedDisplay(prior.receipt.id);wrong.owners.LOWER_THIRD={eventId:'wrong',version:999}
  expect(()=>new Graphics(channel,transport()).restoreDisplayConfirmed(wrong,()=>{},()=>{})).toThrow()
})
it('native emergency presentation survives without firing the scheduler',async()=>{
  const prior=await show('under-emergency','LOWER_THIRD','UNDERLAY')
  const saved=ledger.confirmedDisplay(prior.receipt.id);saved.emergencySvg='<svg>EMERGENCY</svg>'
  const restored=new Graphics(channel,transport()),manual=vi.spyOn(restored.scheduler,'triggerManual')
  await restored.restoreDisplayConfirmed(saved,()=>{},()=>{})
  expect(sent.at(-1)).toBe(saved.emergencySvg);expect(manual).not.toHaveBeenCalled()
})
it('composition head lookup uses the exact channel/kind index, not history sorting',()=>{
  const plan=database.sqlite.prepare("EXPLAIN QUERY PLAN SELECT id FROM operator_decisions INDEXED BY graphic_command_composition_order WHERE rundown_id=? AND kind='GRAPHIC_COMMAND_CONFIRMED' ORDER BY rowid DESC LIMIT 1").all('@graphics:a') as {detail:string}[]
  expect(plan.some(row=>row.detail.includes('graphic_command_composition_order'))).toBe(true)
  expect(plan.some(row=>row.detail.includes('TEMP B-TREE'))).toBe(false)
})
it('already confirmed legacy cue is consumed for the exact execution, not replayed after restore',async()=>{
  await ledger.execute({...input('old-legacy-cue'),selection:{action:'LEGACY_CUE',executionId:'execution',itemId:'live',revisionId:'rev',cue:{id:'old-cue'}}},()=>{},send=>graphics.triggerLayerConfirmed('LOWER_THIRD','SHOW',{payload:{title:'CUE'}},()=>{},send))
  await show('manual-after-cue','LOWER_THIRD','OPERATOR')
  expect([...ledger.confirmedCueIds('execution','live','rev')]).toEqual(['old-cue'])
  expect(ledger.confirmedCueIds('execution','live','changed').size).toBe(0)
  expect(ledger.confirmedCueIds('new-execution','live','rev').size).toBe(0)
})
it('deadline expiring inside native queue cannot briefly resurrect an old layer',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(1000)
  const prior=await show('queued-hold','LOWER_THIRD','EXPIRES',25),saved=ledger.confirmedDisplay(prior.receipt.id)
  const delayed={state:()=>({mode:'NATIVE'}),graphicConfirmed:async(_svg:string|null,_fade:number,authorize:()=>void)=>{vi.setSystemTime(2500);authorize()}} as unknown as Transport
  const before=sent.length,send=vi.fn()
  await expect(new Graphics(channel,delayed).restoreDisplayConfirmed(saved,()=>{},send)).rejects.toThrow('venceu durante a fila')
  expect(send).not.toHaveBeenCalled();expect(sent).toHaveLength(before)
})

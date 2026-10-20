import {afterEach,beforeEach,it,expect,vi} from 'vitest'
import {NativeLiveReplacementWire,nativeLiveReplacementReceiptSchema,type NativeLiveReplacementReceipt,type NativeLiveReplacementRequest,type NativeLiveReplacementWirePort} from './native-live-replacement.js'

const generation='00000000-0000-4000-8000-000000000001'
const request:NativeLiveReplacementRequest={transactionId:'tx-1',engineGeneration:generation,selectionRevision:'pair-17',itemId:'live',expectedDecoderId:7,
 expectedSourceId:'primary',targetSourceId:'backup',targetSource:'ndi:Estúdio Çãó',targetSourceType:'NDI'}
let wire:NativeLiveReplacementWire,port:NativeLiveReplacementWirePort,commands:Record<string,unknown>[],selected:boolean,sequence:number
beforeEach(()=>{
 commands=[];selected=false;sequence=0
 port={nextId:()=>++sequence,assertOwned:vi.fn(),validate:vi.fn(),write:vi.fn(message=>commands.push(message)),fence:()=>({ownerId:'owner',term:17}),fenceRequired:()=>true,
  beforeSend:vi.fn(),recordReceipt:vi.fn(),selectionObserved:()=>selected}
 wire=new NativeLiveReplacementWire(port)
 wire.ready({engineGeneration:generation,liveReplacementProtocol:1,decoderIdentity:true})
})
afterEach(()=>{wire.disconnected();vi.useRealTimers()})
function receipt(phase:NativeLiveReplacementReceipt['phase']='READY',change:Partial<NativeLiveReplacementReceipt>={}):NativeLiveReplacementReceipt{
 const {targetSource:_,targetSourceType:__,...binding}=request
 return {...binding,preparedDecoderId:8,phase,programFrames:phase==='COMMITTED'?143:null,...change}
}
function answer(value:NativeLiveReplacementReceipt,id=sequence,ok=true){wire.absorb({event:'liveReplacement',id,receipt:value,replayed:false});wire.absorb({event:'ack',id,ok})}
async function prepared(){const action=wire.prepare(request);answer(receipt());return action}

it('confirmed STOP releases a missing cut outcome without fabricating a COMMITTED receipt or resending it',async()=>{
 vi.useFakeTimers();await prepared()
 const cut=wire.commit(request.transactionId),failed=expect(cut).rejects.toMatchObject({outcomeUnknown:true})
 await vi.advanceTimersByTimeAsync(5001);await failed
 expect(wire.requiresStopResolution(request.transactionId)).toBe(true)
 wire.confirmStopped();expect(wire.health().selectionUncertain).toBe(false)
 const replay=wire.commit(request.transactionId);answer(receipt());await replay
 expect(commands.at(-1)?.cmd).toBe('liveReplacementStatus')
 const another={...request,transactionId:'after-stop'},prepare=wire.prepare(another)
 expect(commands.at(-1)?.cmd).toBe('prepareLiveReplacement')
 wire.absorb({event:'liveReplacement',id:sequence,receipt:{...receipt(),transactionId:another.transactionId}})
 wire.absorb({event:'ack',id:sequence,ok:true});await prepare
 expect(commands.filter(value=>value.cmd==='commitLiveReplacement')).toHaveLength(1)
})
it('authenticated recovery of one binding cannot clear a different unresolved cut',async()=>{
 vi.useFakeTimers();await prepared()
 const cut=wire.commit(request.transactionId),failed=expect(cut).rejects.toMatchObject({outcomeUnknown:true})
 await vi.advanceTimersByTimeAsync(5001);await failed
 const confirmed={...receipt('COMMITTED')}
 expect(wire.canRecoverBinding({...confirmed,transactionId:'older-cut'})).toBe(false)
 expect(wire.canRecoverBinding(confirmed)).toBe(true)
 wire.confirmRecovered({...confirmed,transactionId:'older-cut'});expect(wire.health().selectionUncertain).toBe(true)
 wire.confirmRecovered(confirmed);expect(wire.health().selectionUncertain).toBe(false)
 wire.selectionUncertain();expect(wire.canRecoverBinding(confirmed)).toBe(false)
})

it('has no LOAD/TAKE fallback for legacy or mismatched native capability',async()=>{
 wire.ready({});await expect(wire.prepare(request)).rejects.toThrow('sem contrato');expect(commands).toEqual([])
 wire.ready({engineGeneration:generation,liveReplacementProtocol:2,decoderIdentity:true})
 await expect(wire.prepare(request)).rejects.toThrow('sem contrato')
 wire.ready({engineGeneration:'00000000-0000-4000-8000-000000000002',liveReplacementProtocol:1,decoderIdentity:true})
 await expect(wire.prepare(request)).rejects.toThrow('sem contrato');expect(commands).toEqual([])
})
it('durable pre-send failure never writes private stdin',async()=>{
 vi.mocked(port.beforeSend).mockImplementation(()=>{throw new Error('SQL_REFUSED')})
 await expect(wire.prepare(request)).rejects.toThrow('SQL_REFUSED');expect(commands).toEqual([])
})
it('preparation persists a bound receipt but does not confirm or send a cut',async()=>{
 await expect(prepared()).resolves.toMatchObject({phase:'READY',programFrames:null})
 expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({cmd:'prepareLiveReplacement',request})
 expect(port.beforeSend).toHaveBeenCalledWith('PREPARE',request);expect(port.recordReceipt).toHaveBeenCalledWith(receipt())
 expect(commands.some(command=>command.cmd==='take'||command.cmd==='load')).toBe(false)
})
it('commit requires fresh native preparation and a current lease',async()=>{
 await expect(wire.commit('unknown')).rejects.toThrow('não pertence')
 await prepared();port.fence=()=>null
 await expect(wire.commit('tx-1')).rejects.toThrow('concessão');expect(commands).toHaveLength(1)
})
it('without an HA lease the private pipe is the authority: COMMIT carries no owner/term',async()=>{
 port.fenceRequired=()=>false;port.fence=()=>{throw new Error('MUST_NOT_CONSULT_FENCE')}
 await prepared();void wire.commit('tx-1').catch(()=>{})
 expect(commands[1]).toMatchObject({cmd:'commitLiveReplacement',preparedDecoderId:8})
 expect(commands[1]).not.toHaveProperty('ownerId');expect(commands[1]).not.toHaveProperty('term')
})
it('receipt, current selector state and ACK are required; durable commit intent comes first',async()=>{
 await prepared();const action=wire.commit('tx-1')
 expect(commands[1]).toMatchObject({cmd:'commitLiveReplacement',engineGeneration:generation,preparedDecoderId:8,ownerId:'owner',term:17})
 expect(port.beforeSend).toHaveBeenLastCalledWith('COMMIT',request)
 selected=true;answer(receipt('COMMITTED'));await expect(action).resolves.toMatchObject({phase:'COMMITTED',programFrames:143})
 expect(wire.health().selectionUncertain).toBe(false)
})
it('ACK without receipt is not success and a retry queries status without another COMMIT',async()=>{
 await prepared();const action=wire.commit('tx-1');const rejected=expect(action).rejects.toMatchObject({outcomeUnknown:true})
 wire.absorb({event:'ack',id:sequence,ok:true});await rejected
 expect(wire.health().selectionUncertain).toBe(true)
 const replay=wire.commit('tx-1');expect(commands.at(-1)?.cmd).toBe('liveReplacementStatus')
 selected=true;answer(receipt('COMMITTED'));await replay
 expect(commands.filter(command=>command.cmd==='commitLiveReplacement')).toHaveLength(1)
})
it('timeout of COMMIT preserves uncertainty; it never kills PGM or automatically resends',async()=>{
 vi.useFakeTimers();await prepared();const pending=wire.commit('tx-1');const failed=expect(pending).rejects.toMatchObject({outcomeUnknown:true})
 await vi.advanceTimersByTimeAsync(5001);await failed
 expect(commands.map(command=>command.cmd)).toEqual(['prepareLiveReplacement','commitLiveReplacement'])
 expect(wire.health().selectionUncertain).toBe(true)
 await expect(wire.prepare({...request,transactionId:'tx-2'})).rejects.toMatchObject({outcomeUnknown:true})
})
it.each(['engineGeneration','itemId','expectedDecoderId','expectedSourceId','targetSourceId','selectionRevision','preparedDecoderId'] as const)('rejects a receipt with mismatched %s',async field=>{
 vi.useFakeTimers();await prepared();const pending=wire.commit('tx-1');const failed=expect(pending).rejects.toMatchObject({outcomeUnknown:true})
 const value=receipt('COMMITTED');(value as unknown as Record<string,unknown>)[field]=typeof value[field]==='number'?99:'different'
 answer(value);await failed;expect(wire.health().selectionUncertain).toBe(true)
})
it('committed receipt with missing native state is historical evidence, not current output proof',async()=>{
 await prepared();const pending=wire.commit('tx-1');answer(receipt('COMMITTED'))
 await expect(pending).rejects.toMatchObject({outcomeUnknown:true});expect(wire.health().selectionUncertain).toBe(true)
 const read=wire.status('tx-1');answer(receipt('COMMITTED'));await read
 expect(wire.health().selectionUncertain).toBe(true)
})
it('receipt persistence failure does not satisfy caller or resend physical action',async()=>{
 await prepared();const commit=wire.commit('tx-1');const failed=expect(commit).rejects.toMatchObject({outcomeUnknown:true})
 vi.mocked(port.recordReceipt).mockImplementation(()=>{throw new Error('SQL_RECEIPT_FAILED')})
 selected=true;answer(receipt('COMMITTED'));await failed
 vi.mocked(port.recordReceipt).mockReset();const lookup=wire.status('tx-1');answer(receipt('COMMITTED'));await lookup
 expect(commands.filter(command=>command.cmd==='commitLiveReplacement')).toHaveLength(1)
 expect(wire.health().selectionUncertain).toBe(false)
})
it('repeated PREPARE requests the existing journal, not a decoder open',async()=>{
 await prepared();const lookup=wire.prepare({...request});expect(commands.at(-1)?.cmd).toBe('liveReplacementStatus');answer(receipt());await lookup
 expect(commands.filter(command=>command.cmd==='prepareLiveReplacement')).toHaveLength(1)
 await expect(wire.prepare({...request,targetSource:'ndi:OUTRA'})).rejects.toThrow('outra seleção')
})
it('request property ordering does not manufacture a different transaction',async()=>{
 await prepared();const reordered=Object.fromEntries(Object.entries(request).reverse()) as unknown as NativeLiveReplacementRequest
 const lookup=wire.prepare(reordered);expect(commands.at(-1)?.cmd).toBe('liveReplacementStatus');answer(receipt());await lookup
 expect(commands.filter(command=>command.cmd==='prepareLiveReplacement')).toHaveLength(1)
})
it('a ready alternative still occupies preparation; another key cannot open a competing candidate',async()=>{
 await prepared();await expect(wire.prepare({...request,transactionId:'tx-other'})).rejects.toThrow('alternativa em preparação')
 expect(commands).toHaveLength(1)
})
it('invalid executable input is refused before the durable callback and before stdin',async()=>{
 await expect(wire.prepare({...request,targetSource:'file:///PRIVATE.mkv'})).rejects.toThrow('alternativa inválida')
 await expect(wire.prepare({...request,targetSource:'ndi:'+ 'x'.repeat(8192)})).rejects.toThrow()
 expect(port.beforeSend).not.toHaveBeenCalled();expect(commands).toEqual([])
})
it('READY can be withdrawn and terminal results cannot be overwritten by late events',async()=>{
 await prepared();wire.absorb({event:'liveReplacement',id:null,receipt:receipt('PREPARING')})
 await expect(wire.commit('tx-1')).rejects.toThrow('prontidão')
 const cancellation=wire.cancel('tx-1');answer(receipt('CANCELLED'));await cancellation
 const before=vi.mocked(port.recordReceipt).mock.calls.length
 wire.absorb({event:'liveReplacement',id:null,receipt:receipt('READY')})
 expect(port.recordReceipt).toHaveBeenCalledTimes(before)
 const read=wire.commit('tx-1');expect(commands.at(-1)?.cmd).toBe('liveReplacementStatus');answer(receipt('CANCELLED'));await read
})
it('process loss cannot carry its command or generation into a new process',async()=>{
 await prepared();const pending=wire.commit('tx-1');const failed=expect(pending).rejects.toMatchObject({outcomeUnknown:true})
 wire.disconnected();await failed
 wire.ready({engineGeneration:'00000000-0000-4000-8000-000000000002',liveReplacementProtocol:1,decoderIdentity:true})
 await expect(wire.status('tx-1')).rejects.toThrow('sem contrato')
 expect(wire.health().selectionUncertain).toBe(true)
})
it('schemas reject a success without cursor, wrong phase/cursor and unexpected secret-bearing fields',()=>{
 expect(nativeLiveReplacementReceiptSchema.safeParse(receipt('COMMITTED',{programFrames:null})).success).toBe(false)
 expect(nativeLiveReplacementReceiptSchema.safeParse(receipt('FAILED',{programFrames:1})).success).toBe(false)
 expect(nativeLiveReplacementReceiptSchema.safeParse({...receipt(),targetSource:'srt://SECRET'}).success).toBe(false)
 expect(nativeLiveReplacementReceiptSchema.safeParse(receipt('READY',{preparedDecoderId:7})).success).toBe(false)
})

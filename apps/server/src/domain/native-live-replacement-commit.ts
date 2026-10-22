import type {Db} from '../db/client.js'
import {Checkpoints,stoppedCheckpoint,type ChannelCheckpoint} from './checkpoints.js'
import {createLiveProgramBinding,resolveLiveProgramBinding,type LiveProgramBinding} from './live-program-binding.js'
import type {NativeLiveReplacementLedger,NativeLiveReplacementContext} from './native-live-replacement-ledger.js'
import {assertPersistedLiveReplacementReceipt} from './native-live-replacement-ledger.js'
import {nativeLiveReplacementReceiptSchema,type NativeLiveReplacementRequest,type NativeLiveReplacementReceipt} from './native-live-replacement.js'
import type {NativeReplacementStopProof} from './engine.js'

/** Same SQLite connection/transaction as Checkpoints and the ledger. No await,
 * engine command or in-memory PGM mutation may run inside this callback. */
export function commitNativeReplacementReceipt(db:Db,checkpoints:Checkpoints,ledger:NativeLiveReplacementLedger,
 context:NativeLiveReplacementContext,request:NativeLiveReplacementRequest,value:NativeLiveReplacementReceipt,
 currentProgramContext:boolean,capture:()=>ChannelCheckpoint):LiveProgramBinding|undefined{
 checkpoints.assertConnection(db.$client);ledger.assertConnection(db)
 const receipt=nativeLiveReplacementReceiptSchema.parse(value)
 return db.transaction(()=>{
  ledger.recordReceipt(receipt)
  if(receipt.phase!=='COMMITTED'||!currentProgramContext)return undefined
  const current=capture()
  const existing=checkpoints.read(context.channelId)
  const reusable=existing?.liveProgramBinding?.receipt.transactionId===receipt.transactionId&&existing.executionId===context.executionId
   &&JSON.stringify(existing.liveProgramBinding.receipt)===JSON.stringify(receipt)
  const binding=reusable?existing!.liveProgramBinding!:createLiveProgramBinding(context,request,receipt)
  const checkpoint:ChannelCheckpoint={...current,version:2,liveProgramBinding:binding,elapsed:Math.max(current.elapsed,receipt.programFrames!)}
  // Authenticated scope check precedes any update, also for an incorrect
  // capture that could otherwise overwrite a different occurrence's cursor.
  const selected=resolveLiveProgramBinding(binding,checkpoint)
  if(selected.source!==request.targetSource||selected.sourceType!==request.targetSourceType||selected.configuredSourceId!==request.targetSourceId)throw new Error('Vínculo persistido diverge da conexão preparada.')
  assertPersistedLiveReplacementReceipt(db,binding)
  if(reusable){resolveLiveProgramBinding(binding,existing!);return binding}
  checkpoints.write(checkpoint)
  return binding
 },{behavior:'immediate'})
}

/** Called only with the owning transport's STOP ACK + empty state proof.
 * A failed checkpoint/audit write rolls back resolution, not physical STOP. */
export function commitNativeReplacementStop(db:Db,checkpoints:Checkpoints,ledger:NativeLiveReplacementLedger,
 transactionId:string,channelId:string,proof:NativeReplacementStopProof):void{
 checkpoints.assertConnection(db.$client);ledger.assertConnection(db)
 db.transaction(()=>{
  ledger.confirmStopped(transactionId,proof,channelId)
  const saved=checkpoints.read(channelId)
  if(saved)checkpoints.write(stoppedCheckpoint(saved))
 },{behavior:'immediate'})
}

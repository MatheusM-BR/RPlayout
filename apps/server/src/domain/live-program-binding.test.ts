import {beforeEach,afterEach,it,expect} from 'vitest'
import {z} from 'zod'
import {eq} from 'drizzle-orm'
import {openDatabase} from '../db/client.js'
import {channels,liveSources,operatorDecisions} from '../db/schema.js'
import {NativeLiveReplacementLedger,nativeSourceConnectionSignature,assertPersistedLiveReplacementReceipt,type NativeLiveReplacementContext} from './native-live-replacement-ledger.js'
import {createLiveProgramBinding,resolveLiveProgramBinding,type LiveProgramBinding} from './live-program-binding.js'
import {Checkpoints,parseChannelCheckpoint,stoppedCheckpoint,type ChannelCheckpoint} from './checkpoints.js'
import {assertRollbackCheckpointData,currentRollbackContract,qualifiedHistoricalRollbackContract,rollbackContractSchema} from './rollback-contract.js'
import {stoppedHaCheckpoint} from './ha-recovery-cursor.js'
import type {NativeLiveReplacementRequest,NativeLiveReplacementReceipt} from './native-live-replacement.js'

let database:ReturnType<typeof openDatabase>,binding:LiveProgramBinding,context:NativeLiveReplacementContext,request:NativeLiveReplacementRequest,nativeReceipt:NativeLiveReplacementReceipt,cursor:ChannelCheckpoint
const primary='ndi:Estúdio Primário',target='srt://user:SECRET_PASSWORD@backup.invalid:9000?passphrase=SECRET_PASSPHRASE'
beforeEach(()=>{
 database=openDatabase(':memory:')
 database.db.insert(channels).values({id:'ch',name:'QA',width:320,height:180,rateNum:25,rateDen:1,targetLufs:-23,ceilingDbtp:-1,limiterLookaheadMs:5,createdAt:new Date().toISOString()}).run()
 for(const [id,kind,role,url]of[['primary','NDI','PRIMARY',primary],['backup','SRT','BACKUP',target]] as const)database.db.insert(liveSources).values({id,channelId:'ch',name:id,kind,role,targetUrl:url,pairedSourceId:id==='primary'?'backup':'primary',enabled:true,createdAt:new Date().toISOString()}).run()
 context={channelId:'ch',rundownId:'r',revisionId:'rev',executionId:'exec',occurrenceId:'exec',itemId:'live',ownerRunId:'00000000-0000-4000-8000-000000000010',engineGeneration:'00000000-0000-4000-8000-000000000020',decoderId:7,sourceId:'primary',sourceConnectionSignature:nativeSourceConnectionSignature('primary','NDI',primary),policySignature:'a'.repeat(64)}
 const ledger=new NativeLiveReplacementLedger(database.db,'actor','operator',{authorize:()=>{},assertOwner:()=>{},current:()=>context})
 const intent=ledger.begin('binding-fixture','backup',context);request=ledger.request(intent.transactionId)
 const {targetSource:_,targetSourceType:__,...base}=request
 ledger.beforeSend('PREPARE',request);ledger.recordReceipt({...base,preparedDecoderId:8,phase:'READY',programFrames:null})
 ledger.beforeSend('COMMIT',request);nativeReceipt={...base,preparedDecoderId:8,phase:'COMMITTED',programFrames:143};ledger.recordReceipt(nativeReceipt)
 binding=createLiveProgramBinding(context,request,nativeReceipt)
 cursor={version:2,channelId:'ch',rundownId:'r',revisionId:'rev',executionId:'exec',itemId:'live',elapsed:200,playing:true,realEngine:true,liveProgramBinding:binding}
})
afterEach(()=>database.sqlite.close())

it('persists only a sealed source and a historical native proof, keeping the saved occurrence cursor',()=>{
 const checkpoints=new Checkpoints(database.sqlite);checkpoints.write(cursor)
 const saved=checkpoints.read('ch')!,raw=JSON.stringify(database.sqlite.prepare('SELECT payload FROM channel_checkpoints').get())
 expect(saved).toEqual(cursor);expect(raw).not.toContain('srt://');expect(raw).not.toContain('SECRET_')
 expect(resolveLiveProgramBinding(saved.liveProgramBinding,saved)).toEqual({source:target,configuredSourceId:'backup',sourceType:'SRT'})
 expect(saved.elapsed).toBe(200);expect(saved.liveProgramBinding?.receipt.programFrames).toBe(143)
 assertPersistedLiveReplacementReceipt(database.db,binding)
})
it('randomizes envelopes without changing the actual immutable connection',()=>{
 const other=createLiveProgramBinding(context,request,nativeReceipt)
 expect(other.sealedSource).not.toBe(binding.sealedSource)
 expect(resolveLiveProgramBinding(other,cursor)).toEqual(resolveLiveProgramBinding(binding,cursor))
})
it('uses the confirmed immutable endpoint even if the catalog address changes later',()=>{
 database.db.update(liveSources).set({targetUrl:'srt://OTHER_CREDENTIALS@changed.invalid:9000'}).where(eq(liveSources.id,'backup')).run()
 expect(resolveLiveProgramBinding(binding,cursor).source).toBe(target)
 assertPersistedLiveReplacementReceipt(database.db,binding)
})
it.each(['channelId','rundownId','revisionId','executionId','itemId'] as const)('refuses a checkpoint for a different %s without defaulting to the editorial source',field=>{
 expect(()=>resolveLiveProgramBinding(binding,{...cursor,[field]:'different'})).toThrow('não será selecionada por fallback')
})
it.each(['transaction','generation','decoder','frame','source','occurrence','ciphertext'] as const)('authenticates %s metadata with the sealed source',field=>{
 const changed=structuredClone(binding)
 if(field==='transaction')changed.receipt.transactionId='different-transaction'
 if(field==='generation')changed.receipt.engineGeneration='00000000-0000-4000-8000-000000000099'
 if(field==='decoder')changed.receipt.preparedDecoderId=99
 if(field==='frame')changed.receipt.programFrames=144
 if(field==='source')changed.receipt.targetSourceId='different-source'
 if(field==='occurrence')changed.context.occurrenceId='different-occurrence'
 if(field==='ciphertext')changed.sealedSource=changed.sealedSource.slice(0,-8)+'AAAAAAAA'
 expect(()=>resolveLiveProgramBinding(changed,cursor)).toThrow('Vínculo protegido')
 try{resolveLiveProgramBinding(changed,cursor)}catch(error){expect(String(error)).not.toContain('SECRET_');expect(String(error)).not.toContain('srt://')}
})
it('refuses missing receipt history, without inventing a committed transition from encrypted endpoint alone',()=>{
 database.db.delete(operatorDecisions).run()
 expect(()=>assertPersistedLiveReplacementReceipt(database.db,binding)).toThrow('sem recibo durável')
})
it('rejects journal metadata inconsistent with its committed receipt instead of treating existence as proof',()=>{
 const row=database.db.select().from(operatorDecisions).all()[0]!
 database.db.update(operatorDecisions).set({payload:{...row.payload,selectionRevision:'b'.repeat(43)}}).where(eq(operatorDecisions.id,row.id)).run()
 expect(()=>assertPersistedLiveReplacementReceipt(database.db,binding)).toThrow('sem recibo durável')
})
it('only COMMITTED matching the source selection may create a binding',()=>{
 expect(()=>createLiveProgramBinding(context,request,{...nativeReceipt,phase:'READY',programFrames:null})).toThrow()
 expect(()=>createLiveProgramBinding(context,{...request,targetSourceId:'other'},nativeReceipt)).toThrow('não corresponde')
})
it('version2 cannot be written without its binding; version1 cannot silently carry/discard it',()=>{
 expect(()=>parseChannelCheckpoint({...cursor,liveProgramBinding:undefined})).toThrow()
 expect(()=>parseChannelCheckpoint({...cursor,version:1})).toThrow()
 expect(()=>parseChannelCheckpoint({...cursor,elapsed:142})).toThrow()
 expect(()=>parseChannelCheckpoint({...cursor,programTrim:{in:0,out:500,contentHash:'a'.repeat(64)}})).toThrow()
 expect(()=>parseChannelCheckpoint({...cursor,playing:false})).toThrow()
})
it('periodic version1 writing cannot replace the selected leg of the same occurrence',()=>{
 const checkpoints=new Checkpoints(database.sqlite);checkpoints.write(cursor)
 expect(()=>checkpoints.write({...cursor,version:1,liveProgramBinding:undefined})).toThrow('não pode descartar')
 expect(checkpoints.read('ch')?.liveProgramBinding).toEqual(binding)
 const stopped=stoppedCheckpoint(cursor);checkpoints.write(stopped)
 expect(checkpoints.read('ch')).toMatchObject({version:1,playing:false,itemId:null,elapsed:0})
 expect(checkpoints.read('ch')?.liveProgramBinding).toBeUndefined()
})
it('legacy rollback contracts accept only version1; current contract explicitly declares version2',()=>{
 const checkpoints=new Checkpoints(database.sqlite);checkpoints.write(cursor)
 const current=currentRollbackContract(),{channelCheckpointVersions:_,...legacy}=current
 expect(rollbackContractSchema.parse(legacy).channelCheckpointVersions).toEqual([1])
 expect(()=>assertRollbackCheckpointData(database.sqlite,legacy)).toThrow('não aceita o formato')
 expect(qualifiedHistoricalRollbackContract('6897c8e308cf40893804b9313a10255f75271c5028ead63ff6c6e1d66d2e981c').channelCheckpointVersions).toEqual([1])
 expect(assertRollbackCheckpointData(database.sqlite,current)).toEqual({checkpointCount:1,versionsUsed:[2]})
 expect(()=>z.object({version:z.literal(1)}).parse(cursor)).toThrow()
 expect(checkpoints.read('ch')).toEqual(cursor)
})
it('a supported version number does not qualify structurally corrupted checkpoint data',()=>{
 database.sqlite.prepare('INSERT INTO channel_checkpoints (channel_id,payload,saved_at) VALUES (?,?,?)').run('ch',JSON.stringify({version:2,liveProgramBinding:true}),'now')
 expect(()=>assertRollbackCheckpointData(database.sqlite,currentRollbackContract())).toThrow('Checkpoint inválido')
})
it('HA v3 does not remap a foreign alternative binding onto its primary editorial source',()=>{
 expect(()=>stoppedHaCheckpoint(cursor,'ch',new Map([['rev','local-rev']]))).toThrow('grupo8 reservado à v3')
})

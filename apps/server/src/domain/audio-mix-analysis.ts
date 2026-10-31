import {and,asc,eq} from 'drizzle-orm'
import {randomUUID} from 'node:crypto'
import {spawn,type ChildProcess} from 'node:child_process'
import {constants,setPriority,hostname} from 'node:os'
import {audioRoutingKey,validateAudioRouting,hasMatchingAudioMeasurement,audioCutIdentity,sameAudioCut,type AudioCutIdentity,type AudioRouting,type LoudnessMeasurement} from '@rplayout/protocol'
import {toAsset} from '../db/repo.js'
import type {Db} from '../db/client.js'
import {channels,mediaAssets,operatorDecisions,rundownItems,rundowns} from '../db/schema.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {mediaProcessEnvironment} from './media-process-environment.js'
import {isRecoveryRehearsal} from './recovery-rehearsal.js'
import {declaredFileTrim} from './execution-trim.js'
const KIND='AUDIO_MIX_ANALYSIS'
export interface MixJob {id:string;itemId:string;rundownId:string;channelId:string;assetId:string;contentHash:string;audioTrack:number;routing:AudioRouting;trim?:{inNs:number;outNs:number};state:'PENDING'|'RUNNING'|'READY'|'FAILED';measurement:LoudnessMeasurement|null;error:string|null;createdAt:string;updatedAt:string;worker?:{host:string;pid:number;boot:string}}
export interface MixReading {ok:boolean;integratedLufs?:number;lra?:number;truePeakDbtp?:number;sampleFrames?:number;rate?:number;channels?:number;reason?:string;trim?:{inNs:number;outNs:number}|null}
type ResolveOriginal=(assetId:string,hash:string,path:string)=>Promise<string|null>
type Runner=(path:string,audioTrack:number,routing:AudioRouting,trim?:{inNs:number;outNs:number})=>Promise<MixReading>
function reject(message:string,status=409):never{throw new CollaborativeEditError(status,{error:'AUDIO_ANALYSIS_INVALID',message})}
export function currentAudioCut(db:Pick<Db,'select'>,itemId:string):AudioCutIdentity {
  const row=db.select({item:rundownItems,asset:mediaAssets,channel:channels}).from(rundownItems).innerJoin(rundowns,eq(rundowns.id,rundownItems.rundownId)).innerJoin(channels,eq(channels.id,rundowns.channelId)).innerJoin(mediaAssets,eq(mediaAssets.id,rundownItems.mediaId)).where(eq(rundownItems.id,itemId)).get()
  if(!row)reject('Item sem corte de arquivo comprovado.')
  const rate={num:row!.channel.rateNum,den:row!.channel.rateDen}
  return audioCutIdentity(declaredFileTrim(row!.item,toAsset(row!.asset),rate),rate)
}
export function requireMixMeasurement(db:Pick<Db,'select'>,id:string,contentHash:string,audioTrack:number,routing:AudioRouting,cut?:AudioCutIdentity|(()=>AudioCutIdentity)):LoudnessMeasurement {
  const row=db.select().from(operatorDecisions).where(and(eq(operatorDecisions.id,id),eq(operatorDecisions.kind,KIND))).get()
  const job=row?.payload as unknown as MixJob|undefined
  if(!job || job.state!=='READY' || !job.measurement || job.contentHash!==contentHash || job.audioTrack!==audioTrack || audioRoutingKey(job.routing)!==audioRoutingKey(routing))reject('A medição não corresponde à versão, trilha e mix escolhidos. Meça novamente antes de usar AUTO.')
  const measured=job.measurement
  const expectedCut=typeof cut==='function'?(job.trim?cut():undefined):cut
  if((job.trim?measured.scope!=='TRIM':measured.scope!=='FILE')||(measured.scope==='TRIM'&&!sameAudioCut(job.trim,expectedCut))||![measured.integratedLufs,measured.truePeakDbtp,measured.lra].every(Number.isFinite)||measured.lra<0||!Number.isFinite(Date.parse(measured.measuredAt))||!hasMatchingAudioMeasurement({mode:'AUTO',gainDb:0,measured,analysisId:id,routing},contentHash,audioTrack,expectedCut))reject('A medição salva está incompleta ou perdeu o vínculo com a versão, trilha, mix ou corte. Meça novamente; AUTO não foi aplicado.')
  return job.measurement
}
/** Pure analysis jobs are durable; a second worker cannot steal a RUNNING
 * claim. Interrupted work is shown as FAILED, not guessed complete/replayed. */
export class AudioMixAnalysis {
  private running=false;private closed=false;private child:ChildProcess|null=null;private ownedId:string|null=null
  private readonly owner={host:hostname(),pid:process.pid,boot:randomUUID()}
  constructor(private readonly db:Db,private readonly binary:string,private readonly original:ResolveOriginal,private readonly runner:Runner=this.native.bind(this)){
    db.transaction(tx=>{
      if(isRecoveryRehearsal(db.$client))return
      for(const row of tx.select().from(operatorDecisions).where(eq(operatorDecisions.kind,KIND)).all()){
        const job=row.payload as unknown as MixJob
        if(job.state!=='RUNNING'||job.worker?.host!==hostname())continue
        try{process.kill(job.worker.pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){job.state='FAILED';job.error='Medição interrompida pelo encerramento do servidor. Meça novamente; nenhum resultado foi presumido.';job.updatedAt=new Date().toISOString();this.save(job)}}
      }
    },{behavior:'immediate'})
  }
  private context(itemId:string){
    return this.db.select({itemId:rundownItems.id,rundownId:rundowns.id,channelId:channels.id,archivedAt:channels.archivedAt,assetId:mediaAssets.id,path:mediaAssets.path,hash:mediaAssets.contentHash,kind:mediaAssets.kind,probeError:mediaAssets.probeError,hasAudio:mediaAssets.hasAudio,audioChannels:mediaAssets.audioChannels,audioTracks:mediaAssets.audioTracks,itemTrim:rundownItems.trim,durationOverride:rundownItems.durationOverride,defaultTrim:mediaAssets.defaultTrim,defaultTrimRateNum:mediaAssets.defaultTrimRateNum,defaultTrimRateDen:mediaAssets.defaultTrimRateDen,durationFrames:mediaAssets.durationFrames,durationNs:mediaAssets.durationNs,rateNum:channels.rateNum,rateDen:channels.rateDen}).from(rundownItems).innerJoin(rundowns,eq(rundowns.id,rundownItems.rundownId)).innerJoin(channels,eq(channels.id,rundowns.channelId)).innerJoin(mediaAssets,eq(mediaAssets.id,rundownItems.mediaId)).where(eq(rundownItems.id,itemId)).get()
  }
  private cut(source:NonNullable<ReturnType<AudioMixAnalysis['context']>>){
    const rate={num:source.rateNum,den:source.rateDen},asset={...source,defaultTrimRate:source.defaultTrimRateNum&&source.defaultTrimRateDen?{num:source.defaultTrimRateNum,den:source.defaultTrimRateDen}:null} as unknown as import('@rplayout/protocol').MediaAsset
    const trim=declaredFileTrim({trim:source.itemTrim,durationOverride:source.durationOverride},asset,rate)
    const inNs=Math.round(trim.in*rate.den*1e9/rate.num),outNs=Math.round(trim.out*rate.den*1e9/rate.num)
    if(!Number.isSafeInteger(inNs)||!Number.isSafeInteger(outNs)||inNs<0||outNs-inNs<400_000_000)reject('Corte inválido ou menor que 400 ms; nenhum resultado foi presumido.')
    return {inNs,outNs}
  }
  read(itemId:string,id:string):MixJob|null {
    const row=this.db.select().from(operatorDecisions).where(and(eq(operatorDecisions.id,id),eq(operatorDecisions.kind,KIND))).get()
    const job=row?.payload as unknown as MixJob|undefined
    return job?.itemId===itemId?job:null
  }
  queue(itemId:string,hash:string,audioTrack:number,routing:AudioRouting,actor:string|null,authorize:()=>void,scope:'FILE'|'TRIM'='FILE'):MixJob {
    if(isRecoveryRehearsal(this.db.$client))reject('Cópia restaurada em conferência; medição não será iniciada.')
    if(!this.binary)reject('Medidor de mix indisponível no pacote. Instale a build completa com rplayout-audio-analysis.',503)
    const job=this.db.transaction(tx=>{
      authorize();const source=this.context(itemId)
      if(!source || source.archivedAt || source.kind!=='VIDEO' || source.probeError || source.hash!==hash)reject('A versão do arquivo ou o canal mudou; atualize a seleção. Entrada live não tem medição de arquivo.')
      if(!Number.isInteger(audioTrack)||audioTrack<0||audioTrack>63)reject('Trilha inválida.',400)
      const known=source.hasAudio===false?0:source.audioTracks?.find(t=>t.index===audioTrack)?.channels ?? (audioTrack===0?source.audioChannels??undefined:source.audioTracks?.length?0:undefined)
      if(known===0)reject('Trilha escolhida ausente ou arquivo sem áudio. Nenhuma medição foi iniciada.')
      const invalid=validateAudioRouting(routing,known);if(invalid)reject(invalid)
      const trim=scope==='TRIM'?this.cut(source!):undefined
      const rows=tx.select().from(operatorDecisions).where(and(eq(operatorDecisions.itemId,itemId),eq(operatorDecisions.kind,KIND))).orderBy(asc(operatorDecisions.createdAt)).all()
      const existing=rows.map(row=>row.payload as unknown as MixJob).find(job=>['PENDING','RUNNING','READY'].includes(job.state)&&job.assetId===source.assetId&&job.contentHash===hash&&job.audioTrack===audioTrack&&audioRoutingKey(job.routing)===audioRoutingKey(routing)&&JSON.stringify(job.trim)===JSON.stringify(trim))
      if(existing)return existing
      if(rows.filter(row=>['PENDING','RUNNING'].includes(String(row.payload.state))).length>=4)reject('Há análises em andamento para este item. Aguarde a conclusão antes de pedir outro mix.')
      const backlog=tx.select().from(operatorDecisions).where(eq(operatorDecisions.kind,KIND)).all().filter(row=>['PENDING','RUNNING'].includes(String(row.payload.state))).length
      if(backlog>=64)reject('Fila de medição cheia. Aguarde os trabalhos atuais; a transmissão não será interrompida.',429)
      const now=new Date().toISOString(),job:MixJob={id:randomUUID(),itemId,rundownId:source.rundownId,channelId:source.channelId,assetId:source.assetId,contentHash:hash,audioTrack,routing,...(trim?{trim}:{}),state:'PENDING',measurement:null,error:null,createdAt:now,updatedAt:now}
      tx.insert(operatorDecisions).values({id:job.id,itemId,rundownId:source.rundownId,kind:KIND,payload:job as unknown as Record<string,unknown>,actorUsername:actor,createdAt:now}).run();return job
    },{behavior:'immediate'})
    void this.tick().catch(()=>{});return job // Pending claim can be retried by the server worker timer.
  }
  private save(job:MixJob){this.db.update(operatorDecisions).set({payload:job as unknown as Record<string,unknown>}).where(eq(operatorDecisions.id,job.id)).run()}
  async tick():Promise<void>{
    if(this.running||this.closed||isRecoveryRehearsal(this.db.$client))return;this.running=true
    try{while(!this.closed){
      const job=this.db.transaction(tx=>{
        if(isRecoveryRehearsal(this.db.$client))return null
        const rows=tx.select().from(operatorDecisions).where(eq(operatorDecisions.kind,KIND)).orderBy(asc(operatorDecisions.createdAt)).all()
        const job=rows.map(row=>row.payload as unknown as MixJob).find(row=>row.state==='PENDING');if(!job)return null
        job.state='RUNNING';job.worker=this.owner;job.updatedAt=new Date().toISOString();this.save(job);this.ownedId=job.id;return job
      },{behavior:'immediate'});if(!job)break
      try{
        const source=this.context(job.itemId)
        if(!source || source.archivedAt || source.assetId!==job.assetId || source.hash!==job.contentHash)reject('Arquivo/canal alterado antes da análise.')
        if(job.trim&&JSON.stringify(this.cut(source!))!==JSON.stringify(job.trim))reject('Corte alterado antes da análise; solicite nova medição.')
        const path=await this.original(job.assetId,job.contentHash,source.path);if(!path)reject('O conteúdo real não corresponde à versão selecionada. Reescaneie o arquivo.')
        if(this.closed)break
        const reading=await this.runner(path,job.audioTrack,job.routing,job.trim)
        if(this.closed)break
        if(job.trim&&(JSON.stringify(this.cut(this.context(job.itemId)!))!==JSON.stringify(job.trim)||JSON.stringify(reading.trim)!==JSON.stringify(job.trim)||Math.abs((reading.sampleFrames??0)-Math.floor((job.trim.outNs-job.trim.inNs)*48000/1e9))>1))reject('Corte mudou ou o medidor não comprovou o trecho; resultado descartado.')
        const fresh=this.context(job.itemId)
        if(!fresh || fresh.archivedAt || fresh.assetId!==job.assetId || fresh.hash!==job.contentHash || !(await this.original(job.assetId,job.contentHash,source.path)))reject('A versão mudou durante a análise; resultado descartado.')
        if(this.closed)break
        if(!reading.ok || reading.rate!==48000 || reading.channels!==2 || !Number.isSafeInteger(reading.sampleFrames) || reading.sampleFrames!<19200 || [reading.integratedLufs,reading.lra,reading.truePeakDbtp].some(v=>typeof v!=='number'||!Number.isFinite(v)) || reading.lra!<0)reject('A trilha/mix não produziu uma medição completa e válida. Confira áudio, formato e canais.')
        const now=new Date().toISOString();job.measurement={integratedLufs:reading.integratedLufs!,lra:reading.lra!,truePeakDbtp:reading.truePeakDbtp!,scope:job.trim?'TRIM':'FILE',measuredAt:now,input:{contentHash:job.contentHash,audioTrack:job.audioTrack,routing:job.routing,...(job.trim?{trim:job.trim}:{})}};job.state='READY';job.error=null;job.updatedAt=now;this.save(job)
      }catch(error){if(!this.closed){job.state='FAILED';job.error=error instanceof CollaborativeEditError?error.message:'Não foi possível concluir a medição. Confira o runtime, arquivo e trilha.';job.updatedAt=new Date().toISOString();this.save(job)}}
    }}finally{this.running=false;this.ownedId=null}
  }
  private native(path:string,audioTrack:number,routing:AudioRouting,trim?:{inNs:number;outNs:number}):Promise<MixReading>{
    return new Promise((resolve,reject)=>{
      const child=spawn(this.binary,[path,JSON.stringify({audioTrack,routing,...(trim?{trim}:{})}),'--parent-pipe'],{windowsHide:true,env:mediaProcessEnvironment()});this.child=child
      try{if(child.pid)setPriority(child.pid,constants.priority.PRIORITY_LOW)}catch{}
      let output='',overflow=false;const timer=setTimeout(()=>child.kill(),16*60_000)
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>65536){overflow=true;child.kill()}});child.stderr.resume()
      child.once('error',reject);child.once('close',code=>{clearTimeout(timer);this.child=null;if(code!==0||overflow){reject(new Error('Medidor não concluiu'));return}try{resolve(JSON.parse(output))}catch{reject(new Error('Resposta inválida do medidor'))}})
    })
  }
  close(){this.closed=true;this.child?.kill();if(!this.ownedId)return
    const row=this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,this.ownedId)).get();const job=row?.payload as unknown as MixJob|undefined
    if(job?.state==='RUNNING'&&job.worker?.boot===this.owner.boot){job.state='FAILED';job.error='Servidor encerrou durante a medição. Meça novamente.';job.updatedAt=new Date().toISOString();this.save(job)}
  }
}

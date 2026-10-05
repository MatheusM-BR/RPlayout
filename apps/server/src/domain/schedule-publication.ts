import {and,asc,desc,eq} from 'drizzle-orm'
import {randomUUID,timingSafeEqual} from 'node:crypto'
import {hostname,constants,setPriority} from 'node:os'
import {spawn,type ChildProcess} from 'node:child_process'
import {statSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {resolveTrim,resolveAudio,type MediaAsset} from '@rplayout/protocol'
import type {Db} from '../db/client.js'
import {channels,mediaAssets,operatorDecisions,operationalPlaylistRevisions,rundownItems,rundowns,scheduleRules} from '../db/schema.js'
import {toAsset,toChannel} from '../db/repo.js'
import {applyQcDecisionsNow} from './qc-workflow.js'
import {buildCandidatesNow} from './autofill.js'
import {boundaryAuthority,type BoundaryOwner} from './playlist-boundary.js'
import {installationVault} from './secret-vault.js'
import {CollaborativeEditError} from './collaborative-edit.js'
import {mediaFileIdentity,isMediaSha,FileVersionVerifier} from './file-version.js'
import {localDate,rundownMidnight} from './rundown-clock.js'
import {dayRules,type DayPlan,type DayPlanRequest} from './schedule-day.js'
import {publishOperationalPlaylistNow,readOperationalPayload} from './operational-playlist.js'

const POLICY='SCHEDULE_PUBLICATION_POLICY',JOB='SCHEDULE_PUBLICATION_JOB'
const policyKey=(channelId:string)=>`schedule-publication:${channelId}`
const gradeKey=(channelId:string,date:string)=>`schedule-day:${channelId}:${date}`
interface Policy {channelId:string;version:number;state:'ENABLED'|'DISABLED'|'SUSPENDED';mode:'OWNED_EMPTY_DAYS';daysAhead:number;maxItems:number;owner:BoundaryOwner;contract:string;anchorId:string;message:string;updatedAt:string}
interface Worker {host:string;pid:number;boot:string}
export interface ScheduleJob {id:string;channelId:string;date:string;policyVersion:number;state:'RUNNING'|'READY'|'FAILED';worker:Worker;createdAt:string;updatedAt:string;message:string;revisionId?:string;rundownId?:string;itemCount?:number}
type Runner=(request:DayPlanRequest)=>Promise<DayPlan>
type Original=(id:string,hash:string,path:string)=>Promise<string|null>
function fail(error:string,status=409):never{throw new CollaborativeEditError(status,{error})}
function futureDates(days:number,now=new Date()){
  return Array.from({length:days},(_,i)=>{const date=new Date(now);date.setHours(12,0,0,0);date.setDate(date.getDate()+i+1);return localDate(date)})
}
function gone(worker:Worker){
  if(worker.host!==hostname()||!Number.isInteger(worker.pid)||worker.pid<=0)return false
  try{process.kill(worker.pid,0);return false}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'}
}
export function readSchedulePublicationPolicy(db:Db,channelId:string):Policy|null{
  const row=db.select().from(operatorDecisions).where(eq(operatorDecisions.id,policyKey(channelId))).get()
  return row?.kind===POLICY&&row.payload.channelId===channelId?row.payload as unknown as Policy:null
}
export function schedulePlannerBinary(){
  const candidates=[...(typeof __dirname==='string'?[resolve(__dirname,'schedule-planner.cjs')]:[]),resolve(process.cwd(),'apps/server/dist/schedule-planner.cjs'),resolve(process.cwd(),'dist/schedule-planner.cjs'),resolve(process.env.RPLAYOUT_INSTALL_ROOT??process.cwd(),'apps/server/dist/schedule-planner.cjs')]
  return candidates.find(path=>existsSync(path))??''
}
/** Explicit recurring editorial authority, separate from PGM/CUE and TIME-06.
 * Only future unoccupied days. Never rewrites a manual/generated grade, approves
 * media, claims signal readiness, or sends TAKE. Durable phases fail closed. */
export class SchedulePublication {
  private closed=false;private busy=false;private child:ChildProcess|null=null;private ownedJob:string|null=null
  private readonly worker:Worker={host:hostname(),pid:process.pid,boot:randomUUID()}
  private readonly fileVersions=new FileVersionVerifier()
  constructor(private readonly db:Db,private readonly binary:string,private readonly original:Original,private readonly runner:Runner=this.native.bind(this)){}
  private config(channelId:string){
    const row=this.db.select().from(channels).where(eq(channels.id,channelId)).get()
    if(!row||row.archivedAt)fail('Canal ativo não encontrado.',404)
    const channel=toChannel(row),rules=this.db.select().from(scheduleRules).where(eq(scheduleRules.channelId,channelId)).orderBy(asc(scheduleRules.startMinute),asc(scheduleRules.id)).all()
    for(let day=0;day<7;day++)dayRules(rules,day)
    const anchor=this.db.select().from(rundowns).where(eq(rundowns.channelId,channelId)).orderBy(asc(rundowns.id)).get()
    if(!anchor)fail('Crie uma grade editorial neste canal antes de habilitar automação.')
    return {channel,rules,anchorId:anchor.id,contract:installationVault().reviewIdentity(JSON.stringify({channel,rules}),'schedule-publication-contract:v1')}
  }
  jobs(channelId:string):ScheduleJob[]{
    return this.db.select({entry:operatorDecisions}).from(operatorDecisions).innerJoin(rundowns,eq(rundowns.id,operatorDecisions.rundownId))
      .where(and(eq(operatorDecisions.kind,JOB),eq(rundowns.channelId,channelId))).orderBy(desc(operatorDecisions.createdAt),desc(operatorDecisions.id)).all()
      .map(({entry})=>entry.payload as unknown as ScheduleJob).filter(job=>job.channelId===channelId)
  }
  status(channelId:string){
    const saved=readSchedulePublicationPolicy(this.db,channelId)
    return {channelId,version:saved?.version??0,state:saved?.state??'DISABLED',mode:'OWNED_EMPTY_DAYS' as const,daysAhead:saved?.daysAhead??2,maxItems:saved?.maxItems??2000,workerAvailable:Boolean(this.binary),
      message:saved?.message??'Desligada. Confira a pauta e autorize antes de montar/publicar dias futuros.',jobs:this.jobs(channelId).slice(0,30).map(({worker,...job})=>({...job,workerState:job.state!=='RUNNING'?'OFF':worker.pid===this.worker.pid&&worker.host===this.worker.host&&worker.boot===this.worker.boot?'CURRENT_SERVER':gone(worker)?'INTERRUPTED':'OTHER_OR_UNKNOWN_SERVER'}))}
  }
  review(channelId:string,daysAhead:number,maxItems:number,owner:BoundaryOwner){
    return this.db.transaction(()=>{
      if(!Number.isInteger(daysAhead)||daysAhead<1||daysAhead>7||!Number.isInteger(maxItems)||maxItems<1||maxItems>5000)fail('Antecedência deve ser de 1–7 dias e limite de 1–5000 itens.',400)
      if(!this.binary)fail('Auxiliar de montagem ausente no pacote. Refaça a build completa.',503)
      const config=this.config(channelId),permission=boundaryAuthority(this.db,owner,channelId),version=readSchedulePublicationPolicy(this.db,channelId)?.version??0
      const dates=futureDates(daysAhead),jobs=this.jobs(channelId),occupied=this.db.select().from(rundowns).where(eq(rundowns.channelId,channelId)).all().filter(row=>dates.includes(row.date)).map(row=>({id:row.id,date:row.date,name:row.name,owned:row.id===gradeKey(channelId,row.date)&&jobs.some(job=>job.state==='READY'&&job.rundownId===row.id)}))
      const token=installationVault().reviewIdentity(JSON.stringify({channelId,version,daysAhead,maxItems,owner,permission,contract:config.contract,dates,occupied}),'schedule-publication-review:v1')
      return {channelId,version,daysAhead,maxItems,dates,occupied,token}
    })
  }
  enable(channelId:string,daysAhead:number,maxItems:number,owner:BoundaryOwner,token:string|undefined,authorize:()=>void){
    return this.db.transaction(tx=>{
      authorize();const review=this.review(channelId,daysAhead,maxItems,owner)
      if(!token)fail('Confira a pauta e a política antes de habilitar publicação automática.',428)
      const received=Buffer.from(token),expected=Buffer.from(review.token)
      if(received.length!==expected.length||!timingSafeEqual(received,expected))fail('Pauta, canal, dias futuros, permissão ou política mudou. Confira novamente; nada foi habilitado.')
      if(review.occupied.some(row=>!row.owned))fail('Há grade manual/incompleta na janela futura. A automação não sobrescreve esse dia; ajuste a janela antes de habilitar.')
      if(this.jobs(channelId).some(job=>job.state==='RUNNING'&&!gone(job.worker)))fail('Há montagem em execução em outro pedido/servidor. Aguarde o encerramento; nenhum dono será roubado.')
      const config=this.config(channelId),at=new Date().toISOString(),policy:Policy={channelId,version:review.version+1,state:'ENABLED',mode:'OWNED_EMPTY_DAYS',daysAhead,maxItems,owner,contract:config.contract,anchorId:config.anchorId,updatedAt:at,message:'Habilitada para dias futuros vazios; publicação não altera o PGM/CUE nem habilita passagem automática.'}
      tx.insert(operatorDecisions).values({id:policyKey(channelId),rundownId:config.anchorId,kind:POLICY,payload:policy as unknown as Record<string,unknown>,actorUsername:owner.username,createdAt:at})
        .onConflictDoUpdate({target:operatorDecisions.id,set:{payload:policy as unknown as Record<string,unknown>,actorUsername:owner.username}}).run()
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:config.anchorId,kind:'SCHEDULE_PUBLICATION_ENABLED',payload:{channelId,version:policy.version,daysAhead,maxItems,contract:config.contract},actorUsername:owner.username,createdAt:at}).run()
      return this.status(channelId)
    },{behavior:'immediate'})
  }
  suspend(channelId:string,actor:string|null,message:string,state:Policy['state']='SUSPENDED',expectedVersion?:number){
    return this.db.transaction(tx=>{
      const saved=readSchedulePublicationPolicy(this.db,channelId)
      if(!saved||saved.state!=='ENABLED'||expectedVersion!==undefined&&saved.version!==expectedVersion)return this.status(channelId)
      const at=new Date().toISOString()
      tx.update(operatorDecisions).set({payload:{...saved,version:saved.version+1,state,message,updatedAt:at}}).where(eq(operatorDecisions.id,policyKey(channelId))).run()
      tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:saved.anchorId,kind:'SCHEDULE_PUBLICATION_SUSPENDED',payload:{channelId,version:saved.version,state,message},actorUsername:actor,createdAt:at}).run()
      return this.status(channelId)
    },{behavior:'immediate'})
  }
  private guard(policy:Policy){
    const current=readSchedulePublicationPolicy(this.db,policy.channelId)
    if(this.closed||current?.state!=='ENABLED'||current.version!==policy.version)fail('Política suspensa/alterada; resultado não será publicado.')
    boundaryAuthority(this.db,policy.owner,policy.channelId)
    const config=this.config(policy.channelId)
    if(config.contract!==policy.contract)fail('Formato, perfil de QC ou pauta mudou. Confira e habilite uma nova política.')
    return config
  }
  private readJob(id:string){const row=this.db.select().from(operatorDecisions).where(eq(operatorDecisions.id,id)).get();return row?.kind===JOB?row.payload as unknown as ScheduleJob:null}
  private save(job:ScheduleJob){this.db.update(operatorDecisions).set({payload:job as unknown as Record<string,unknown>}).where(eq(operatorDecisions.id,job.id)).run()}
  private own(job:ScheduleJob){return job.worker.host===this.worker.host&&job.worker.pid===this.worker.pid&&job.worker.boot===this.worker.boot}
  private pool(channelId:string){
    const assets=applyQcDecisionsNow(this.db,new Map(this.db.select().from(mediaAssets).orderBy(asc(mediaAssets.id)).all().map(row=>[row.id,toAsset(row)])),channelId)
    const config=this.config(channelId),candidates=buildCandidatesNow(this.db,config.channel,[...assets.values()].filter(asset=>asset.kind==='VIDEO'&&isMediaSha(asset.contentHash)))
    if(candidates.length>10000)fail('Mais de 10000 mídias elegíveis. Separe o acervo antes da montagem automática.')
    return {...config,assets,candidates}
  }
  private dependency(channelId:string,ids:string[]){
    const pool=this.pool(channelId),candidates=new Map(pool.candidates.map(candidate=>[candidate.id,candidate]))
    return installationVault().reviewIdentity(JSON.stringify({contract:pool.contract,selected:ids.map(id=>({asset:pool.assets.get(id),candidate:candidates.get(id)}))}),'schedule-day-dependency:v1')
  }
  private reservations(channelId:string){
    return this.db.select({entry:operationalPlaylistRevisions}).from(operationalPlaylistRevisions).innerJoin(rundowns,eq(rundowns.id,operationalPlaylistRevisions.rundownId))
      .where(and(eq(rundowns.channelId,channelId),eq(operationalPlaylistRevisions.active,true))).orderBy(asc(operationalPlaylistRevisions.id)).all()
  }
  async tick(){
    if(this.busy||this.closed)return;this.busy=true
    try{for(const row of this.db.select().from(operatorDecisions).where(eq(operatorDecisions.kind,POLICY)).all()){
      const policy=row.payload as unknown as Policy;if(policy.state==='ENABLED')await this.advance(policy)
    }}finally{this.busy=false}
  }
  private async advance(policy:Policy){
    let job:ScheduleJob|null=null
    try{
      const context=this.db.transaction(tx=>{
        this.guard(policy)
        for(const previous of this.jobs(policy.channelId).filter(run=>run.state==='RUNNING')){
          if(!gone(previous.worker))return null
          previous.state='FAILED';previous.message='Montagem interrompida pelo encerramento do dono. Confira e habilite novamente; nenhuma publicação foi presumida.';previous.updatedAt=new Date().toISOString();this.save(previous)
          this.suspend(policy.channelId,null,previous.message,'SUSPENDED',policy.version);return null
        }
        const dates=futureDates(policy.daysAhead),rows=tx.select().from(rundowns).where(eq(rundowns.channelId,policy.channelId)).all()
        let date:string|undefined
        for(const candidate of dates){
          const existing=rows.filter(row=>row.date===candidate),ready=this.jobs(policy.channelId).find(run=>run.date===candidate&&run.state==='READY'&&run.rundownId===gradeKey(policy.channelId,candidate))
          if(ready){
            const publication=tx.select().from(operationalPlaylistRevisions).where(eq(operationalPlaylistRevisions.id,ready.revisionId!)).get()
            if(existing.length!==1||existing[0]!.id!==ready.rundownId||!publication?.active)fail('Dia automático foi alterado ou recebeu outra publicação. Confira; a grade não será substituída.')
            continue
          }
          if(existing.length)fail(`Já há grade no dia ${candidate}. A automação não sobrescreve grade manual ou incompleta; organize esse dia e confira novamente.`)
          date=candidate;break
        }
        if(!date)return null
        if(this.readJob(`schedule-job:${policy.channelId}:${policy.version}:${date}`))fail('Esta tentativa já foi recusada. Confira e habilite uma nova versão; não haverá repetição silenciosa.')
        const pool=this.pool(policy.channelId),midnight=rundownMidnight(date)!,next=new Date(midnight);next.setDate(next.getDate()+1)
        if(next.getTime()-midnight!==86400000)fail('Este dia possui mudança de fuso/horário e não tem 24 horas civis. Exige programação manual.')
        const candidates=pool.candidates.map(candidate=>({...candidate}))
        const candidatesById=new Map(candidates.map(candidate=>[candidate.id,candidate]))
        // Future published reservations count for repetition just like as-run.
        const reservations=this.reservations(policy.channelId)
        for(const revision of reservations){
          const payload=readOperationalPayload(revision.entry.payload),base=rundownMidnight(payload.rundown.date)
          if(base===null||base>=midnight)continue
          const frameMs=1000*(payload.rate??pool.channel.rate).den/(payload.rate??pool.channel.rate).num
          const itemsById=new Map(payload.items.map(item=>[item.id,item]))
          for(const timing of payload.schedule.items){const item=itemsById.get(timing.id),candidate=item?.mediaId?candidatesById.get(item.mediaId):undefined,at=base+timing.start*frameMs
            if(candidate&&timing.state!=='DROPPED'&&at<midnight&&(candidate.lastAiredMs??-Infinity)<at)candidate.lastAiredMs=at
          }
        }
        const request:DayPlanRequest={date,weekday:new Date(midnight+12*3600000).getDay(),midnightMs:midnight,rate:pool.channel.rate,rules:pool.rules,candidates,maxItems:policy.maxItems}
        const now=new Date().toISOString();job={id:`schedule-job:${policy.channelId}:${policy.version}:${date}`,channelId:policy.channelId,date,policyVersion:policy.version,state:'RUNNING',worker:this.worker,createdAt:now,updatedAt:now,message:'Montagem em andamento; nenhuma grade publicada ainda.'}
        tx.insert(operatorDecisions).values({id:job.id,rundownId:policy.anchorId,kind:JOB,payload:job as unknown as Record<string,unknown>,actorUsername:policy.owner.username,createdAt:now}).run()
        return {pool,request,reservations:installationVault().reviewIdentity(JSON.stringify(reservations),'schedule-reservations:v1')}
      },{behavior:'immediate'})
      if(!context||!job)return
      const claimed=job as ScheduleJob;this.ownedJob=claimed.id
      const plan=await this.runner(context.request);this.guard(policy)
      this.validatePlan(context.request,plan,context.pool.assets)
      const ids=[...new Set(plan.items.map(item=>item.mediaId))].sort(),candidates=new Map(context.pool.candidates.map(candidate=>[candidate.id,candidate]))
      const dependency=installationVault().reviewIdentity(JSON.stringify({contract:context.pool.contract,selected:ids.map(id=>({asset:context.pool.assets.get(id),candidate:candidates.get(id)}))}),'schedule-day-dependency:v1')
      const originals:{path:string;identity:string}[]=[]
      for(const id of ids){
        this.guard(policy);const asset=context.pool.assets.get(id)!
        let path:string|null=null
        try{path=await this.original(id,asset.contentHash,asset.path)}catch{ /* Never expose private path/decoder diagnostics through public status. */ }
        if(!path)fail(`A edição aprovada de ${asset.title} está indisponível ou foi alterada; faça nova ingestão/QC.`)
        try{const identity=await this.fileVersions.verify(path,asset.contentHash);if(!identity)fail('Bytes do original não correspondem à edição aprovada. Nenhuma grade publicada.');originals.push({path,identity})}catch(error){if(error instanceof CollaborativeEditError)throw error;fail('Original deixou de estar disponível durante a conferência. Nenhuma grade publicada.')}
      }
      this.db.transaction(tx=>{
        this.guard(policy);const current=this.readJob(claimed.id)
        if(!current||current.state!=='RUNNING'||!this.own(current))fail('Outro dono/estado assumiu o trabalho; resultado descartado.')
        if(!futureDates(policy.daysAhead).includes(claimed.date))fail('O dia saiu da janela futura durante a montagem. Confira novamente.')
        if(tx.select().from(rundowns).where(and(eq(rundowns.channelId,policy.channelId),eq(rundowns.date,claimed.date))).get())fail('Uma grade foi criada neste dia durante a montagem. Nenhuma será substituída.')
        if(this.dependency(policy.channelId,ids)!==dependency)fail('Mídia, aprovação, corte, áudio ou histórico mudou durante a conferência. Resultado descartado.')
        if(installationVault().reviewIdentity(JSON.stringify(this.reservations(policy.channelId)),'schedule-reservations:v1')!==context.reservations)fail('Publicação futura mudou durante a montagem; confira a janela de repetição. Nenhuma grade publicada.')
        for(const evidence of originals){try{if(mediaFileIdentity(statSync(evidence.path,{bigint:true}))!==evidence.identity)fail('Um arquivo mudou após a conferência. Nenhuma grade publicada.')}catch(error){if(error instanceof CollaborativeEditError)throw error;fail('Original indisponível após a conferência. Nenhuma grade publicada.')}}
        const now=new Date().toISOString(),id=gradeKey(policy.channelId,claimed.date)
        tx.insert(rundowns).values({id,channelId:policy.channelId,name:`Pauta automática — ${claimed.date}`,date:claimed.date,plannedStart:0,loop:false,protectedZones:[],publicationRequired:true,createdAt:now,updatedAt:now}).run()
        for(const [i,choice] of plan.items.entries()){
          const asset=context.pool.assets.get(choice.mediaId)!
          tx.insert(rundownItems).values({id:randomUUID(),rundownId:id,sortOrder:(i+1)*10,type:'VT',mediaId:asset.id,title:asset.title,trim:resolveTrim(null,asset,context.pool.channel.rate).value,audio:resolveAudio(null,asset).value,minDuration:choice.duration,
            anchor:choice.firstInBand?{kind:'FIXED',at:choice.start}:{kind:'FLOW'},onOverrun:'PUSH',locked:false,autoNext:true,loop:false,notes:`Pauta ${choice.ruleId}; política ${policy.version}`}).run()
        }
        const revision=publishOperationalPlaylistNow(this.db,context.pool.channel,id,policy.owner.username,(_review,payload)=>{
          if(payload.schedule.conflicts.length||payload.schedule.endsAt!==plan.endsAt||payload.schedule.items.length!==plan.items.length||payload.schedule.items.some((timing,i)=>timing.start!==plan.items[i]!.start||timing.duration!==plan.items[i]!.duration||timing.state==='DROPPED'))fail('Timing calculado não corresponde à pauta exata. Nenhuma publicação foi aplicada.')
        })
        const ready:ScheduleJob={...current,state:'READY',updatedAt:now,rundownId:id,revisionId:revision.id,itemCount:plan.items.length,message:'Dia completo publicado. PGM/CUE não alterados; passagem automática é autorização separada.'}
        this.save(ready)
        tx.insert(operatorDecisions).values({id:randomUUID(),rundownId:id,kind:'SCHEDULE_DAY_PUBLISHED',payload:{channelId:policy.channelId,date:claimed.date,policyVersion:policy.version,jobId:claimed.id,revisionId:revision.id,items:plan.items.length,endsAt:plan.endsAt,exact:true},actorUsername:policy.owner.username,createdAt:now}).run()
      },{behavior:'immediate'})
    }catch(error){
      if(this.closed)return // close already persisted interrupted work before DB shutdown.
      const message=error instanceof CollaborativeEditError?String(error.payload.error):error instanceof Error?error.message:'Montagem não concluída.'
      this.db.transaction(()=>{
        if(job){const current=this.readJob((job as ScheduleJob).id);if(current?.state==='RUNNING'&&this.own(current))this.save({...current,state:'FAILED',updatedAt:new Date().toISOString(),message})}
        this.suspend(policy.channelId,null,message,'SUSPENDED',policy.version)
      },{behavior:'immediate'})
    }finally{this.ownedJob=null}
  }
  private validatePlan(request:DayPlanRequest,plan:DayPlan,assets:Map<string,MediaAsset>){
    if(!Array.isArray(plan.items)||!plan.items.length||plan.items.length>request.maxItems)fail('Auxiliar retornou plano vazio ou acima do limite.')
    let cursor=0;const last=new Map(request.candidates.map(c=>[c.id,c.lastAiredMs])),rules=dayRules(request.rules,request.weekday)
    const counts=new Map<string,number>();for(const choice of plan.items)counts.set(choice.ruleId,(counts.get(choice.ruleId)??0)+1)
    if(!Array.isArray(plan.bands)||plan.bands.length!==rules.length||plan.bands.some((band,i)=>band.ruleId!==rules[i]!.id||band.start!==Math.round(rules[i]!.startMinute*60*request.rate.num/request.rate.den)||band.end!==Math.round(rules[i]!.endMinute*60*request.rate.num/request.rate.den)||band.count!==counts.get(band.ruleId)))fail('Auxiliar retornou faixas fora da pauta conferida.')
    const candidatesById=new Map(request.candidates.map(candidate=>[candidate.id,candidate])),rulesById=new Map(rules.map(rule=>[rule.id,rule])),bandsById=new Map(plan.bands.map(band=>[band.ruleId,band]))
    for(const choice of plan.items){
      const candidate=candidatesById.get(choice.mediaId),rule=rulesById.get(choice.ruleId),asset=assets.get(choice.mediaId)
      const band=bandsById.get(choice.ruleId)
      if(!candidate||!rule||!asset||!band||choice.start!==cursor||choice.duration!==candidate.durationFrames||choice.start<band.start||cursor+choice.duration>band.end||choice.firstInBand!==(cursor===band.start)||rule.categories.length&&(!candidate.categoryId||!rule.categories.includes(candidate.categoryId)))fail('Auxiliar retornou seleção fora da pauta conferida.')
      const now=request.midnightMs+cursor*1000*request.rate.den/request.rate.num
      if(now-(last.get(candidate.id)??-Infinity)<rule.avoidHours*3600000)fail('Seleção viola a janela de repetição.')
      last.set(candidate.id,now);cursor+=choice.duration
    }
    if(cursor!==plan.endsAt||plan.endsAt!==Math.round(86400*request.rate.num/request.rate.den))fail('Plano não preenche o dia exato.')
  }
  private native(request:DayPlanRequest):Promise<DayPlan>{
    return new Promise((done,reject)=>{
      if(!this.binary){reject(new Error('Auxiliar de montagem indisponível.'));return}
      const child=spawn(process.execPath,[this.binary],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});this.child=child
      try{if(child.pid)setPriority(child.pid,constants.priority.PRIORITY_LOW)}catch{}
      let output='',overflow=false;const timer=setTimeout(()=>child.kill(),60000)
      child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8*1024*1024){overflow=true;child.kill()}});child.stderr.resume();child.stdin.on('error',()=>{})
      child.once('error',reject);child.once('close',code=>{clearTimeout(timer);this.child=null
        if(code!==0||overflow){reject(new Error('Auxiliar de montagem encerrou sem um plano completo. Confira e habilite novamente.'));return}
        try{const reply=JSON.parse(output);if(!reply.ok)throw new Error(reply.error);done(reply.result)}catch(error){reject(error)}
      })
      child.stdin.write(JSON.stringify(request)+'\n')
    })
  }
  close(){this.closed=true;this.child?.kill()
    if(!this.ownedJob)return
    const job=this.readJob(this.ownedJob)
    if(job?.state==='RUNNING'&&this.own(job)){this.save({...job,state:'FAILED',message:'Servidor encerrou durante montagem. Confira e habilite novamente.',updatedAt:new Date().toISOString()});this.suspend(job.channelId,null,'Montagem interrompida pelo encerramento do servidor.','SUSPENDED',job.policyVersion)}
  }
}

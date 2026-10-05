import type Database from 'better-sqlite3'
import {mkdir,mkdtemp,lstat,open} from 'node:fs/promises'
import {join} from 'node:path'
import {hostname} from 'node:os'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {openDatabase} from '../db/client.js'
import {channels,rundowns,operationalPlaylistRevisions,mediaAssets,qcDecisions} from '../db/schema.js'
import {installationVault} from './secret-vault.js'
import {Checkpoints,parseChannelCheckpoint} from './checkpoints.js'
import {haRequiredMedia} from './ha-media.js'
import type {HaSnapshot} from './ha-replication.js'
import {readOperationalPayload} from './operational-playlist.js'
import {qcApproved,type MediaAsset,type QcStatus} from '@rplayout/protocol'
import {assessLocalProbe,localFileStamp,probeRuntimeHash,runLocalProbe,type LocalProbeRunner} from './ha-local-probe.js'

export const haRecoveryRequest=z.object({requestId:z.string().uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),channelId:z.string().min(1).max(128)}).strict()
export type HaRecoveryRequest=z.infer<typeof haRecoveryRequest>
export class HaRecoveryError extends Error {}
export interface HaRecoveryReport {
  requestId:string;sequence:number;channelId:string;phase:'CHECKING'|'RESTORED'|'REFUSED';createdAt:string
  restoredRevisions:number;verifiedMedia:number;qcBlocked:number;checkpointRestored:boolean
  automaticTake:false;promotionReady:false;localProbeRequired:boolean;reason:string
  localValidation?:{state:'PASSED'|'FAILED';runtimeHash:string;checkedAt:string;required:number;decoded:number;technicalBlocked:number}
  reconciled?:{at:string;actor:string|null}
}
type Ledger={request_id:string;intent:string;report:string;workspace:string|null;owner:string|null}
const text=z.string().min(1),integer=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const qcProfileSchema=z.object({codecs:z.array(z.string()),width:integer.positive().nullable(),height:integer.positive().nullable(),fps:z.number().finite().positive().nullable(),scan:z.enum(['ANY','PROGRESSIVE','INTERLACED']),requireAudio:z.boolean(),minDurationSeconds:z.number().finite().nonnegative(),requireLoudness:z.boolean(),minLufs:z.number().finite(),maxLufs:z.number().finite(),maxTruePeakDbtp:z.number().finite()})
const channelSchema=z.object({id:text,name:text,rateNum:integer.positive(),rateDen:integer.positive(),width:integer.positive().max(16384),height:integer.positive().max(16384),scan:z.enum(['PROGRESSIVE','INTERLACED']),fieldOrder:z.enum(['TFF','BFF']),targetLufs:z.number().finite(),ceilingDbtp:z.number().finite(),limiterLookaheadMs:integer,audioChannels:z.union([z.literal(2),z.literal(8),z.literal(16)]),qcProfile:qcProfileSchema.nullable().optional(),createdAt:z.string().datetime()}).passthrough()
const revisionSchema=z.object({id:text,rundownId:text,revision:integer.positive(),state:z.enum(['PUBLISHED','SUPERSEDED']),active:z.boolean(),publishedAt:z.string().datetime(),publishedBy:z.string().nullable(),activatedAt:z.string().datetime().nullable(),payload:z.record(z.unknown())})
const zoneSchema=z.object({id:text,label:z.string(),from:integer,to:integer,priority:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5)])}).refine(zone=>zone.to>zone.from)
const rundownSchema=z.object({id:text,channelId:text,name:text,date:text,plannedStart:integer,loop:z.boolean(),protectedZones:z.array(zoneSchema).optional(),createdAt:z.string().datetime(),updatedAt:z.string().datetime()}).passthrough()
const assetSchema=z.object({id:text,contentHash:z.string().regex(/^[a-f0-9]{64}$/),path:text,title:z.string(),kind:z.enum(['VIDEO','AUDIO','STILL']),durationFrames:integer,durationNs:integer.nullable().optional(),createdAt:z.string().datetime()}).passthrough()
const decisionSchema=z.object({id:text,assetId:text,contentHash:z.string().regex(/^[a-f0-9]{64}$/),channelId:text,status:z.enum(['PENDING','ANALYSIS','APPROVED','APPROVED_WITH_NOTES','REJECTED','FAILED','BLOCKED']),notes:z.string().nullable(),checks:z.object({playable:z.boolean(),errors:z.array(z.string()),warnings:z.array(z.string())}),actor:z.string().nullable(),createdAt:z.string().datetime()})

/** Recovery rehearsal only. A fresh, private, archived channel contains frozen
 * editions plus a stopped cursor. No accounts, outputs, live/device bindings or
 * command journals are installed as executable work. Original provenance stays
 * encrypted inside that DB; it cannot accidentally become a promoted server.
 * Ledger IDs make a lost response queryable, not a replay of restore/TAKE. */
export class HaRecovery {
  private closed=false
  private pending=new Set<Promise<unknown>>()
  private abort=new AbortController()
  private readonly owner=JSON.stringify({host:hostname(),pid:process.pid,boot:randomUUID()})
  constructor(private readonly database:Database.Database,private readonly root:string,
    private readonly current:()=>{sequence:number;snapshot:HaSnapshot|null},
    private readonly resolveMedia:(hash:string)=>Promise<string|null>,private readonly context:string,
    private readonly localProbe?:{binary:string;run?:LocalProbeRunner}){
    database.exec('CREATE TABLE IF NOT EXISTS ha_recovery(request_id TEXT PRIMARY KEY,intent TEXT NOT NULL,report TEXT NOT NULL,workspace TEXT,owner TEXT)')
    // Legacy unknown-owner CHECKING cannot be released by guessing a process.
    if(!(database.pragma('table_info(ha_recovery)') as Array<{name:string}>).some(column=>column.name==='owner'))database.exec('ALTER TABLE ha_recovery ADD COLUMN owner TEXT')
  }
  private key(id:string){return `ha-recovery:v1:${this.context}:${id}`}
  private read(row:Ledger):HaRecoveryReport{return JSON.parse(installationVault(false).decrypt(row.report,this.key(row.request_id)))}
  private matches(row:Ledger,request:HaRecoveryRequest){
    try{const saved=haRecoveryRequest.parse(JSON.parse(row.intent));return saved.requestId===request.requestId&&saved.channelId===request.channelId&&saved.sequence===request.sequence}catch{return false}
  }
  private store(report:HaRecoveryReport,workspace:string|null=null){
    const result=this.database.prepare('UPDATE ha_recovery SET report=?,workspace=coalesce(?,workspace) WHERE request_id=? AND owner=?').run(installationVault().encrypt(JSON.stringify(report),this.key(report.requestId)),workspace,report.requestId,this.owner)
    if(result.changes!==1)throw new Error('Posse do ensaio mudou; relatório anterior preservado.')
  }
  status(){return (this.database.prepare('SELECT * FROM ha_recovery ORDER BY rowid DESC LIMIT 20').all() as Ledger[]).map(row=>this.read(row))}
  async rehearse(value:unknown):Promise<HaRecoveryReport>{
    if(this.closed)return Promise.reject(new Error('Ensaio de recuperação encerrando.'))
    const request=haRecoveryRequest.parse(value),intent=JSON.stringify(request)
    const existing=this.database.prepare('SELECT * FROM ha_recovery WHERE request_id=?').get(request.requestId) as Ledger|undefined
    if(existing){if(!this.matches(existing,request))return Promise.reject(new HaRecoveryError('Pedido de recuperação pertence a outra edição/canal.'));return Promise.resolve(this.read(existing))}
    const initial:HaRecoveryReport={...request,phase:'CHECKING',createdAt:new Date().toISOString(),restoredRevisions:0,verifiedMedia:0,qcBlocked:0,checkpointRestored:false,automaticTake:false,promotionReady:false,localProbeRequired:true,reason:'Ensaio em andamento ou interrompido. Pedido repetido apenas consulta; não autoriza PGM.'}
    this.database.transaction(()=>{
      // A crash leaves CHECKING quarantined. Never implicitly repeat the
      // interrupted builder or race it with a different request.
      if((this.database.prepare('SELECT * FROM ha_recovery').all() as Ledger[]).some(row=>this.read(row).phase==='CHECKING'))throw new HaRecoveryError('Outro ensaio em andamento ou interrompido. Confira o pedido anterior antes de repetir.')
      this.database.prepare('INSERT INTO ha_recovery(request_id,intent,report,workspace,owner) VALUES(?,?,?,NULL,?)').run(request.requestId,intent,installationVault().encrypt(JSON.stringify(initial),this.key(request.requestId)),this.owner)
    }).immediate()
    const work=this.run(request,initial);this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});return work
  }
  /** Closes only a dead local builder's intent. Never resumes work, touches a
   * workspace or permits PGM. Repetition only queries the durable result. */
  reconcile(value:unknown,actor:string|null):HaRecoveryReport{
    if(this.closed)throw new HaRecoveryError('Ensaio de recuperação encerrando.')
    const request=haRecoveryRequest.parse(value)
    return this.database.transaction(()=>{
      const row=this.database.prepare('SELECT * FROM ha_recovery WHERE request_id=?').get(request.requestId) as Ledger|undefined
      if(!row||!this.matches(row,request))throw new HaRecoveryError('Pedido/canal/edição não confere; nada foi liberado.')
      const report=this.read(row)
      if(report.phase!=='CHECKING')return report
      const ownerSchema=z.object({host:z.string(),pid:z.number().int().positive().max(0x7fffffff),boot:z.string().uuid()}).strict()
      let owner:z.infer<typeof ownerSchema>|null=null
      try{owner=ownerSchema.parse(JSON.parse(row.owner??'null'))}catch{}
      let gone=false
      if(owner?.host===hostname()&&owner.pid!==process.pid)try{process.kill(owner.pid,0)}catch(error){gone=(error as NodeJS.ErrnoException).code==='ESRCH'}
      if(!gone)throw new HaRecoveryError('Criador ainda vivo, de outro host ou desconhecido. O ensaio não será liberado.')
      const result:HaRecoveryReport={...report,phase:'REFUSED',reconciled:{at:new Date().toISOString(),actor},reason:'Ensaio interrompido reconciliado após confirmar término do criador local. Banco parcial preservado; nada foi retomado e nenhum PGM aberto. Use novo UUID para novo ensaio.'}
      this.database.prepare('UPDATE ha_recovery SET report=? WHERE request_id=?').run(installationVault().encrypt(JSON.stringify(result),this.key(request.requestId)),request.requestId)
      return result
    }).immediate()
  }
  private unchanged(request:HaRecoveryRequest){
    const current=this.current()
    if(this.closed||current.sequence!==request.sequence||!current.snapshot)throw new Error('Edição espelhada mudou ou reserva encerrando. Nenhum PGM foi aberto.')
    return current.snapshot
  }
  private async run(request:HaRecoveryRequest,initial:HaRecoveryReport):Promise<HaRecoveryReport>{
    let destination:ReturnType<typeof openDatabase>|null=null
    try{
      const snapshot=this.unchanged(request),source=snapshot.channels.find(row=>row.channelId===request.channelId)
      if(!source)throw new Error('Canal não pertence à edição espelhada solicitada.')
      const channel=channelSchema.parse(source.configuration.channel)
      if(channel.id!==request.channelId)throw new Error('Identidade do canal espelhado não confere.')
      const revisions=source.revisions.map(value=>revisionSchema.parse(value)),ids=new Set<string>(),active=new Set<string>()
      const parsed=revisions.map(revision=>{
        if(ids.has(revision.id))throw new Error('Revisões duplicadas no espelho.');ids.add(revision.id)
        const payload=readOperationalPayload(revision.payload),rundown=rundownSchema.parse(payload.rundown)
        if(rundown.channelId!==channel.id||rundown.id!==revision.rundownId)throw new Error('Edição publicada pertence a outro canal/grade.')
        if(revision.active){if(active.has(rundown.id))throw new Error('Duas edições ativas da mesma grade.');active.add(rundown.id)}
        const items=new Set<string>()
        for(const item of payload.items){if(!item||typeof item.id!=='string'||item.rundownId!==rundown.id||items.has(item.id))throw new Error('Item publicado inconsistente.');items.add(item.id)}
        return {revision,payload,rundown}
      })
      if(!parsed.length)throw new Error('Nenhuma edição publicada para restaurar.')
      const rawCheckpoint=(source.checkpoint as {value?:unknown}|null)?.value
      const checkpoint=rawCheckpoint===undefined||rawCheckpoint===null?null:parseChannelCheckpoint(rawCheckpoint,channel.id)
      for(const cursor of [checkpoint,checkpoint?.contingency])if(cursor?.revisionId){
        const entry=parsed.find(row=>row.revision.id===cursor.revisionId)
        if(!entry||entry.rundown.id!==cursor.rundownId||cursor.itemId&&!entry.payload.items.some(item=>item.id===cursor.itemId))throw new Error('Cursor referencia edição/item ausente.')
      }
      const execution=source.configuration.executionRevisionId
      if(execution!==null&&execution!==undefined&&(typeof execution!=='string'||!ids.has(execution)))throw new Error('Edição em execução não está no espelho.')
      if(checkpoint?.contingency){
        const loop=parsed.find(row=>row.revision.id===checkpoint.contingency!.loopRevisionId)
        if(!loop||loop.rundown.id!==checkpoint.contingency.loopRundownId)throw new Error('Loop de contingência ausente ou pertence a outra grade.')
      }
      const demanded=new Set([execution,checkpoint?.revisionId,checkpoint?.contingency?.revisionId,checkpoint?.contingency?.loopRevisionId].filter((id):id is string=>typeof id==='string'))
      for(const entry of parsed){
        const available=new Set<string>()
        for(const asset of entry.payload.assets??[]){
          if(!asset||typeof asset.id!=='string'||available.has(asset.id))throw new Error('Metadados publicados duplicados/inválidos.')
          available.add(asset.id)
          // Historical-only legacy hashes are evidence, not decoder inputs.
          // Required editions must not silently skip invalid/missing SHA.
          if(entry.revision.active||demanded.has(entry.revision.id))assetSchema.parse(asset)
        }
        for(const item of entry.payload.items)for(const reference of [item.mediaId,item.liveFallbackMediaId,item.liveConfig?.fallbackMediaId])if(reference&&!available.has(reference))throw new Error('Item publicado referencia mídia ausente dos metadados.')
      }
      const required=haRequiredMedia({...snapshot,channels:[source]}),paths=new Map<string,string>()
      for(const hash of required.keys()){
        const path=await this.resolveMedia(hash);if(!path)throw new Error('Cópia local ausente, incompleta ou alterada. Revalide a mídia espelhada.')
        paths.set(hash,path);this.unchanged(request)
      }
      const decisions=(Array.isArray(source.configuration.qc)?source.configuration.qc:[]).map(row=>decisionSchema.parse(row))
      if(decisions.some(row=>row.channelId!==channel.id&&row.channelId!=='@all')||new Set(decisions.map(row=>row.id)).size!==decisions.length)throw new Error('Decisões de QC inconsistentes ou pertencentes a outro canal.')
      const assets=new Map<string,MediaAsset>(),versions=new Map<string,MediaAsset>()
      const preferred=[...parsed.filter(row=>row.revision.id===execution),...parsed.filter(row=>row.revision.active),...parsed]
      for(const entry of preferred)for(const raw of entry.payload.assets??[]){
        if(!paths.has(raw.contentHash))continue
        const valid=assetSchema.parse(raw)
        versions.set(valid.id+':'+valid.contentHash,raw)
        if(!assets.has(valid.id))assets.set(valid.id,raw)
      }
      const kinds=new Map<string,string>()
      for(const asset of versions.values()){
        if(kinds.has(asset.contentHash)&&kinds.get(asset.contentHash)!==asset.kind)throw new Error('Mesmo SHA publicado com tipos de mídia conflitantes.')
        kinds.set(asset.contentHash,asset.kind)
      }
      if([...required.values()].some(asset=>!assets.has(asset.id)))throw new Error('Metadados de mídia publicada incompletos.')
      const evidence=new Map<string,ReturnType<typeof assessLocalProbe>>()
      let localValidation:HaRecoveryReport['localValidation']
      if(this.localProbe){
        const runtimeStamp=await localFileStamp(this.localProbe.binary)
        const runtimeHash=await probeRuntimeHash(this.localProbe.binary)
        const checkedAt=new Date().toISOString()
        this.unchanged(request)
        const run=this.localProbe.run??((path:string,signal:AbortSignal)=>runLocalProbe(this.localProbe!.binary,path,signal))
        // Probe each SHA once, even when several published editions refer to
        // it. Never open a primary path or use a frozen probe as local proof.
        for(const [hash,path] of paths){
          const stamp=await localFileStamp(path)
          let raw:unknown=null
          try{raw=await run(path,this.abort.signal)}catch{}
          this.unchanged(request)
          if(await localFileStamp(path)!==stamp)throw new Error('Mídia foi alterada durante a análise local, mesmo que o SHA tenha sido restaurado.')
          if(await this.resolveMedia(hash)!==path)throw new Error('Mídia mudou durante a análise local.')
          this.unchanged(request)
          const asset=[...versions.values()].find(row=>row.contentHash===hash)!
          evidence.set(hash,assessLocalProbe(asset,raw,channel.qcProfile??undefined,checkedAt))
        }
        if(await probeRuntimeHash(this.localProbe.binary)!==runtimeHash||await localFileStamp(this.localProbe.binary)!==runtimeStamp)throw new Error('Sonda mudou durante o ensaio.')
        this.unchanged(request)
        const decoded=[...evidence.values()].filter(row=>row.decoded).length
        const technicalBlocked=[...evidence.values()].filter(row=>!row.checks.playable).length
        localValidation={state:decoded===paths.size&&technicalBlocked===0?'PASSED':'FAILED',runtimeHash,checkedAt,required:paths.size,decoded,technicalBlocked}
      }
      await mkdir(this.root,{recursive:true,mode:0o700})
      const root=await lstat(this.root);if(!root.isDirectory()||root.isSymbolicLink())throw new Error('Pasta de ensaio inválida; nenhum destino será sobrescrito.')
      const directory=await mkdtemp(join(this.root,'recovery-')),file=join(directory,'operational.db')
      const handle=await open(file,'wx',0o600);await handle.close()
      this.store(initial,file);this.unchanged(request)
      destination=openDatabase(file)
      destination.sqlite.pragma('synchronous = FULL')
      const qcBlocked=[...versions.values()].filter(asset=>!qcApproved(decisions.filter(row=>row.assetId===asset.id&&row.contentHash===asset.contentHash).at(-1)?.status)||evidence.has(asset.contentHash)&&!evidence.get(asset.contentHash)!.checks.playable).length
      destination.db.transaction(tx=>{
        // Deliberately archived: even opening this DB with a normal backend
        // must not create a channel runtime, an SDI master or a publisher.
        tx.insert(channels).values({...channel,qcProfile:channel.qcProfile??null,programSdiDeviceId:null,slateTemplateId:null,archivedAt:initial.createdAt}).run()
        const grades=new Set<string>()
        for(const {rundown,revision} of parsed){
          if(!grades.has(rundown.id)){tx.insert(rundowns).values({...rundown,protectedZones:rundown.protectedZones??[],publicationRequired:true}).run();grades.add(rundown.id)}
          tx.insert(operationalPlaylistRevisions).values(revision).run()
        }
        for(const asset of assets.values()){
          const latest=decisions.filter(row=>row.assetId===asset.id&&row.contentHash===asset.contentHash).at(-1)
          const status:QcStatus=latest?.status??'PENDING'
          const local=evidence.get(asset.contentHash),probe=local?.probe
          tx.insert(mediaAssets).values({id:asset.id,contentHash:asset.contentHash,path:paths.get(asset.contentHash)!,title:asset.title,kind:asset.kind,durationFrames:asset.durationFrames,durationNs:asset.durationNs??null,createdAt:asset.createdAt,
            ...(probe?{durationNs:probe.durationNs,videoCodec:probe.videoCodec??null,width:probe.video?.width??null,height:probe.video?.height??null,rateNum:probe.video?.rateNum??null,rateDen:probe.video?.rateDen??null,interlaceMode:probe.video?.interlaceMode??null,hasAudio:Boolean(probe.audio),audioChannels:probe.audio?.channels??0,audioTracks:probe.audioTracks??[],loudnessFile:local!.loudnessFile}:{}),
            qcStatus:status,qcNotes:latest?.notes??null,qcCheckedAt:latest?.createdAt??null,ignored:!qcApproved(status)||!local?.checks.playable,
            probeError:local?.decoded?null:local?'Sonda local não comprovou decodificação; confira mídia e runtime.':'Ensaio HA: sonda local e vínculos de saída ainda não homologados.'}).run()
        }
        for(const decision of decisions)tx.insert(qcDecisions).values(decision).run()
        if(checkpoint)new Checkpoints(destination!.sqlite).write({...checkpoint,playing:false,realEngine:false})
        destination!.sqlite.exec('CREATE TABLE ha_recovery_origin(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL)')
        const provenance={version:1,request,channel:source,asRun:snapshot.asRun.filter(row=>row.channelId===channel.id),journals:snapshot.journals.filter(row=>row.channelId===channel.id||typeof row.rundownId==='string'&&grades.has(row.rundownId)),capturedAt:snapshot.capturedAt}
        destination!.sqlite.prepare('INSERT INTO ha_recovery_origin VALUES(1,?)').run(installationVault().encrypt(JSON.stringify(provenance),this.key(request.requestId)+':origin'))
        destination!.sqlite.exec('CREATE TABLE ha_recovery_media(content_hash TEXT PRIMARY KEY,payload TEXT NOT NULL)')
        for(const [hash,validation] of evidence)destination!.sqlite.prepare('INSERT INTO ha_recovery_media VALUES(?,?)').run(hash,installationVault().encrypt(JSON.stringify({version:1,request,runtimeHash:localValidation!.runtimeHash,checkedAt:localValidation!.checkedAt,...validation}),this.key(request.requestId)+':media:'+hash))
      })
      this.unchanged(request)
      if(destination.sqlite.pragma('integrity_check',{simple:true})!=='ok'||(destination.sqlite.pragma('foreign_key_check') as unknown[]).length)throw new Error('Banco de ensaio não passou na validação de integridade.')
      const report:HaRecoveryReport={...initial,phase:'RESTORED',restoredRevisions:parsed.length,verifiedMedia:paths.size,qcBlocked,checkpointRestored:Boolean(checkpoint),localProbeRequired:!localValidation||localValidation.decoded!==localValidation.required,...(localValidation?{localValidation}:{}),reason:localValidation?.state==='PASSED'?'Edições restauradas e mídia decodificada localmente com perfil técnico de QC verificado. Aprovação editorial, trims/mixes, vínculos, posse nativa e promoção são etapas separadas. Canal permanece arquivado e parado, sem saídas.':'Edições restauradas em banco isolado, canal arquivado e cursor parado. Análise local ausente ou com falha técnica; confira QC/runtime. Sem saídas ou autoridade de promoção.'}
      this.store(report);return report
    }catch{
      const report:HaRecoveryReport={...initial,phase:'REFUSED',reason:'Ensaio recusado: confira edição/cursor, cópias SHA, metadados, QC e pasta local. Qualquer banco parcial foi preservado e permanece isolado; nenhum PGM aberto.'}
      this.store(report);return report
    }finally{destination?.sqlite.close()}
  }
  close(){this.closed=true;this.abort.abort()}
  get running(){return this.pending.size>0}
  async settled(){await Promise.allSettled([...this.pending])}
}

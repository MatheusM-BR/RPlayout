import dgram from 'node:dgram'
import {randomBytes,randomUUID} from 'node:crypto'
import {and,eq,isNull,like} from 'drizzle-orm'
import type {Db} from '../db/client.js'
import {healthEvents} from '../db/schema.js'
import {emitIntegrationEvent} from './integrations.js'
import {readPlatformClock,type PlatformClock,type ExecFn} from './clock-platform.js'

/**
 * Monitor do relógio do servidor.
 *
 * A grade e os horários fixos do playout dependem do relógio de parede desta
 * máquina. Deriva silenciosa derruba a veiculação no horário, e ninguém vê.
 * Este monitor consulta servidores NTP por SNTP (RFC 4330, UDP 123), compara
 * com o relógio local e abre incidente quando o desvio passa dos limiares.
 * Não ajusta o relógio: só mede e avisa. Nunca roda no caminho do PGM.
 *
 * Limiares (padrão). Um quadro a 25 fps dura 40 ms.
 *  - OK até 50 ms: pouco mais de um quadro; é o ruído esperado de SNTP pela
 *    internet (RTT variável) somado à deriva normal entre sincronizações.
 *  - AVISO acima de 50 ms: o desvio já é maior que um quadro; ainda não afeta
 *    o horário de forma perceptível, mas o sincronismo está ruim.
 *  - CRÍTICO acima de 500 ms: ~12 quadros; cortes e começos de bloco
 *    programados para o segundo ficam visivelmente fora e a comparação com
 *    outros sistemas (grade, comerciais, logs de as-run) já não bate.
 */
export interface ClockConfig {
  servers:string[]
  intervalMs:number
  initialDelayMs:number
  jumpCheckMs:number
  timeoutMs:number
  /** Amostras válidas necessárias por servidor (a mediana usa todas). */
  samples:number
  warnMs:number
  criticalMs:number
  maxRootDispersionMs:number
  unverifiedRounds:number
  jumpMs:number
}
export const DEFAULT_CLOCK_SERVERS=['a.st1.ntp.br','b.st1.ntp.br','c.st1.ntp.br','pool.ntp.org']

const positive=(value:string|undefined,fallback:number,min=1)=>{const n=Number(value);return value!==undefined&&value.trim()!==''&&Number.isFinite(n)&&n>=min?n:fallback}

/** Variáveis RPLAYOUT_CLOCK_*; valores inválidos voltam ao padrão. */
export function clockConfigFromEnv(env:Record<string,string|undefined>=process.env):ClockConfig{
  const listed=(env.RPLAYOUT_CLOCK_SERVERS??'').split(',').map(value=>value.trim()).filter(Boolean)
  let warnMs=positive(env.RPLAYOUT_CLOCK_WARN_MS,50),criticalMs=positive(env.RPLAYOUT_CLOCK_CRITICAL_MS,500)
  if(criticalMs<=warnMs){warnMs=50;criticalMs=500}
  return {
    servers:listed.length?listed:[...DEFAULT_CLOCK_SERVERS],
    intervalMs:positive(env.RPLAYOUT_CLOCK_INTERVAL_MS,10*60_000,10_000),
    initialDelayMs:positive(env.RPLAYOUT_CLOCK_INITIAL_DELAY_MS,20_000,0),
    jumpCheckMs:positive(env.RPLAYOUT_CLOCK_JUMP_CHECK_MS,5_000,500),
    timeoutMs:positive(env.RPLAYOUT_CLOCK_TIMEOUT_MS,1_500,100),
    samples:Math.floor(positive(env.RPLAYOUT_CLOCK_SAMPLES,3,3)),
    warnMs,criticalMs,
    maxRootDispersionMs:positive(env.RPLAYOUT_CLOCK_MAX_ROOT_DISPERSION_MS,500),
    unverifiedRounds:Math.floor(positive(env.RPLAYOUT_CLOCK_UNVERIFIED_ROUNDS,3)),
    jumpMs:positive(env.RPLAYOUT_CLOCK_JUMP_MS,1_000),
  }
}

// ---------------------------------------------------------------- SNTP ----
const NTP_UNIX_EPOCH_S=2_208_988_800 // segundos entre 1900-01-01 e 1970-01-01
const TWO32=4_294_967_296

export interface SntpSample {offsetMs:number;rttMs:number;stratum:number}
export class SntpDiscard extends Error {}

/** Unix ms (pode ser fracionário) para timestamp NTP de 64 bits. */
export function toNtpTimestamp(unixMs:number,randomLow=true):Buffer{
  const seconds=Math.floor(unixMs/1000)+NTP_UNIX_EPOCH_S
  const fraction=Math.min(TWO32-1,Math.floor(((unixMs%1000)/1000)*TWO32))
  const out=Buffer.alloc(8)
  out.writeUInt32BE(seconds>>>0,0)
  // Os 12 bits baixos (~1 µs) viram aleatórios: a resposta só vale se devolver
  // exatamente o que foi enviado (RFC 4330, seção 5: dificulta resposta forjada).
  out.writeUInt32BE((randomLow?((fraction&0xfffff000)|(randomBytes(2).readUInt16BE(0)&0x0fff)):fraction)>>>0,4)
  return out
}
export function fromNtpTimestamp(buffer:Buffer,offset:number):number{
  return (buffer.readUInt32BE(offset)-NTP_UNIX_EPOCH_S)*1000+buffer.readUInt32BE(offset+4)/TWO32*1000
}

export function buildSntpRequest(t0Ms:number):{packet:Buffer;transmit:Buffer;t0Ms:number}{
  const packet=Buffer.alloc(48)
  packet[0]=(0<<6)|(4<<3)|3 // LI=0, VN=4, Mode=3 (cliente)
  const transmit=toNtpTimestamp(t0Ms)
  transmit.copy(packet,40)
  return {packet,transmit,t0Ms:fromNtpTimestamp(transmit,0)}
}

/** Valida a resposta e calcula offset e RTT. Lança SntpDiscard se inutilizável. */
export function parseSntpResponse(response:Buffer,sentTransmit:Buffer,t0Ms:number,t3Ms:number,maxRootDispersionMs:number):SntpSample{
  if(response.length<48)throw new SntpDiscard('resposta curta')
  const leap=response[0]!>>6,mode=response[0]!&7,stratum=response[1]!
  if(mode!==4&&mode!==5)throw new SntpDiscard('modo inesperado')
  if(leap===3)throw new SntpDiscard('servidor não sincronizado (LI=3)')
  if(stratum===0)throw new SntpDiscard('kiss-of-death')
  if(stratum>15)throw new SntpDiscard('stratum inválido')
  // Origin timestamp precisa ser exatamente o que enviamos.
  if(!response.subarray(24,32).equals(sentTransmit))throw new SntpDiscard('origin timestamp diferente do enviado')
  const rootDispersionMs=response.readUInt32BE(8)/65536*1000
  if(rootDispersionMs>maxRootDispersionMs)throw new SntpDiscard('root dispersion alta')
  const t1=fromNtpTimestamp(response,32),t2=fromNtpTimestamp(response,40)
  if(response.readUInt32BE(32)===0||response.readUInt32BE(40)===0)throw new SntpDiscard('timestamps do servidor ausentes')
  if(t2<t1)throw new SntpDiscard('transmit anterior ao receive')
  // offset = ((t1 - t0) + (t2 - t3)) / 2 ; rtt = (t3 - t0) - (t2 - t1)
  const offsetMs=((t1-t0Ms)+(t2-t3Ms))/2
  const rttMs=(t3Ms-t0Ms)-(t2-t1)
  if(rttMs<-1)throw new SntpDiscard('RTT negativo')
  return {offsetMs,rttMs:Math.max(0,rttMs),stratum}
}

export function parseServer(spec:string):{host:string;port:number}{
  const match=/^(.*):(\d{1,5})$/.exec(spec)
  if(match&&!match[1]!.includes(':'))return {host:match[1]!,port:Number(match[2])}
  return {host:spec,port:123}
}

export type SntpQuery=(server:string,options:{timeoutMs:number;maxRootDispersionMs:number;now:()=>number;signal?:{sockets:Set<dgram.Socket>}})=>Promise<SntpSample>

/** Uma consulta SNTP. Resolve com a amostra ou rejeita (timeout/descarte). */
export const sntpQuery:SntpQuery=(server,options)=>new Promise((resolve,reject)=>{
  const {host,port}=parseServer(server)
  const socket=dgram.createSocket('udp4')
  options.signal?.sockets.add(socket)
  let done=false,discardReason=''
  const finish=(error:Error|null,sample?:SntpSample)=>{
    if(done)return;done=true
    clearTimeout(timer)
    options.signal?.sockets.delete(socket)
    try{socket.close()}catch{}
    if(error)reject(error);else resolve(sample!)
  }
  // Se só chegaram respostas inválidas, o motivo vai no erro do timeout.
  const timer=setTimeout(()=>finish(new Error(discardReason?`descartada: ${discardReason}`:'timeout')),options.timeoutMs)
  const request=buildSntpRequest(options.now())
  socket.on('error',error=>finish(error))
  socket.on('message',(message,remote)=>{
    const t3=options.now()
    if(remote.port!==port)return // ignora tráfego alheio sem encerrar a espera
    try{finish(null,parseSntpResponse(message,request.transmit,request.t0Ms,t3,options.maxRootDispersionMs))}
    catch(error){
      // Resposta descartada: segue esperando a legítima até o timeout.
      if(error instanceof SntpDiscard)discardReason=error.message
      else finish(error as Error)
    }
  })
  socket.send(request.packet,port,host,error=>{if(error)finish(error)})
})

const median=(values:number[])=>{
  const sorted=[...values].sort((a,b)=>a-b),mid=sorted.length>>1
  return sorted.length%2?sorted[mid]!:(sorted[mid-1]!+sorted[mid]!)/2
}

export interface ServerResult {host:string;offsetMs:number|null;rttMs:number|null;stratum:number|null;ok:boolean;valid:number;error?:string}
export type ClockState='OK'|'WARN'|'CRITICAL'|'UNVERIFIED'
export interface ClockStatus {
  checkedAt:string|null
  state:ClockState
  offsetMs:number|null
  rttMs:number|null
  servers:ServerResult[]
  platform:PlatformClock|null
  thresholds:{warnMs:number;criticalMs:number;unverifiedRounds:number;jumpMs:number}
  consecutiveFailedRounds:number
  jump:{detectedAt:string;jumpMs:number}|null
  reason:string
}

interface Deps {
  query?:SntpQuery
  /** Relógio de parede em ms. */
  now?:()=>number
  /** Relógio monotônico em ms. */
  mono?:()=>number
  exec?:ExecFn
  platformName?:NodeJS.Platform
  emit?:typeof emitIntegrationEvent
  persist?:boolean
  log?:(message:string)=>void
}

/** Consulta um servidor: `samples` amostras válidas, mediana. */
export async function measureServer(server:string,config:ClockConfig,query:SntpQuery,now:()=>number,sockets:Set<dgram.Socket>,closed:()=>boolean):Promise<ServerResult>{
  const valid:SntpSample[]=[]
  let lastError='',timeouts=0
  const maxAttempts=config.samples+2
  for(let attempt=0;attempt<maxAttempts&&valid.length<config.samples&&!closed();attempt++){
    try{valid.push(await query(server,{timeoutMs:config.timeoutMs,maxRootDispersionMs:config.maxRootDispersionMs,now,signal:{sockets}}));timeouts=0}
    catch(error){
      lastError=error instanceof Error?error.message:String(error)
      // Dois silêncios seguidos: servidor ou rede de ar bloqueando; não insiste.
      if(lastError==='timeout'&&++timeouts>=2)break
    }
  }
  if(valid.length<config.samples)return {host:server,offsetMs:null,rttMs:null,stratum:null,ok:false,valid:valid.length,error:lastError||'amostras insuficientes'}
  return {host:server,offsetMs:median(valid.map(s=>s.offsetMs)),rttMs:median(valid.map(s=>s.rttMs)),stratum:valid[valid.length-1]!.stratum,ok:true,valid:valid.length}
}

export class ClockMonitor {
  private readonly config:ClockConfig
  private readonly query:SntpQuery
  private readonly now:()=>number
  private readonly mono:()=>number
  private readonly sockets=new Set<dgram.Socket>()
  private closed=false
  private running=false
  private lastWall:number
  private lastMono:number
  private checkedAt:string|null=null
  private servers:ServerResult[]=[]
  private offsetMs:number|null=null
  private rttMs:number|null=null
  private platform:PlatformClock|null=null
  private failedRounds=0
  private jump:{detectedAt:string;jumpMs:number}|null=null
  private adopted=false
  private incident:{seq:string;level:'WARN'|'CRITICAL'}|null=null
  private lastReason='Relógio ainda não verificado.'
  constructor(private readonly db:Db,config:Partial<ClockConfig>={},private readonly deps:Deps={}){
    this.config={...clockConfigFromEnv({}),...config}
    this.query=deps.query??sntpQuery
    this.now=deps.now??Date.now
    this.mono=deps.mono??(()=>Number(process.hrtime.bigint())/1e6)
    this.lastWall=this.now();this.lastMono=this.mono()
  }
  get settings():ClockConfig{return this.config}
  close():void{
    this.closed=true
    for(const socket of this.sockets)try{socket.close()}catch{}
    this.sockets.clear()
  }

  status():ClockStatus{
    const {warnMs,criticalMs,unverifiedRounds,jumpMs}=this.config
    return {checkedAt:this.checkedAt,state:this.state(),offsetMs:this.offsetMs===null?null:round(this.offsetMs),rttMs:this.rttMs===null?null:round(this.rttMs),
      servers:this.servers.map(s=>({...s,offsetMs:s.offsetMs===null?null:round(s.offsetMs),rttMs:s.rttMs===null?null:round(s.rttMs)})),
      platform:this.platform,thresholds:{warnMs,criticalMs,unverifiedRounds,jumpMs},consecutiveFailedRounds:this.failedRounds,jump:this.jump,reason:this.lastReason}
  }

  private state():ClockState{
    const abs=this.offsetMs===null?null:Math.abs(this.offsetMs)
    if(abs!==null&&abs>this.config.criticalMs)return 'CRITICAL'
    if(abs!==null&&abs>this.config.warnMs)return 'WARN'
    if(this.jump)return 'WARN'
    if(this.offsetMs===null||this.failedRounds>=this.config.unverifiedRounds)return 'UNVERIFIED'
    return 'OK'
  }

  /** Compara parede e monotônico desde a última chamada. Barato, sem rede. */
  checkJump():boolean{
    const wall=this.now(),mono=this.mono()
    const jump=(wall-this.lastWall)-(mono-this.lastMono)
    this.lastWall=wall;this.lastMono=mono
    if(Math.abs(jump)<=this.config.jumpMs)return false
    this.jump={detectedAt:new Date(wall).toISOString(),jumpMs:round(jump)}
    this.lastReason=`Relógio do servidor saltou ${round(jump)} ms.`
    // O offset medido antes do salto já não vale.
    this.offsetMs=null;this.rttMs=null
    this.reconcile()
    return true
  }

  /** Uma rodada: SNTP em todos os servidores, plataforma, avaliação. */
  async round():Promise<ClockStatus>{
    if(this.closed||this.running)return this.status()
    this.running=true
    try{
      this.checkJump()
      const results=await Promise.all(this.config.servers.map(server=>measureServer(server,this.config,this.query,this.now,this.sockets,()=>this.closed)))
      if(this.closed)return this.status()
      // O salto também pode ter ocorrido durante a rodada.
      this.checkJump()
      this.servers=results
      this.checkedAt=new Date(this.now()).toISOString()
      const good=results.filter(r=>r.ok)
      if(good.length){
        this.failedRounds=0
        this.offsetMs=median(good.map(r=>r.offsetMs!))
        this.rttMs=median(good.map(r=>r.rttMs!))
        // Medida nova depois do salto: o estado volta a refletir o desvio real.
        this.jump=null
        const abs=Math.abs(this.offsetMs)
        this.lastReason=abs>this.config.criticalMs?`Relógio do servidor ${round(this.offsetMs)} ms fora (limite crítico ${this.config.criticalMs} ms).`
          :abs>this.config.warnMs?`Relógio do servidor ${round(this.offsetMs)} ms fora (aviso acima de ${this.config.warnMs} ms).`
          :`Relógio do servidor dentro de ${this.config.warnMs} ms (${round(this.offsetMs)} ms).`
      }else{
        this.failedRounds++
        if(this.failedRounds>=this.config.unverifiedRounds){
          this.offsetMs=null;this.rttMs=null
          this.lastReason=`Relógio não verificado: nenhum servidor NTP respondeu em ${this.failedRounds} rodadas. O firewall precisa liberar saída UDP 123.`
        }else this.lastReason=`Nenhum servidor NTP respondeu nesta rodada (${this.failedRounds}/${this.config.unverifiedRounds}).`
      }
      try{this.platform=await readPlatformClock({exec:this.deps.exec,platform:this.deps.platformName})}catch{/* informação complementar */}
      this.reconcile()
    }finally{this.running=false}
    return this.status()
  }

  // ------------------------------------------------------- incidentes ----
  /** Nível de incidente para o estado atual; null = sem incidente. */
  private wanted():'WARN'|'CRITICAL'|null{
    const state=this.state()
    if(state==='CRITICAL')return 'CRITICAL'
    if(state==='WARN')return 'WARN'
    // Sem verificação: AVISO somente depois das rodadas configuradas; antes
    // da primeira rodada concluída não há incidente.
    if(state==='UNVERIFIED'&&this.failedRounds>=this.config.unverifiedRounds)return 'WARN'
    return null
  }

  private reconcile():void{
    if(this.closed)return
    try{
      this.adoptOpenIncident()
      const wanted=this.wanted(),open=this.incident
      const verifiedOk=this.state()==='OK'
      if(wanted&&!open)this.open(wanted)
      else if(wanted==='CRITICAL'&&open&&open.level==='WARN')this.escalate(open)
      else if(!wanted&&open&&verifiedOk)this.recover(open)
      // UNVERIFIED sem NENHUM desvio medido mantém aberto o que já está aberto:
      // sem medida nova não há prova de recuperação.
    }catch(error){this.deps.log?.(`Monitor de relógio: incidente não gravado: ${error instanceof Error?error.message:String(error)}`)}
  }

  /** Reinício do servidor com incidente aberto: retoma, não duplica. */
  private adoptOpenIncident():void{
    if(this.adopted)return;this.adopted=true
    if(this.deps.persist===false)return
    const rows=this.db.select().from(healthEvents).where(and(eq(healthEvents.component,'CLOCK'),like(healthEvents.id,'clock:drift:%:active'),isNull(healthEvents.resolvedAt))).all()
    const row=rows.sort((a,b)=>a.occurredAt<b.occurredAt?1:-1)[0]
    if(!row)return
    const seq=row.id.slice('clock:drift:'.length,-':active'.length)
    const critical=this.db.select().from(healthEvents).where(and(eq(healthEvents.id,`clock:drift:${seq}:critical`),isNull(healthEvents.resolvedAt))).get()
    this.incident={seq,level:critical?'CRITICAL':'WARN'}
  }

  private payload(extra:Record<string,unknown>={}){
    return {state:this.state(),offsetMs:this.offsetMs===null?null:round(this.offsetMs),rttMs:this.rttMs===null?null:round(this.rttMs),reason:this.lastReason,
      thresholds:{warnMs:this.config.warnMs,criticalMs:this.config.criticalMs},jump:this.jump,checkedAt:this.checkedAt,...extra}
  }
  private record(id:string,state:string,severity:'INFO'|'WARN'|'CRITICAL',occurredAt:string):void{
    if(this.deps.persist===false)return
    this.db.insert(healthEvents).values({id,channelId:null,component:'CLOCK',state,severity,message:this.lastReason,occurredAt}).onConflictDoNothing().run()
  }
  private notify(event:'clock.drift'|'clock.recovered',payload:Record<string,unknown>):void{
    if(this.deps.persist===false&&!this.deps.emit)return
    void (this.deps.emit??emitIntegrationEvent)(this.db,event,payload,null)
  }
  private stateLabel():string{
    return this.state()==='UNVERIFIED'?'unverified':this.jump&&this.state()==='WARN'&&(this.offsetMs===null||Math.abs(this.offsetMs)<=this.config.warnMs)?'jump':this.state().toLowerCase()
  }

  /** ids: `clock:drift:<seq>:active|critical|recovered`. O <seq> é único por
   * ocorrência (health_events.id é chave primária; um id fixo só abriria uma vez). */
  private open(level:'WARN'|'CRITICAL'):void{
    const at=new Date(this.now()).toISOString(),seq=`${Date.parse(at)}-${randomUUID().slice(0,8)}`
    this.record(`clock:drift:${seq}:active`,this.stateLabel(),level,at)
    if(level==='CRITICAL')this.record(`clock:drift:${seq}:critical`,'critical','CRITICAL',at)
    this.incident={seq,level}
    this.notify('clock.drift',this.payload({incidentId:`clock:drift:${seq}:active`,severity:level}))
  }
  private escalate(open:{seq:string;level:'WARN'|'CRITICAL'}):void{
    const at=new Date(this.now()).toISOString()
    this.record(`clock:drift:${open.seq}:critical`,'critical','CRITICAL',at)
    open.level='CRITICAL'
    this.notify('clock.drift',this.payload({incidentId:`clock:drift:${open.seq}:active`,severity:'CRITICAL'}))
  }
  private recover(open:{seq:string}):void{
    const at=new Date(this.now()).toISOString()
    this.record(`clock:drift:${open.seq}:recovered`,'recovered','INFO',at)
    if(this.deps.persist!==false)for(const suffix of ['active','critical'])this.db.update(healthEvents).set({resolvedAt:at}).where(and(eq(healthEvents.id,`clock:drift:${open.seq}:${suffix}`),isNull(healthEvents.resolvedAt))).run()
    this.incident=null
    this.notify('clock.recovered',this.payload({incidentId:`clock:drift:${open.seq}:active`,severity:'INFO'}))
  }
}

const round=(value:number)=>Math.round(value*10)/10

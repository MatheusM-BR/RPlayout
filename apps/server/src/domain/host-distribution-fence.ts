import {spawn,type ChildProcess} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {z} from 'zod'
import {nativeSocketDiagnosticSchema,hostNativeFailureReasonSchema,type HostNativeQueryFailure} from '@rplayout/protocol'

const pid=z.number().int().positive().max(0xffffffff)
const base={version:z.literal(1),nonce:z.string().regex(/^[a-f\d]{64}$/i)}
const requestId=z.string().min(1).max(64)
const processToken=z.string().min(1).max(64).regex(/^[a-z\d-]+$/i)
const binding=z.object({protocol:z.enum(['TCP','UDP']),family:z.union([z.literal(4),z.literal(6)]),port:z.number().int().min(1).max(65535),pid,included:z.boolean().nullable()}).strict()
export type HostSocketBinding=z.infer<typeof binding>
const frames=z.discriminatedUnion('event',[
  z.object({...base,event:z.literal('ready'),parentPid:pid,guardPid:pid,jobBound:z.literal(true),hostExclusive:z.literal(true)}).strict(),
  z.object({...base,event:z.literal('blocked'),reason:z.literal('HOST_DISTRIBUTION_BUSY')}).strict(),
  z.object({...base,event:z.literal('asserted'),requestId,parentPid:pid,guardPid:pid,activeProcesses:z.number().int().positive().max(4096),processPids:z.array(pid).min(1).max(4096)}).strict(),
  z.object({...base,event:z.literal('membership'),requestId,included:z.boolean().nullable()}).strict(),
  z.object({...base,event:z.literal('ports'),requestId,bindings:z.array(binding).max(4096)}).strict(),
  z.object({...base,event:z.literal('pinned'),requestId,processToken}).strict(),
  z.object({...base,event:z.literal('process_ports'),requestId,processToken,bindings:z.array(binding).max(4096)}).strict(),
  z.object({...base,event:z.literal('process_released'),requestId,processToken}).strict(),
  z.object({...base,event:z.literal('draining'),requestId}).strict(),
  z.object({...base,event:z.literal('unavailable'),requestId,reason:hostNativeFailureReasonSchema.exclude(['REQUEST_TIMEOUT']),socketDiagnostic:nativeSocketDiagnosticSchema.optional()}).strict(),
  z.object({...base,event:z.literal('refused'),requestId:requestId.optional(),reason:z.enum(['PRIVATE_PROTOCOL_INVALID','PRIVATE_BINDING_CHANGED','PRIVATE_OPERATION_INVALID'])}).strict(),
])
type Frame=z.infer<typeof frames>
type State='UNCLAIMED'|'CONNECTING'|'READY'|'BUSY'|'UNAVAILABLE'|'DRAINING'|'CLOSED'
const failure=()=>new Error('Posse nativa do computador não confirmada; nenhum novo recurso será aberto.')
export class HostNativeQueryError extends Error {
  constructor(readonly diagnostic:HostNativeQueryFailure){super('Posse nativa do computador não confirmada; nenhum novo recurso será aberto.');this.name='HostNativeQueryError'}
}
export interface HostProcessIdentity {readonly pid:number;readonly token:string}
/** IPC client for the machine-wide native broker. No fallback lockfile, TTL,
 * shell, fake owner, PID kill or process-wide credential inheritance. Integration
 * must acquire it before publishers/configuration/native channel construction. */
export class HostDistributionFence {
  private state:State='UNCLAIMED'
  private child:ChildProcess|null=null
  private nonce=randomBytes(32).toString('hex')
  private attempt:Promise<boolean>|null=null
  private admitted:((ready:boolean)=>void)|null=null
  private admissionTimer:ReturnType<typeof setTimeout>|null=null
  private buffer=''
  private pending=new Map<string,{event:string;action:HostNativeQueryFailure['operation'];resolve:(frame:Frame)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  private nativeQueryFailure:HostNativeQueryFailure|null=null
  private processes=new Map<string,HostProcessIdentity>()
  private processReservations=new Set<string>()
  constructor(private readonly binary:string,private readonly timeoutMs=5000){}
  status(){let owned=false;try{this.assertOwned();owned=true}catch{}return{state:this.state==='READY'&&!owned?'UNAVAILABLE':this.state,ownedHere:owned,blocked:!owned,message:owned?null:'Distribuição do computador não está sob controle confirmado desta instância. Configuração e novos processos estão bloqueados.',nativeQueryFailure:this.nativeQueryFailure?structuredClone(this.nativeQueryFailure):null,physicalOutputValidated:false,promotionReady:false}}
  private cancelAdmission(ready:boolean){if(this.admissionTimer)clearTimeout(this.admissionTimer);this.admissionTimer=null;this.admitted?.(ready);this.admitted=null}
  private cancelRequests(){for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(failure())}this.pending.clear()}
  private unavailable(state:State='UNAVAILABLE'){if(this.state==='CLOSED')return;this.state=state;this.cancelAdmission(false);this.cancelRequests();if(!this.child?.stdin?.writableEnded)this.child?.stdin?.end()}
  assertOwned(){if(this.state!=='READY'||!this.child?.pid||this.child.killed||this.child.exitCode!==null||this.child.signalCode!==null)throw failure()}
  acquire():Promise<boolean>{
    if(this.state==='CLOSED')return Promise.resolve(false)
    if(this.attempt)return this.state==='CONNECTING'?this.attempt:Promise.resolve(this.status().ownedHere)
    if(!this.binary||!Number.isFinite(this.timeoutMs)||this.timeoutMs<1){this.unavailable();return this.attempt=Promise.resolve(false)}
    this.state='CONNECTING'
    const attempt=new Promise<boolean>(resolve=>{this.admitted=resolve;this.admissionTimer=setTimeout(()=>this.unavailable(),this.timeoutMs)})
    this.attempt=attempt
    try{
      // detached excludes the broker from Node's own kill-on-parent-exit job.
      // Its explicitly admitted parent/future descendants remain in the native
      // kernel job. Hide the window; the nonce crosses only our private pipe.
      const child=spawn(this.binary,[],{windowsHide:true,detached:true,stdio:['pipe','pipe','pipe'],env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.WINDIR?{WINDIR:process.env.WINDIR}:{})}})
      this.child=child
      child.stdout?.on('data',(chunk:Buffer)=>{
        if(this.child!==child||this.state==='CLOSED')return
        this.buffer+=chunk.toString('utf8')
        if(this.buffer.length>65536){this.unavailable('DRAINING');this.buffer='';return}
        let end:number
        while((end=this.buffer.indexOf('\n'))!==-1){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(line.trim())this.receive(line)}
      })
      child.stdout?.on('end',()=>{if(this.child===child&&!['BUSY','CLOSED'].includes(this.state))this.unavailable()})
      child.stderr?.on('data',()=>{/* Drain, never expose private diagnostics/nonce. */})
      child.on('error',()=>{if(this.child===child)this.unavailable()})
      child.on('exit',()=>{if(this.child===child&&!['BUSY','CLOSED'].includes(this.state))this.unavailable()})
      child.stdin?.on('error',()=>{if(this.child===child)this.unavailable()})
      if(!child.stdin||!child.stdout){this.unavailable();return attempt}
      child.stdin.write(JSON.stringify({version:1,nonce:this.nonce,action:'acquire'})+'\n')
    }catch{this.unavailable()}
    return attempt
  }
  private receive(line:string){
    let frame:Frame
    try{frame=frames.parse(JSON.parse(line))}catch{this.unavailable('DRAINING');return}
    if(frame.nonce!==this.nonce){this.unavailable('DRAINING');return}
    if(frame.event==='ready'){
      if(this.state!=='CONNECTING'||frame.parentPid!==process.pid||frame.guardPid!==this.child?.pid||this.child.killed||this.child.exitCode!==null||this.child.signalCode!==null){this.unavailable('DRAINING');return}
      this.state='READY';this.cancelAdmission(true);return
    }
    if(frame.event==='blocked'){
      if(this.state!=='CONNECTING'){this.unavailable('DRAINING');return}
      this.unavailable('BUSY');return
    }
    if(frame.event==='refused'||frame.event==='draining'){this.unavailable('DRAINING');return}
    if(this.state!=='READY'||!('requestId' in frame)){this.unavailable('DRAINING');return}
    const request=this.pending.get(frame.requestId)
    // An expired response is not a new admission and cannot satisfy a later
    // request. IDs are independent of nonce/PID reuse and never recycled.
    if(!request)return
    clearTimeout(request.timer);this.pending.delete(frame.requestId)
    if(frame.event==='unavailable'){
      if(frame.socketDiagnostic&&(frame.reason!=='PORT_OWNERSHIP_UNAVAILABLE'||!['ports','process_ports'].includes(request.action))){request.reject(failure());this.unavailable('DRAINING');return}
      this.nativeQueryFailure={reason:frame.reason,operation:request.action,observedAt:new Date().toISOString(),...(frame.socketDiagnostic?{socketDiagnostic:frame.socketDiagnostic}:{})}
      request.reject(new HostNativeQueryError(structuredClone(this.nativeQueryFailure)));return
    }
    if(request.event!==frame.event){request.reject(failure());this.unavailable('DRAINING');return}
    // Ownership proof, pin or another process query cannot erase a failed
    // socket operation. A late response never reaches this correlated branch.
    if(this.nativeQueryFailure?.operation===request.action)this.nativeQueryFailure=null
    request.resolve(frame)
  }
  private request(action:HostNativeQueryFailure['operation'],event:string,extra:Record<string,unknown>={}):Promise<Frame>{
    try{this.assertOwned()}catch{return Promise.reject(failure())}
    const id=randomUUID()
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.nativeQueryFailure={reason:'REQUEST_TIMEOUT',operation:action,observedAt:new Date().toISOString()};reject(new HostNativeQueryError(structuredClone(this.nativeQueryFailure)))},this.timeoutMs)
      this.pending.set(id,{event,action,resolve,reject,timer})
      try{this.child!.stdin!.write(JSON.stringify({...extra,version:1,nonce:this.nonce,action,request_id:id})+'\n')}catch{this.unavailable()}
    })
  }
  async freshProof(){
    const child=this.child,frame=await this.request('assert','asserted');this.assertOwned()
    if(this.child!==child||frame.event!=='asserted'||frame.parentPid!==process.pid||frame.guardPid!==child?.pid||frame.activeProcesses!==frame.processPids.length||new Set(frame.processPids).size!==frame.processPids.length||!frame.processPids.includes(process.pid)||frame.processPids.includes(frame.guardPid)){this.unavailable('DRAINING');throw failure()}
  }
  async socketBindings():Promise<HostSocketBinding[]>{
    const child=this.child,frame=await this.request('ports','ports');this.assertOwned()
    if(this.child!==child||frame.event!=='ports')throw failure()
    for(const row of frame.bindings){const relevant=row.protocol==='TCP'?[1935,8554,8888,8889,9997]:[8890,8189,8000,8001];if(!relevant.includes(row.port)){this.unavailable('DRAINING');throw failure()}}
    return frame.bindings
  }
  async pinProcess(childPid:number,token:string):Promise<HostProcessIdentity>{
    pid.parse(childPid);processToken.parse(token)
    if(this.processes.has(token)||this.processReservations.has(token))throw failure()
    this.processReservations.add(token)
    try{
      const frame=await this.request('pin','pinned',{pid:childPid,process_token:token});this.assertOwned()
      if(frame.event!=='pinned'||frame.processToken!==token){this.unavailable('DRAINING');throw failure()}
      const identity=Object.freeze({pid:childPid,token});this.processes.set(token,identity);return identity
    }finally{this.processReservations.delete(token)}
  }
  async processBindings(identity:HostProcessIdentity):Promise<HostSocketBinding[]>{
    if(!identity||this.processes.get(identity.token)!==identity)throw failure()
    const frame=await this.request('process_ports','process_ports',{process_token:identity.token});this.assertOwned()
    if(frame.event!=='process_ports'||frame.processToken!==identity.token){this.unavailable('DRAINING');throw failure()}
    if(this.processes.get(identity.token)!==identity)throw failure()
    for(const row of frame.bindings){const relevant=row.protocol==='TCP'?[1935,8554,8888,8889,9997]:[8890,8189,8000,8001];if(!relevant.includes(row.port)){this.unavailable('DRAINING');throw failure()}}
    return frame.bindings
  }
  async releaseProcess(identity:HostProcessIdentity){
    if(this.processes.get(identity.token)!==identity)return
    this.processes.delete(identity.token)
    const frame=await this.request('release_process','process_released',{process_token:identity.token})
    if(frame.event!=='process_released'||frame.processToken!==identity.token)throw failure()
  }
  async assertPortsAvailable(identity?:HostProcessIdentity){
    const rows=identity?await this.processBindings(identity):await this.socketBindings()
    if(rows.some(row=>row.pid!==identity?.pid||row.included!==true))throw new Error('Portas da distribuição ocupadas por processo alheio ou inconclusivo. Nenhum arquivo será substituído.')
  }
  async mediaReady(identity:HostProcessIdentity):Promise<boolean>{
    try{
      const rows=await this.processBindings(identity)
      return rows.every(row=>row.pid===identity.pid&&row.included===true)&&[1935,8554,8888,8889,9997].every(port=>rows.some(row=>row.protocol==='TCP'&&row.port===port))&&rows.some(row=>row.protocol==='UDP'&&row.port===8890)
    }catch{return false}
  }
  close(){
    if(this.state==='CLOSED')return
    this.state='CLOSED';this.cancelAdmission(false);this.cancelRequests()
    this.processes.clear()
    this.processReservations.clear()
    // Never kill the broker or prematurely release its job. It drains only
    // after actual parent/descendant exit. Unref permits graceful Node exit.
    this.child?.stdin?.end();this.child?.stdout?.destroy();this.child?.stderr?.destroy();this.child?.unref()
  }
}

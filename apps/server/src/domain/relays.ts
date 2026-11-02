import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { DiagnosticLines, sanitizeDiagnostic } from './sanitize-diagnostic.js'
import { sourceAddress } from './source-wire.js'
import { mediaProcessEnvironment } from './media-process-environment.js'
import {randomUUID} from 'node:crypto'
import type {NativeResourceGuard} from './distribution-ownership.js'

function parsed(url: string): URL | null {
  try { return new URL(url) } catch { return null }
}
function transportOf(url: string): 'SRT' | 'RTMP' | 'OTHER' {
  const protocol = parsed(url)?.protocol.toLowerCase()
  if (protocol === 'srt:') return 'SRT'
  if (protocol === 'rtmp:' || protocol === 'rtmps:') return 'RTMP'
  return 'OTHER'
}
function modeOf(url: string): 'CALLER' | 'LISTENER' | 'RENDEZVOUS' | 'UNKNOWN' {
  const value = parsed(url)?.searchParams.get('mode')?.toUpperCase()
  return value === 'CALLER' || value === 'LISTENER' || value === 'RENDEZVOUS' ? value : 'UNKNOWN'
}
function latencyOf(url: string): number | null {
  const value = Number(parsed(url)?.searchParams.get('latency'))
  return Number.isFinite(value) && value >= 0 ? value : null
}
export function redactUrl(url: string): string {
  return sourceAddress(url)
}

export interface RelayTarget {
  readonly channelId?:string
  readonly id: string
  readonly name: string
  readonly url: string
  readonly source: string
  /** Parâmetros operacionais do destino SRT; não contém senha. */
  readonly transport?: 'SRT' | 'RTMP' | 'OTHER'
  readonly mode?: 'CALLER' | 'LISTENER' | 'RENDEZVOUS' | 'UNKNOWN'
  readonly latencyMs?: number | null
  readonly primary?: boolean
  readonly backupFor?: string | null
}

export type RelayState = 'CONECTANDO' | 'NO AR' | 'CAIU' | 'FALHOU'

/** Só a confirmação de entrega autoriza desligar o backup. */
export const primaryHealthy = (state: RelayState | undefined): boolean => state === 'NO AR'

export interface RelayStatus {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly state: RelayState
  readonly attempts: number
  readonly reason: string | null
  /** Buffers entregues ao destino. Cresce enquanto o sinal está passando. */
  readonly delivered: number
  /** Fluxos que a origem ofereceu, como o relay os classificou. */
  readonly streams: readonly string[]
  readonly transport: 'SRT' | 'RTMP' | 'OTHER'
  readonly mode: 'CALLER' | 'LISTENER' | 'RENDEZVOUS' | 'UNKNOWN'
  readonly latencyMs: number | null
  readonly rttMs: number | null
  readonly lossPct: number | null
  readonly bitrateKbps: number | null
  readonly primary: boolean
  readonly backupFor: string | null
  readonly fencing?:{enabled:boolean;confirmed:boolean;lastConfirmedAt:string|null;physicalOutputValidated:false}
}

interface Relay {
  target: RelayTarget
  child: ChildProcess
  state: RelayState
  attempts: number
  reason: string | null
  delivered: number
  streams: string[]
  rttMs: number | null
  lossPct: number | null
  bitrateKbps: number | null
  nextRetryAt: number
  exited:boolean
  stopping:boolean
  fenceOwner:string|null
  fencePending:boolean
  fenceConfirmed:boolean
  fenceConfirmedAt:string|null
}
export interface RelayAuthority {
  binding:(target:RelayTarget)=>{ownerId:string;term:number;obtain:(consumerId:string,nonce:number)=>Promise<{term:number;ttlMs:number}>}|null
}

/**
 * Um processo por destino externo.
 *
 * É o isolamento que importa: um destino cair não pode tocar no encoder, nos
 * outros destinos nem na saída SDI. Como cada um vive no próprio processo,
 * não tem como tocar.
 */
export class RelaySupervisor {
  private closed=false
  private readonly relays = new Map<string, Relay>()
  private desired = new Map<string, RelayTarget>()

  constructor(private readonly binary: string,private readonly ownership?:NativeResourceGuard,private readonly sourceReady?:()=>boolean,private readonly authority?:RelayAuthority) {}
  private stopRelay(relay:Relay){if(relay.stopping||relay.exited)return;relay.stopping=true;relay.child.kill()}

  /** Faz os processos baterem com a lista de destinos ligados. */
  sync(targets: readonly RelayTarget[]): void {
    if(this.closed)throw new Error('Supervisor de retransmissões encerrado.')
    if (this.binary === '') return
    this.ownership?.claim();this.ownership?.assertOwned()
    if(this.sourceReady&&!this.sourceReady())throw new Error('Origem local não foi confirmada; retransmissões existentes preservadas.')

    const wanted = new Map(targets.map((target) => [target.id, target]))
    this.desired = wanted

    for (const [id, relay] of this.relays) {
      const target = wanted.get(id)
      // Destino removido ou com endereço trocado: o processo antigo não serve.
      if (!target || target.channelId!==relay.target.channelId||target.url !== relay.target.url || target.source !== relay.target.source || this.authority&&this.authority.binding(target)?.ownerId!==relay.fenceOwner) {
        this.stopRelay(relay)
        if(relay.exited)this.relays.delete(id)
      }
    }

    for (const target of targets.filter((candidate) => candidate.primary !== false && !candidate.backupFor)) {
      const current = this.relays.get(target.id)
      // Um processo que terminou não volta sozinho. A próxima sincronização
      // deve substituí-lo, mantendo a supervisão viva após uma queda.
      if (current && (current.state === 'FALHOU' || current.state === 'CAIU' || current.exited)) {
        this.stopRelay(current)
        if(current.exited)this.relays.delete(target.id)
      }
      if (this.relays.has(target.id)) continue
      this.spawn(target, target.source)
    }
  }

  private spawn(target: RelayTarget, source: string): void {
    if(this.closed)throw new Error('Supervisor de retransmissões encerrado.')
    if(this.sourceReady&&!this.sourceReady())throw new Error('Origem local não foi confirmada; nenhum novo relay será aberto.')
    const binding=this.authority?.binding(target)
    if(this.authority&&!binding)return
    const consumerId=binding?randomUUID():null
    const resource='RELAY:'+target.id,token=randomUUID()
    this.ownership?.assertOwned();this.ownership?.beforeSpawn(resource,token)
    let child:ChildProcess
    try{child = spawn(this.binary, ['--private-connection-stdin'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: mediaProcessEnvironment(),
    })}catch(error){try{this.ownership?.exited(resource,null,token)}catch{}throw error}

    const relay: Relay = {
      target,
      child,
      state: 'CONECTANDO',
      attempts: 0,
      reason: null,
      delivered: 0,
      streams: [],
      rttMs: null,
      lossPct: null,
      bitrateKbps: null,
      nextRetryAt: 0,
      exited:false,stopping:false,
      fenceOwner:binding?.ownerId??null,fencePending:false,
      fenceConfirmed:false,fenceConfirmedAt:null,
    }
    this.relays.set(target.id, relay)
    child.on('error', (error) => {
      if(child.pid===undefined){try{this.ownership?.exited(resource,null,token)}catch{}relay.exited=true}
      if (this.relays.get(target.id) !== relay) return
      relay.state = 'FALHOU'
      relay.reason = `Não foi possível iniciar o relay: ${error.message}`
    })
    child.stdin?.on('error', () => {
      if (this.relays.get(target.id) !== relay) return
      relay.state = 'FALHOU'
      relay.reason = 'A conexão privada com o relay fechou; aguardando nova tentativa.'
      child.kill()
    })

    if (child.stdout) {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if(this.closed||relay.stopping||this.relays.get(target.id)!==relay)return
        if (line.trim() === '') return
        try {
          const event = JSON.parse(line) as {
            event: string
            attempt?: number
            reason?: string
            message?: string
            sink?: number
            streams?: string[]
            rttMs?: number
            lossPct?: number
            bitrateKbps?: number
            ownerId?:string
            nonce?:number
            term?:number
          }
          switch (event.event) {
            case 'fenceApplied':{
              if(binding&&event.term===binding.term&&Number.isSafeInteger(event.nonce)&&event.nonce!>0){relay.fenceConfirmed=true;relay.fenceConfirmedAt=new Date().toISOString()}
              break
            }
            case 'fenceRequest':{
              if(!binding||!consumerId||event.ownerId!==consumerId||!Number.isSafeInteger(event.nonce)||event.nonce!<=0||relay.fencePending)break
              const current=this.authority?.binding(target)
              if(!current||current.ownerId!==binding.ownerId||current.term!==binding.term){this.stopRelay(relay);break}
              this.ownership?.assertOwned()
              if(this.sourceReady&&!this.sourceReady())break
              relay.fencePending=true
              const nonce=event.nonce!
              void current.obtain(consumerId,nonce).then(grant=>{
                if(this.closed||relay.stopping||relay.exited||this.relays.get(target.id)!==relay)return
                const fresh=this.authority?.binding(target)
                if(!fresh||fresh.ownerId!==binding.ownerId||fresh.term!==binding.term||grant.term!==binding.term){this.stopRelay(relay);return}
                this.ownership?.assertOwned()
                if(this.sourceReady&&!this.sourceReady())return
                child.stdin?.write(JSON.stringify({cmd:'fenceGrant',ownerId:consumerId,nonce,term:grant.term,ttlMs:grant.ttlMs})+'\n')
              }).catch(()=>{if(!relay.stopping&&!relay.exited)relay.reason='Concessão do relay não confirmada; publicação expirará nativamente.'}).finally(()=>{relay.fencePending=false})
              break
            }
            case 'connecting':
              relay.state = 'CONECTANDO'
              relay.attempts = event.attempt ?? relay.attempts
              relay.nextRetryAt = 0
              break
            case 'assembled':
              relay.streams = event.streams ?? []
              break
            case 'connected':
              relay.state = 'NO AR'
              relay.reason = null
              break
            case 'flow':
              // Entregue de verdade, não "conectado": é o número que diz se o
              // destino está recebendo alguma coisa.
              relay.delivered = event.sink ?? relay.delivered
              relay.rttMs = event.rttMs ?? relay.rttMs
              relay.lossPct = event.lossPct ?? relay.lossPct
              relay.bitrateKbps = event.bitrateKbps ?? relay.bitrateKbps
              break
            case 'disconnected':
              relay.state = 'CAIU'
              relay.reason = event.reason ?? null
              relay.nextRetryAt = Date.now() + retryDelay(relay.attempts)
              break
            case 'fatal':
              relay.state = 'FALHOU'
              relay.reason = event.message ?? null
              relay.nextRetryAt = Date.now() + retryDelay(relay.attempts)
              break
            default:
              break
          }
        } catch {
          // Linha malformada não derruba a supervisão.
        }
      })
    }
    const diagnostics = new DiagnosticLines(line => process.stderr.write(`[relay ${sanitizeDiagnostic(target.name)}] ${line}\n`))
    child.stderr?.on('data', (chunk: Buffer) => diagnostics.write(chunk))
    child.stderr?.on('end', () => diagnostics.end())
    child.on('exit', () => {
      try{this.ownership?.exited(resource,child.pid??null,token)}catch{}
      relay.exited=true
      const current = this.relays.get(target.id)
      if(current===relay&&(relay.stopping||!this.desired.has(target.id))){this.relays.delete(target.id);return}
      if (current?.child === child) current.state = 'FALHOU'
      if (current?.child === child) current.nextRetryAt = Date.now() + retryDelay(current.attempts)
    })
    try{
      this.ownership?.spawned(resource,child.pid??null,token);this.ownership?.assertOwned()
      const config=JSON.stringify({from:source,to:target.url,...(consumerId?{fenceOwner:consumerId}:{})})+'\n'
      if(consumerId)child.stdin?.write(config);else child.stdin?.end(config)
    }
    catch(error){this.stopRelay(relay);throw error}
  }

  /** Reabre apenas um destino que caiu, com backoff exponencial limitado. */
  tick(now = Date.now()): void {
    if(this.sourceReady&&!this.sourceReady())return
    if(this.closed||this.binary==='')return
    if(this.ownership)try{this.ownership.assertOwned()}catch{return}
    if(this.authority)for(const relay of this.relays.values())if(this.authority.binding(relay.target)?.ownerId!==relay.fenceOwner)this.stopRelay(relay)
    for (const [id, relay] of this.relays) {
      if (relay.state !== 'CAIU' && relay.state !== 'FALHOU') continue
      if (relay.nextRetryAt > now) continue
      if(!relay.exited){this.stopRelay(relay);continue}
      this.relays.delete(id)
    }
    for(const target of this.desired.values()){
      if(target.primary===false||target.backupFor||this.relays.has(target.id))continue
      if(this.ownership&&!this.ownership.canSpawn('RELAY:'+target.id))continue
      this.spawn(target,target.source)
    }
    // Failover N+1: o backup só assume quando o primário está realmente
    // caído. Enquanto o primário voltar, não há dois encoders transmitindo.
    for (const primary of this.desired.values()) {
      if (primary.primary === false || primary.backupFor) continue
      const primaryRelay = this.relays.get(primary.id)
      const backup = [...this.desired.values()].find((candidate) => candidate.backupFor === primary.id)
      if (!backup) continue
      const backupRelay = this.relays.get(backup.id)
      const healthy = primaryHealthy(primaryRelay?.state)
      const failed = !healthy
      if (failed && !backupRelay) {
        if(this.ownership&&!this.ownership.canSpawn('RELAY:'+backup.id))continue
        this.spawn(backup, backup.source)
      } else if (healthy && backupRelay) {
        this.stopRelay(backupRelay)
        if(backupRelay.exited)this.relays.delete(backup.id)
      }
    }
  }

  status(): RelayStatus[] {
    return [...this.relays.values()].map((relay) => ({
      id: relay.target.id,
      name: relay.target.name,
      url: redactUrl(relay.target.url),
      state: relay.state,
      attempts: relay.attempts,
      reason: relay.reason === null ? null : sanitizeDiagnostic(relay.reason),
      delivered: relay.delivered,
      streams: relay.streams,
      transport: relay.target.transport ?? transportOf(relay.target.url),
      mode: relay.target.mode ?? modeOf(relay.target.url),
      latencyMs: relay.target.latencyMs ?? latencyOf(relay.target.url),
      rttMs: relay.rttMs,
      lossPct: relay.lossPct,
      bitrateKbps: relay.bitrateKbps,
      primary: relay.target.primary ?? true,
      backupFor: relay.target.backupFor ?? null,
      fencing:{enabled:relay.fenceOwner!==null,confirmed:relay.fenceConfirmed&&!relay.exited&&!relay.stopping,lastConfirmedAt:relay.fenceConfirmedAt,physicalOutputValidated:false as const},
    }))
  }

  closeAll(): void {
    this.closed=true;this.desired.clear()
    for (const relay of this.relays.values())this.stopRelay(relay)
  }
}

function retryDelay(attempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(5, Math.max(0, attempts)))
}

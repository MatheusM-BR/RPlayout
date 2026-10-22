import { spawn, type ChildProcess } from 'node:child_process'
import { DiagnosticLines, sanitizeDiagnostic } from './sanitize-diagnostic.js'
import { mediaMtxProcessEnvironment } from './media-process-environment.js'
import { writePrivateConfig } from './private-config-file.js'
import {randomUUID} from 'node:crypto'
import {isIP} from 'node:net'
import type {NativeResourceGuard} from './distribution-ownership.js'
import type {HostDistributionFence,HostProcessIdentity} from './host-distribution-fence.js'

/** Portas do servidor local. Fixas de propósito: são o que se documenta. */
export const PORTS = {
  rtmp: 1935,
  srt: 8890,
  hls: 8888,
  webrtc: 8889,
  /** Só em loopback. A API de controle nunca é aberta no firewall. */
  api: 9997,
  /**
   * Também só em loopback: é por aqui que os relays leem o programa, porque o
   * cliente RTMP do GStreamer não consegue ler do MediaMTX. Caminho interno,
   * não endereço de ninguém.
   */
  rtsp: 8554,
  rtp: 8000,
  rtcp: 8001,
  webrtcUdp: 8189,
} as const

export function mediaListenAddress(bind:string,port:number):string{
  if(!bind||!Number.isInteger(port)||port<1||port>65535||!(isIP(bind)||/^[a-z\d_.-]+$/i.test(bind)))throw new Error('Endereço de escuta de mídia inválido; use nome/IP sem protocolo, porta ou caminho.')
  return `${isIP(bind)===6?`[${bind}]`:bind}:${port}`
}

export interface GuestPath {
  readonly label: string
  readonly streamKey: string
}

export interface ChannelPaths {
  readonly channelId: string
  /** Caminho do programa completo, com grafismo. */
  readonly program: string
  /** Caminho do clean feed, sem a camada de grafismo. */
  readonly clean: string
  /** Caminho do preview: o que o operador olha sem estar no ar. */
  readonly preview: string
  /** QC opt-in, never the normal low-bandwidth monitor. */
  readonly inspection?: string
  /**
   * Caminho do monitor do programa: o mesmo conteúdo do ar, em 240p.
   *
   * Existe para o navegador não ter que decodificar o programa inteiro numa
   * janela de trezentos pixels. Com quatro canais abertos, eram quatro fluxos
   * grandes decodificando ao mesmo tempo na mesma máquina.
   */
  readonly monitor: string
}

export interface MediaMtxOptions {
  readonly binary: string
  readonly configPath: string
  /** Interface em que o servidor escuta. */
  readonly bind: string
  /** Nível de log do servidor. `info` é o que mostra por que uma conexão caiu. */
  readonly logLevel: string
  readonly ownership?:NativeResourceGuard
  readonly hostFence?:HostDistributionFence|null
  readonly requireAppliedConfig?:boolean
  readonly assertAdmission?:()=>Promise<void>
}

/** O que a API do MediaMTX conta sobre um caminho. */
export interface PathStatus {
  readonly name: string
  readonly ready: boolean
  readonly source: string | null
  readonly readers: number
  readonly bytesReceived: number
}

interface ApiPath {
  name: string
  ready: boolean
  source: { type?: string } | null
  readers: unknown[]
  bytesReceived: number
}

/**
 * Caminho legível a partir do nome do canal. Em caso de empate, desempata pelo
 * começo do id -- endereço que o operador digita não pode ser um UUID inteiro,
 * mas também não pode apontar para o canal errado.
 */
export function channelPaths(
  channels: readonly { id: string; name: string }[],
): ChannelPaths[] {
  const used = new Map<string, number>()

  return channels.map((channel) => {
    const base =
      channel.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'canal'

    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    const app = seen === 0 ? base : `${base}-${channel.id.slice(0, 4)}`

    // Endereço RTMP é sempre `app/stream`: um caminho de segmento único não é
    // URL de RTMP válida e o cliente nem chega a conectar.
    return {
      channelId: channel.id,
      program: `${app}/pgm`,
      clean: `${app}/clean`,
      preview: `${app}/pvw`,
      inspection: `${app}/qc`,
      monitor: `${app}/mon`,
    }
  })
}

/**
 * Servidor de mídia local.
 *
 * O engine publica o programa aqui por loopback e nunca fala com a internet. É
 * daqui que sai tudo: quem puxa na LAN, os relays para fora e o ingest dos
 * convidados.
 *
 * Publicar exige um caminho declarado. Caminho não declarado não existe, então
 * não há como publicar sem chave -- e revogar uma chave é removê-la da config.
 */
export class MediaMtx {
  private closed=false
  private child: ChildProcess | null = null
  private readonly ownedChildren=new Set<ChildProcess>()
  private confirmedStop:Promise<{ownedMediaProcessesStopped:boolean}>|null=null
  private starting:Promise<void>|null=null
  private identity:HostProcessIdentity|null=null
  private identityPending:Promise<void>|null=null
  private readyChild:ChildProcess|null=null
  private configured=false
  private restartAt: number | null = null
  private restartStreak = 0
  private configWrite: Promise<void> = Promise.resolve()
  private configWrittenAt: number | null = null
  /**
   * Por que o servidor de mídia não está de pé.
   *
   * Sem isso o operador vê "a saída caiu e está tentando voltar" e não tem como
   * saber que a causa é a porta 1935 ocupada por outro programa -- que é o
   * caso mais comum numa máquina que já teve OBS ou vMix.
   */
  lastError: string | null = null

  constructor(private readonly options: MediaMtxOptions) {mediaListenAddress(options.bind,PORTS.rtsp)}

  get running(): boolean {
    return !this.closed&&this.child !== null&&!this.child.killed&&this.child.exitCode===null&&this.child.signalCode===null
  }
  /** Cached only for synchronous spawn gating. Periodic readiness refresh uses
   * exact native incarnation and sockets; this is not physical signal proof. */
  get readyForPublish():boolean {
    if(!this.running||this.readyChild!==this.child)return false
    try{this.options.ownership?.assertOwned();this.options.hostFence?.assertOwned();return true}catch{return false}
  }

  /** Verdadeiro quando o servidor está aberto para além da rede local. */
  get exposed(): boolean {
    return this.options.bind === '0.0.0.0' || this.options.bind === '::'
  }

  get processId(): number | null {
    return this.child?.pid ?? null
  }

  watchdog(): void {
    if(this.closed)return
    if(this.options.ownership&&!this.options.ownership.canSpawn('MEDIAMTX'))return
    if (this.running) return
    const now = Date.now()
    if (this.restartAt !== null && now < this.restartAt) return
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.restartStreak, 5))
    this.restartAt = now + delay
    this.restartStreak += 1
    void this.start().catch(()=>{this.lastError='Abertura da distribuição não foi autorizada; processos existentes preservados.'})
  }

  /**
   * Reescreve a config. O MediaMTX observa o próprio arquivo e recarrega, então
   * criar ou revogar uma chave não derruba quem está no ar.
   */
  async apply(channels: readonly ChannelPaths[], guests: readonly GuestPath[],selectedPaths?:readonly string[]): Promise<void> {
    if(this.closed)throw new Error('Servidor de mídia encerrado; configuração preservada.')
    await this.options.assertAdmission?.()
    const runId=this.options.ownership?.claim()
    const authorize=()=>{if(this.closed)throw new Error('Servidor de mídia encerrado; configuração preservada.');this.options.ownership?.assertOwned(runId)}
    const verifyNative=async()=>{
      if(!this.options.hostFence)return
      authorize()
      const child=this.child
      if(child){await this.identityPending;if(!this.identity||this.child!==child||!this.running)throw new Error('Identidade do servidor de mídia não confirmada; configuração preservada.')}
      await this.options.hostFence.assertPortsAvailable(this.identity??undefined)
      if(this.child!==child)throw new Error('Geração do servidor de mídia mudou; configuração preservada.')
      authorize()
    }
    if(selectedPaths&&(channels.length||guests.length||selectedPaths.some(path=>!/^[-A-Za-z0-9_]+(?:\/[-A-Za-z0-9_]+)*$/.test(path)||path.length>256)))throw new Error('Caminhos selecionados do servidor de mídia inválidos.')
    const paths = [...new Set(selectedPaths??[
      ...channels.flatMap((channel) => [
        channel.program,
        channel.clean,
        channel.preview,
        ...(channel.inspection ? [channel.inspection] : []),
        channel.monitor,
      ]),
      ...guests.map((guest) => `guest/${guest.streamKey}`),
    ])]

    const config = [
      `logLevel: ${this.options.logLevel}`,
      '# Generoso de propósito: o primeiro frame de um canal em 1080p50 pode',
      '# demorar quando a máquina está subindo tudo ao mesmo tempo, e fechar a',
      '# conexão do engine por impaciência derruba o canal inteiro.',
      'readTimeout: 30s',
      'writeQueueSize: 1024',
      '',
      '# A API de controle fica em loopback e nunca é aberta no firewall.',
      'api: yes',
      `apiAddress: 127.0.0.1:${PORTS.api}`,
      'metrics: no',
      'pprof: no',
      'playback: no',
      // MediaMTX 1.20 enables MoQ by default. It is not an RPlayout output;
      // do not inherit extra listeners or generate TLS keys implicitly.
      'moq: no',
      '',
      '# Leitura dos relays e clientes de rede (VLC, OBS, vMix).',
      'rtsp: yes',
      'rtspTransports: [udp, tcp]',
      `rtspAddress: ${JSON.stringify(mediaListenAddress(this.options.bind,PORTS.rtsp))}`,
      `rtpAddress: ${JSON.stringify(mediaListenAddress(this.options.bind,PORTS.rtp))}`,
      `rtcpAddress: ${JSON.stringify(mediaListenAddress(this.options.bind,PORTS.rtcp))}`,
      'rtmp: yes',
      `rtmpAddress: ${JSON.stringify(mediaListenAddress(this.options.bind,PORTS.rtmp))}`,
      'srt: yes',
      `srtAddress: ${JSON.stringify(mediaListenAddress(this.options.bind,PORTS.srt))}`,
      'hls: yes',
      `hlsAddress: ${JSON.stringify(mediaListenAddress(this.options.bind,PORTS.hls))}`,
      'webrtc: yes',
      `webrtcAddress: ${JSON.stringify(mediaListenAddress(this.options.bind,PORTS.webrtc))}`,
      `webrtcLocalUDPAddress: ${JSON.stringify(mediaListenAddress(this.options.bind,PORTS.webrtcUdp))}`,
      'webrtcLocalTCPAddress: ""',
      '',
      '# Só os caminhos declarados existem. Publicar em qualquer outro é',
      '# recusado, que é o que faz da chave uma chave.',
      'paths:',
      ...paths.map((path) => `  ${path}:`),
      '',
    ].join('\n')

    // Serialize reloads; a slower previous key revocation cannot replace a
    // newer config after its caller has returned. Secrets are written only
    // after owner-only permissions have been checked on the empty file.
    const write = this.configWrite.then(async () => {
      await this.options.assertAdmission?.()
      authorize()
      await verifyNative()
      // MediaMTX's watcher debounces events inside one second. An immediate
      // second revocation could otherwise remain only on disk, not applied.
      if (this.running && this.configWrittenAt !== null) {
        const delay = 1100 - (performance.now() - this.configWrittenAt)
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
      }
      await writePrivateConfig(this.options.configPath, config,authorize,verifyNative)
      this.configWrittenAt = performance.now()
      this.configured=true
    })
    this.configWrite = write.catch(() => {})
    await write
  }

  start():Promise<void>{
    if(this.closed)return Promise.reject(new Error('Servidor de mídia encerrado.'))
    if(this.running)return Promise.resolve()
    if(this.starting)return this.starting
    const pending=this.startProcess().finally(()=>{if(this.starting===pending)this.starting=null})
    this.starting=pending;return pending
  }
  private async startProcess(): Promise<void> {
    if(this.closed)throw new Error('Servidor de mídia encerrado.')
    if(this.options.requireAppliedConfig&&!this.configured)throw new Error('Configuração desta instância não foi publicada; nenhum processo será aberto.')
    if (this.running) return
    this.options.ownership?.claim()
    await this.options.hostFence?.assertPortsAvailable()
    await this.options.assertAdmission?.()
    if(this.closed)throw new Error('Servidor de mídia encerrado.')
    this.options.hostFence?.assertOwned()
    this.options.ownership?.assertOwned()
    if(this.running)return
    if(this.child||this.options.ownership&&!this.options.ownership.canSpawn('MEDIAMTX')){this.lastError='Processo anterior não confirmou saída; nenhum segundo servidor de mídia será aberto.';return}
    const token=randomUUID();this.options.ownership?.beforeSpawn('MEDIAMTX',token)
    let child:ChildProcess
    try{child = spawn(this.options.binary, [this.options.configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: mediaMtxProcessEnvironment(),
    })}catch(error){try{this.options.ownership?.exited('MEDIAMTX',null,token)}catch{}throw error}
    this.child = child
    this.ownedChildren.add(child)
    this.readyChild=null

    // O MediaMTX loga no stdout. Um cano que ninguém lê enche, e aí o processo
    // trava na hora de logar: a API continua respondendo e a publicação para de
    // funcionar sem nenhum erro aparecer em lugar nenhum.
    for (const stream of [this.child.stdout, this.child.stderr]) {
      const diagnostics = new DiagnosticLines(line => process.stderr.write(`[mediamtx] ${line}\n`))
      stream?.on('data', (chunk: Buffer) => diagnostics.write(chunk))
      stream?.on('end', () => diagnostics.end())
    }
    this.child.on('exit', (code) => {
      this.ownedChildren.delete(child)
      try{this.options.ownership?.exited('MEDIAMTX',child.pid??null,token)}catch{}
      if(this.child!==child)return
      this.child = null
      this.readyChild=null
      const identity=this.identity;this.identity=null
      if(identity)void this.options.hostFence?.releaseProcess(identity).catch(()=>{})
      if (code !== 0 && code !== null) {
        this.lastError = `o servidor de mídia encerrou com código ${code} (porta ocupada?)`
      }
    })
    this.child.on('error', (erro) => {
      if(child.pid===undefined)this.ownedChildren.delete(child)
      if(child.pid===undefined)try{this.options.ownership?.exited('MEDIAMTX',null,token)}catch{}
      if (this.child !== child) return
      if(child.pid===undefined)this.child = null
      this.lastError = sanitizeDiagnostic(`não consegui executar o servidor de mídia: ${erro.message}`)
    })
    try{this.options.ownership?.spawned('MEDIAMTX',child.pid??null,token);this.options.ownership?.assertOwned()}catch(error){child.kill('SIGKILL');throw error}
    if(this.options.hostFence){
      const fence=this.options.hostFence
      this.identityPending=(async()=>{
        if(!child.pid)throw new Error('PID do servidor de mídia não confirmado.')
        const identity=await fence.pinProcess(child.pid,token)
        if(this.child!==child||!this.running){await fence.releaseProcess(identity);throw new Error('Servidor de mídia encerrou durante a vinculação.')}
        this.identity=identity
      })()
      await this.identityPending
    }
  }

  async startConfirmed(timeoutMs=15000):Promise<void>{
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error('Prazo de admissão de mídia inválido.')
    if(!this.options.ownership||!this.options.hostFence||!this.options.assertAdmission||!this.options.requireAppliedConfig)throw new Error('Admissão de mídia exige posse, cerca, configuração própria e autoridade atuais.')
    await this.options.assertAdmission();await this.start()
    const child=this.child
    if(!child||!await this.waitUntilReady(timeoutMs))throw new Error('Servidor próprio de mídia não confirmou readiness; não liberar publisher.')
    await this.options.assertAdmission();this.options.ownership.assertOwned();this.options.hostFence.assertOwned()
    if(this.closed||this.child!==child||!this.readyForPublish)throw new Error('Geração da mídia mudou durante a admissão.')
  }
  stopConfirmed(timeoutMs=5000):Promise<{ownedMediaProcessesStopped:boolean}>{
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)return Promise.reject(new Error('Prazo de encerramento de mídia inválido.'))
    return this.confirmedStop??=(async()=>{
      const deadline=performance.now()+timeoutMs
      this.stop()
      const drained=await new Promise<boolean>(resolve=>{
        const timer=setTimeout(()=>resolve(false),timeoutMs)
        void Promise.all([this.starting?.catch(()=>{}),this.configWrite.catch(()=>{})]).then(()=>{clearTimeout(timer);resolve(true)})
      })
      if(!drained)return {ownedMediaProcessesStopped:false}
      const children=[...this.ownedChildren]
      const stopped=await Promise.all(children.map(child=>new Promise<boolean>(resolve=>{
        if(!this.ownedChildren.has(child)){resolve(true);return}
        let done=false
        const finish=(confirmed:boolean)=>{if(done)return;done=true;clearTimeout(timer);child.off('exit',exited);child.off('error',errored);resolve(confirmed)}
        const exited=()=>finish(true),errored=()=>{if(child.pid===undefined)finish(true)}
        const timer=setTimeout(()=>finish(false),Math.max(1,deadline-performance.now()))
        child.once('exit',exited);child.on('error',errored)
        try{child.kill('SIGKILL')}catch{finish(false)}
      })))
      return {ownedMediaProcessesStopped:stopped.every(Boolean)&&this.ownedChildren.size===0}
    })()
  }
  stop(): void {
    this.closed=true
    this.readyChild=null
    this.restartAt = null
    this.child?.kill()
  }

  /**
   * Espera o servidor aceitar conexão.
   *
   * O engine publica aqui assim que sobe, e o sink de RTMP não se reconecta
   * sozinho: subir os canais antes do servidor estar escutando dá um canal que
   * roda bonito e não sai para lugar nenhum.
   */
  async waitUntilReady(timeoutMs = 15_000): Promise<boolean> {
    this.readyChild=null
    const deadline = performance.now() + timeoutMs

    while (performance.now() < deadline) {
      if(!this.running)return false
      try{this.options.ownership?.assertOwned()}catch{return false}
      try {
        const child=this.child
        await this.identityPending
        if(this.child!==child||!this.running)return false
        if(this.options.hostFence&&(!this.identity||!await this.options.hostFence.mediaReady(this.identity))){await new Promise(done=>setTimeout(done,200));continue}
        const response = await fetch(`http://127.0.0.1:${PORTS.api}/v3/paths/list`,{signal:AbortSignal.timeout(Math.min(2000,timeoutMs))})
        if(this.child!==child||!this.running)return false
        this.options.ownership?.assertOwned()
        if(this.options.hostFence&&(!this.identity||!await this.options.hostFence.mediaReady(this.identity)))return false
        if(this.child!==child||!this.running)return false
        if (response.ok) {
          this.lastError = null
          this.restartStreak = 0
          this.restartAt = null
          this.readyChild=child
          return true
        }
      } catch {
        // Ainda subindo.
      }
      await new Promise((done) => setTimeout(done, 200))
    }
    this.lastError ??= 'o servidor de mídia não respondeu na API de controle'
    return false
  }

  /** Quem está publicando e quem está assistindo, agora. */
  async refreshReadiness():Promise<boolean>{
    const child=this.child,identity=this.identity
    const lost=()=>{if(this.child===child)this.readyChild=null;return false}
    try{
      if(this.closed||!child||!this.running||!identity||!this.options.hostFence||!this.options.ownership)return lost()
      this.options.ownership.assertOwned()
      if(!await this.options.hostFence.mediaReady(identity)||this.child!==child||this.identity!==identity)return lost()
      const response=await fetch(`http://127.0.0.1:${PORTS.api}/v3/paths/list`,{signal:AbortSignal.timeout(2000)})
      if(!response.ok||!await this.options.hostFence.mediaReady(identity))return lost()
      this.options.ownership.assertOwned()
      if(this.closed||this.child!==child||this.identity!==identity||!this.running)return lost()
      this.readyChild=child;return true
    }catch{return lost()}
  }
  async status(): Promise<PathStatus[]> {
    if (!this.running) return []

    try {
      const child=this.child,identity=this.identity
      this.options.ownership?.assertOwned()
      if(this.options.hostFence&&(!identity||!await this.options.hostFence.mediaReady(identity))){this.readyChild=null;return []}
      if(this.child!==child||!this.running)return []
      const response = await fetch(`http://127.0.0.1:${PORTS.api}/v3/paths/list`,{signal:AbortSignal.timeout(2000)})
      if (!response.ok) return []
      const body = (await response.json()) as { items?: ApiPath[] }
      if(this.options.hostFence&&(!identity||!await this.options.hostFence.mediaReady(identity))){this.readyChild=null;return []}
      if(this.child!==child||!this.running)return []
      this.options.ownership?.assertOwned()

      return (body.items ?? []).map((item) => ({
        name: item.name,
        ready: item.ready,
        source: item.source?.type ?? null,
        readers: item.readers.length,
        bytesReceived: item.bytesReceived,
      }))
    } catch {
      // Servidor ainda subindo ou já encerrado: a interface mostra vazio.
      return []
    }
  }

  /** Endereços prontos para copiar, já com o endereço da máquina na rede. */
  static urlsFor(path: string, host: string): Record<string, string> {
    return {
      rtsp: `rtsp://${host}:${PORTS.rtsp}/${path}`,
      rtmp: `rtmp://${host}:${PORTS.rtmp}/${path}`,
      srt: `srt://${host}:${PORTS.srt}?streamid=read:${path}`,
      hls: `http://${host}:${PORTS.hls}/${path}`,
      webrtc: `http://${host}:${PORTS.webrtc}/${path}`,
    }
  }

  urls(path: string, host: string): Record<string, string> {
    return MediaMtx.urlsFor(path, host)
  }

  /** Onde o engine publica: sempre loopback, nunca a rede. */
  static loopback(path: string): string {
    return `rtmp://127.0.0.1:${PORTS.rtmp}/${path}`
  }

  /**
   * Onde o engine publica um monitor: loopback também, mas por SRT.
   *
   * O monitor é olhado num navegador, e o navegador não fala AAC. O que chega
   * por RTMP é FLV, que não carrega Opus -- então o monitor por RTMP é mudo,
   * por construção. Em MPEG-TS o Opus passa, e a resposta do WHEP traz a
   * trilha de som junto com a de imagem. O programa continua por RTMP: quem
   * repassa para o mundo espera AAC.
   */
  static loopbackSrt(path: string): string {
    return `srt://127.0.0.1:${PORTS.srt}?streamid=publish:${path}`
  }

  /** De onde os relays leem: loopback também. */
  static internalRead(path: string): string {
    return `rtsp://127.0.0.1:${PORTS.rtsp}/${path}`
  }
}

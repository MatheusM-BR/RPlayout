import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

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
} as const

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
}

export interface MediaMtxOptions {
  readonly binary: string
  readonly configPath: string
  /** Interface em que o servidor escuta. */
  readonly bind: string
  /** Nível de log do servidor. `info` é o que mostra por que uma conexão caiu. */
  readonly logLevel: string
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
  private child: ChildProcess | null = null
  /**
   * Por que o servidor de mídia não está de pé.
   *
   * Sem isso o operador vê "a saída caiu e está tentando voltar" e não tem como
   * saber que a causa é a porta 1935 ocupada por outro programa -- que é o
   * caso mais comum numa máquina que já teve OBS ou vMix.
   */
  lastError: string | null = null

  constructor(private readonly options: MediaMtxOptions) {}

  get running(): boolean {
    return this.child !== null && !this.child.killed
  }

  /** Verdadeiro quando o servidor está aberto para além da rede local. */
  get exposed(): boolean {
    return this.options.bind === '0.0.0.0' || this.options.bind === '::'
  }

  /**
   * Reescreve a config. O MediaMTX observa o próprio arquivo e recarrega, então
   * criar ou revogar uma chave não derruba quem está no ar.
   */
  async apply(channels: readonly ChannelPaths[], guests: readonly GuestPath[]): Promise<void> {
    const paths = [
      ...channels.flatMap((channel) => [channel.program, channel.clean, channel.preview]),
      ...guests.map((guest) => `guest/${guest.streamKey}`),
    ]

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
      '',
      '# Leitura interna dos relays. Loopback, nunca a rede.',
      'rtsp: yes',
      `rtspAddress: 127.0.0.1:${PORTS.rtsp}`,
      'rtmp: yes',
      `rtmpAddress: ${this.options.bind}:${PORTS.rtmp}`,
      'srt: yes',
      `srtAddress: ${this.options.bind}:${PORTS.srt}`,
      'hls: yes',
      `hlsAddress: ${this.options.bind}:${PORTS.hls}`,
      'webrtc: yes',
      `webrtcAddress: ${this.options.bind}:${PORTS.webrtc}`,
      '',
      '# Só os caminhos declarados existem. Publicar em qualquer outro é',
      '# recusado, que é o que faz da chave uma chave.',
      'paths:',
      ...paths.map((path) => `  ${path}:`),
      '',
    ].join('\n')

    await writeFile(this.options.configPath, config, 'utf8')
  }

  start(): void {
    if (this.running) return

    this.child = spawn(this.options.binary, [this.options.configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // O MediaMTX loga no stdout. Um cano que ninguém lê enche, e aí o processo
    // trava na hora de logar: a API continua respondendo e a publicação para de
    // funcionar sem nenhum erro aparecer em lugar nenhum.
    for (const stream of [this.child.stdout, this.child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        process.stderr.write(`[mediamtx] ${chunk.toString()}`)
      })
    }
    this.child.on('exit', (code) => {
      this.child = null
      if (code !== 0 && code !== null) {
        this.lastError = `o servidor de mídia encerrou com código ${code} (porta ocupada?)`
      }
    })
    this.child.on('error', (erro) => {
      this.lastError = `não consegui executar o servidor de mídia: ${erro.message}`
    })
  }

  stop(): void {
    this.child?.kill()
    this.child = null
  }

  /**
   * Espera o servidor aceitar conexão.
   *
   * O engine publica aqui assim que sobe, e o sink de RTMP não se reconecta
   * sozinho: subir os canais antes do servidor estar escutando dá um canal que
   * roda bonito e não sai para lugar nenhum.
   */
  async waitUntilReady(timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORTS.api}/v3/paths/list`)
        if (response.ok) {
          this.lastError = null
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
  async status(): Promise<PathStatus[]> {
    if (!this.running) return []

    try {
      const response = await fetch(`http://127.0.0.1:${PORTS.api}/v3/paths/list`)
      if (!response.ok) return []
      const body = (await response.json()) as { items?: ApiPath[] }

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
  urls(path: string, host: string): Record<string, string> {
    return {
      rtmp: `rtmp://${host}:${PORTS.rtmp}/${path}`,
      srt: `srt://${host}:${PORTS.srt}?streamid=read:${path}`,
      hls: `http://${host}:${PORTS.hls}/${path}`,
      webrtc: `http://${host}:${PORTS.webrtc}/${path}`,
    }
  }

  /** Onde o engine publica: sempre loopback, nunca a rede. */
  static loopback(path: string): string {
    return `rtmp://127.0.0.1:${PORTS.rtmp}/${path}`
  }

  /** De onde os relays leem: loopback também. */
  static internalRead(path: string): string {
    return `rtsp://127.0.0.1:${PORTS.rtsp}/${path}`
  }
}

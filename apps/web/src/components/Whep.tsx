import { useCallback, useEffect, useRef, useState } from 'react'
import {postWhepOffer} from '../domain/whep-offer.js'
import { MONITOR_TIER_LABEL, type MonitorTier } from '@rplayout/protocol'
import { TIER_ORDER, TierController, clampToAvailable, deriveStats, glassToGlassMs, initialTier, readClockRgba, readRawStats, clockBlock, CLOCK_BLOCKS, type MonitorRole, type RawStats } from '../domain/monitor-tier.js'
import { monitorStatsStore, useClockTest } from '../domain/monitor-stats-store.js'

interface Props {
  /** Caminho no servidor de mídia, ex. `canal-1/pgm`. Nulo apaga a tela. */
  path: string | null
  /** Porta WebRTC do servidor de mídia. */
  port: number
  /**
   * Avisa que esta janela está aberta, enquanto ela existir.
   *
   * O engine só codifica o monitor enquanto alguém avisa: janela fechada não
   * deve custar uma codificação, e numa máquina com quatro canais isso são
   * quatro codificações que passam a existir só quando há alguém olhando.
   */
  onWatching?: (tier?: MonitorTier) => void
  /**
   * Caminho de cada nível (REFERÊNCIA, PADRÃO, LEVE). Com eles, quem assiste
   * escolhe o nível no próprio monitor (ou deixa no automático, que começa
   * pelo contexto e cai/sobe pela qualidade da conexão). Sem eles, `path`.
   */
  tiers?: Partial<Record<MonitorTier, string>> | null
  /** Papel do monitor: decide o nível inicial e aparece na tela técnica. */
  role?: MonitorRole
  /** Cadência do canal para avanço quadro a quadro no material pesquisável. */
  frameRate?: number
  /** Posição real reportada pelo engine, em frames desde o Mark In. */
  positionFrames?: number
  durationFrames?: number
  onSeek?: (frames: number) => void
  hideControls?: boolean
  onErrorFallback?: (reason: string) => void
  muted?: boolean
  /** Elemento que recebe o MediaStream, para scopes locais de QC. */
  onVideoElement?: (element: HTMLVideoElement | null) => void
  /**
   * Notifica o consumidor quando o próprio elemento WHEP decodificou um
   * quadro.  O QC usa isto para amostrar o mesmo frame que está na tela,
   * em vez de depender de um relógio independente.
   */
  onVideoFrame?: () => void
}

type Status = 'off' | 'connecting' | 'live' | 'failed'

const tempo = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Monitor de vídeo por WHEP.
 *
 * O servidor de mídia local já fala WHEP, então o monitor não precisa de
 * sinalização nossa: oferece, recebe a resposta e mostra. Isso é o que permite
 * ver o programa de verdade na interface sem passar imagem pelo servidor de
 * aplicação.
 *
 * O endereço é montado com o nome de máquina pelo qual a interface foi aberta,
 * nunca com um IP que o servidor ache que tem: quem abre por `localhost` e quem
 * abre pela rede precisam ver a mesma coisa.
 */
export function Whep({
  path,
  port,
  onWatching,
  frameRate = 25,
  positionFrames = 0,
  durationFrames = 0,
  onSeek,
  hideControls = false,
  onErrorFallback,
  muted,
  onVideoElement,
  onVideoFrame,
  tiers,
  role = 'pgm',
}: Props) {
  const video = useRef<HTMLVideoElement | null>(null)
  const monitorId = useRef(`mon-${Math.random().toString(36).slice(2, 10)}`).current
  const clockTest = useClockTest()
  const clockTestRef = useRef(clockTest)
  clockTestRef.current = clockTest
  // Nível: automático (teto pelo contexto, queda/subida pela conexão) ou
  // fixado por quem assiste. A escolha manual fica guardada por papel.
  const modeKey = `rplayout.monitorTier.${role}`
  const [mode, setMode] = useState<'auto' | MonitorTier>(() => {
    try { const saved = window.localStorage.getItem(modeKey); return saved === 'ref' || saved === 'std' || saved === 'lite' ? saved : 'auto' } catch { return 'auto' }
  })
  // Só os níveis que o servidor publica (o multiview vai até o teto do mosaico).
  const availableKey = TIER_ORDER.filter((option) => Boolean(tiers?.[option])).join(',')
  const available = availableKey ? (availableKey.split(',') as MonitorTier[]) : []
  const [ceiling, setCeiling] = useState<MonitorTier>(role === 'qc' ? 'ref' : 'std')
  const [autoTier, setAutoTier] = useState<MonitorTier>(ceiling)
  const controller = useRef(new TierController(ceiling))
  const hasTiers = available.length > 0
  const tier: MonitorTier | null = hasTiers ? clampToAvailable(mode === 'auto' ? autoTier : mode, available) : null
  const effectivePath = hasTiers && tier ? (tiers?.[tier] ?? path) : path
  const tierRef = useRef(tier)
  tierRef.current = tier
  const modeRef = useRef(mode)
  modeRef.current = mode
  useEffect(() => {
    if (!hasTiers) return
    const element = video.current?.parentElement
    const nav = navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean; downlink?: number } }
    const mobile = (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
    const next = clampToAvailable(initialTier({ role, elementWidth: element?.clientWidth || window.innerWidth, mobile, effectiveType: nav.connection?.effectiveType ?? null, saveData: nav.connection?.saveData ?? false, downlinkMbps: nav.connection?.downlink ?? null }), availableKey.split(',') as MonitorTier[])
    setCeiling(next)
    controller.current.setCeiling(next)
    setAutoTier(next)
  }, [hasTiers, role, availableKey])
  const chooseMode = (next: 'auto' | MonitorTier) => {
    setMode(next)
    try { window.localStorage.setItem(modeKey, next) } catch { /* sem armazenamento: vale só nesta aba */ }
    if (next === 'auto') { controller.current.setCeiling(ceiling); setAutoTier(ceiling) }
  }
  useEffect(() => () => monitorStatsStore.remove(monitorId), [monitorId])
  const [status, setStatus] = useState<Status>('off')
  const [reason, setReason] = useState<string | null>(null)
  /**
   * Nasce mudo, e não é só por causa do navegador.
   *
   * Autoplay com som é bloqueado sem um gesto do operador, então começar mudo
   * é o que faz a imagem aparecer. Mas mesmo sem isso seria o certo: com
   * quatro monitores abertos, quatro sons somados não é monitoração, é
   * barulho. Quem quer ouvir escolhe qual.
   */
  const [mudo, setMudo] = useState(true)
  /** Chegou trilha de som nesta sessão? Sem ela o botão não teria o que fazer. */
  const [temSom, setTemSom] = useState(false)
  const [volume, setVolume] = useState(0.7)
  const [scrub, setScrub] = useState<number | null>(null)
  const volumeRef = useRef(0.7)
  const onVideoFrameRef = useRef(onVideoFrame)
  const confirmVideoRef = useRef<(()=>void)|null>(null)

  // Não use uma callback ref inline no <video>. Uma ref inline é removida e
  // recolocada a cada renderização do monitor; no QC isso alternava o vídeo
  // compartilhado entre `null` e o elemento real sempre que os scopes
  // publicavam uma métrica. A imagem continuava no DOM, mas o amostrador
  // perdia a referência e ficava em "aguardando frame".
  const bindVideoElement = useCallback((element: HTMLVideoElement | null) => {
    video.current = element
    onVideoElement?.(element)
  }, [onVideoElement])

  useEffect(() => {
    onVideoFrameRef.current = onVideoFrame
  }, [onVideoFrame])

  // `requestVideoFrameCallback` é disparado pelo decoder, não pelo relógio
  // da interface. Isso elimina a corrida onde o QC tentava ler o canvas antes
  // de o primeiro frame remoto ficar disponível.
  useEffect(() => {
    const element = video.current
    if (!element || typeof element.requestVideoFrameCallback !== 'function') return undefined
    let active = true
    let callbackId = 0
    let canvas: HTMLCanvasElement | null = null
    let frames = 0
    const next = () => {
      if (!active) return
      callbackId = element.requestVideoFrameCallback((_now, metadata) => {
        if (!active) return
        confirmVideoRef.current?.()
        onVideoFrameRef.current?.()
        // Relógio de teste: lê a faixa gravada pelo engine no quadro que vai
        // para a tela e compara com o relógio desta página.
        if (clockTestRef.current && (frames++ % 3 === 0)) {
          try {
            const w = metadata?.width || element.videoWidth, h = metadata?.height || element.videoHeight
            if (w && h) {
              const rows = clockBlock(w, h)
              canvas ??= document.createElement('canvas')
              canvas.width = Math.min(w, rows * (CLOCK_BLOCKS + 1)); canvas.height = rows
              const context = canvas.getContext('2d', { willReadFrequently: true })
              if (context) {
                context.drawImage(element, 0, 0, canvas.width, rows, 0, 0, canvas.width, rows)
                const stamp = readClockRgba(context.getImageData(0, 0, canvas.width, rows).data, canvas.width, w, h)
                const shown = metadata?.expectedDisplayTime ? Date.now() + (metadata.expectedDisplayTime - performance.now()) : Date.now()
                if (stamp !== null) monitorStatsStore.pushGlass(monitorId, glassToGlassMs(stamp, shown))
              }
            }
          } catch { /* vídeo sem quadro ainda */ }
        }
        next()
      })
    }
    next()
    return () => {
      active = false
      if (callbackId) element.cancelVideoFrameCallback(callbackId)
    }
  }, [effectivePath, monitorId])

  /** Sobe a cada falha e é o que faz o monitor tentar de novo. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (muted !== undefined && video.current) {
      video.current.muted = muted
      setMudo(muted)
    }
  }, [muted])

  /**
   * Bate o ponto enquanto a janela existe.
   *
   * O primeiro aviso é imediato -- senão o monitor levaria o intervalo inteiro
   * para acender na primeira vez --, e os seguintes são folgados: o servidor
   * só desliga depois de vinte segundos de silêncio, então avisar de cinco em
   * cinco dá margem para uma resposta perdida sem apagar a imagem.
   */
  // The heartbeat depends on the path only. Callers pass inline callbacks, and
  // re-running this effect on every render (several per second on a running
  // channel) fired one POST per render instead of one every five seconds.
  const onWatchingRef = useRef(onWatching)
  onWatchingRef.current = onWatching
  const watches = Boolean(onWatching)
  useEffect(() => {
    if (!effectivePath || !watches) return undefined
    // O aviso diz o nível: o engine só codifica os níveis que alguém assiste.
    const beat = () => onWatchingRef.current?.(tierRef.current ?? undefined)
    beat()
    const relogio = window.setInterval(beat, 5_000)
    return () => window.clearInterval(relogio)
  }, [effectivePath, watches])

  useEffect(() => {
    const path = effectivePath
    setTemSom(false)
    setReason(null)
    if (!path) {
      setStatus('off')
      return
    }
    if (typeof RTCPeerConnection === 'undefined') {
      setReason('WEBRTC INDISPONÍVEL NESTE NAVEGADOR')
      setStatus('failed')
      return
    }

    let cancelled = false
    let retry: number | null = null
    let resource: string | null = null
    const endpoint = `${window.location.protocol}//${window.location.hostname}:${port}/${path}/whep`
    const abort = new AbortController()
    const negotiationTimeout = window.setTimeout(() => {
      abort.abort()
      if (!cancelled && (video.current?.readyState ?? 0) < 2) {
        setReason('CONEXÃO COM O MONITOR EXPIROU')
        setStatus('failed')
        if (!retry) retry = window.setTimeout(() => setAttempt((n) => n + 1), 3000)
      }
    }, 15_000)
    const peer = new RTCPeerConnection()
    peer.addTransceiver('video', { direction: 'recvonly' })
    // Som também. O monitor sai em Opus por MPEG-TS justamente para isto: em
    // AAC o servidor respondia a trilha de áudio com porta zero -- recusada --
    // e o navegador recebia só imagem. Pedir áudio de um caminho que não tem
    // não custa a sessão: a resposta vem com a porta zerada e o vídeo passa
    // igual, que é o que acontece num monitor ainda publicando por RTMP.
    peer.addTransceiver('audio', { direction: 'recvonly' })

    const stream = new MediaStream()
    let decoded=false
    const confirmVideo=()=>{
      const element=video.current
      if(cancelled||decoded||['failed','disconnected','closed'].includes(peer.connectionState)||element?.srcObject!==stream||element.readyState<2||!element.videoWidth||!element.videoHeight)return
      decoded=true
      window.clearTimeout(negotiationTimeout)
      setStatus('live');setReason(null)
    }
    confirmVideoRef.current=confirmVideo
    peer.ontrack = (event) => {
      if (cancelled) return
      // Atraso mínimo no navegador: sem alvo extra no jitter buffer, o Chrome
      // fica no mínimo que a variação medida exige (continua adaptativo, só
      // não guarda folga a mais). No LEVE, que é a conexão ruim, o padrão.
      try {
        const receiver = event.receiver as RTCRtpReceiver & { jitterBufferTarget?: number | null; playoutDelayHint?: number | null }
        if (tierRef.current !== 'lite') {
          const hints = receiver as { jitterBufferTarget?: number | null; playoutDelayHint?: number | null }
          if ('jitterBufferTarget' in receiver) hints.jitterBufferTarget = 0
          else hints.playoutDelayHint = 0
        }
      } catch { /* navegador sem a dica: segue o padrão dele */ }
      stream.addTrack(event.track)
      if (event.track.kind === 'audio') {
        // Alguns navegadores recebem a trilha desabilitada quando o elemento
        // começa mutado; reative-a antes do gesto de "ouvir".
        event.track.enabled = true
        setTemSom(true)
      }
      if (video.current) {
        video.current.srcObject = stream
        video.current.volume = volumeRef.current
        void video.current.play().catch(() => setReason('Clique em Ouvir para iniciar o monitor.'))
      }
    }
    peer.onconnectionstatechange = () => {
      if (cancelled) return
      if (peer.connectionState === 'connected') {
        if(retry!==null){window.clearTimeout(retry);retry=null}
        setReason(null)
        confirmVideo()
      }
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        decoded=false
        // Sessão que caiu no meio: o canal pode ter reiniciado, então o
        // monitor tenta de novo em vez de ficar preto até alguém recarregar.
        setStatus('failed')
        if (!retry) retry = window.setTimeout(() => setAttempt((n) => n + 1), 3000)
      }
    }

    const negotiate = async (): Promise<void> => {
      setStatus('connecting')
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)

      // Junta os candidatos antes de oferecer. Em rede local isso leva
      // milissegundos e evita ter que implementar trickle ICE de saída.
      await new Promise<void>((done) => {
        if (peer.iceGatheringState === 'complete') return done()
        const check = () => {
          if (peer.iceGatheringState === 'complete') {
            peer.removeEventListener('icegatheringstatechange', check)
            done()
          }
        }
        peer.addEventListener('icegatheringstatechange', check)
        window.setTimeout(done, 1500)
      })

      if (cancelled) return
      const response = await postWhepOffer(endpoint,peer.localDescription?.sdp??'',abort.signal)
      resource = response.headers.get('Location')
      if (cancelled && resource) {
        void fetch(new URL(resource, endpoint), { method: 'DELETE' }).catch(() => undefined)
        return
      }
      const answer = await response.text()
      if (cancelled) return
      await peer.setRemoteDescription({ type: 'answer', sdp: answer })
    }

    // Estatísticas do WebRTC, uma vez por segundo: tela técnica e troca
    // automática de nível. A cadência esperada é a maior vista nos últimos
    // 10 s (a do nível muda conforme o canal e o nível).
    let previous: RawStats | null = null
    const recentFps: number[] = []
    const statsTimer = window.setInterval(() => {
      if (cancelled || peer.connectionState !== 'connected') return
      void peer.getStats().then((report) => {
        if (cancelled) return
        const current = readRawStats(report as unknown as { forEach(cb: (value: Record<string, unknown>) => void): void }, performance.now())
        if (!current) return
        if (previous) {
          const expected = recentFps.length >= 5 ? Math.max(...recentFps) : 0
          const { stats, sample } = deriveStats(previous, current, expected)
          recentFps.push(stats.fps); if (recentFps.length > 10) recentFps.shift()
          monitorStatsStore.update(monitorId, { role, path, tier: tierRef.current, mode: modeRef.current, stats })
          if (modeRef.current === 'auto' && tierRef.current) {
            const changed = controller.current.push(sample)
            if (changed) setAutoTier(changed)
          }
        }
        previous = current
      }).catch(() => undefined)
    }, 1000)

    void negotiate().catch((failure: unknown) => {
      if (cancelled) return
      // "CODEC" quase sempre é navegador sem H.264, não canal fora do ar.
      const message = failure instanceof Error ? failure.message : ''
      const codec = message === 'CODEC'
      setReason(codec ? 'CODEC INCOMPATÍVEL COM O NAVEGADOR' : `MONITOR INDISPONÍVEL: ${message || 'falha de conexão'}`)
      setStatus('failed')
      if (onErrorFallback) onErrorFallback(message || 'falha de conexão')
      // Canal que ainda não subiu volta sozinho; navegador sem H.264 não muda
      // de ideia, então insistir só gastaria conexão.
      if (!codec && !retry) retry = window.setTimeout(() => setAttempt((n) => n + 1), 3000)
    })

    return () => {
      cancelled = true
      window.clearInterval(statsTimer)
      if(confirmVideoRef.current===confirmVideo)confirmVideoRef.current=null
      abort.abort()
      window.clearTimeout(negotiationTimeout)
      if (retry) window.clearTimeout(retry)
      peer.close()
      for (const track of stream.getTracks()) track.stop()
      if (video.current?.srcObject === stream) video.current.srcObject = null
      // Avisar o servidor evita sessão pendurada quando o operador troca de
      // canal várias vezes seguidas.
      if (resource) {
        void fetch(new URL(resource, endpoint), {
          method: 'DELETE',
        }).catch(() => undefined)
      }
    }
  }, [effectivePath, port, attempt, monitorId, role])

  return (
    <>
      <video
        ref={bindVideoElement}
        className="feed w-full h-full object-contain"
        autoPlay
        playsInline
        muted={muted !== undefined ? muted : mudo}
        onClick={
          hideControls || muted !== undefined
            ? undefined
            : () => {
                if (!temSom || !video.current) return
                setMudo(false)
                video.current.muted = false
                video.current.volume = volumeRef.current
                void video.current.play().catch(() => setReason('Clique em Ouvir para iniciar o monitor.'))
              }
        }
        onLoadedData={() => confirmVideoRef.current?.()}
        onLoadedMetadata={() => onVideoFrame?.()}
        onPlaying={() => onVideoFrame?.()}
        onTimeUpdate={() => onVideoFrame?.()}
        hidden={status !== 'live'}
      />
      {!hideControls && status === 'live' && (
        <div className="monitor-seekbar" data-seekable={onSeek && durationFrames > 0 ? 'true' : 'false'}>
          <span className="monitor-time" aria-live="off">{tempo((scrub ?? positionFrames) / frameRate)} / {durationFrames > 0 ? tempo(durationFrames / frameRate) : 'AO VIVO'}</span>
          <button type="button" className="btn small frame-step" aria-label="voltar um quadro no engine" disabled={!onSeek || durationFrames <= 0} onClick={() => onSeek?.(Math.max(0, positionFrames - 1))}>−1f</button>
          <input aria-label={durationFrames > 0 ? 'Posição real do vídeo no engine' : 'Fonte ao vivo sem seek'} title={durationFrames > 0 ? 'Arraste para avançar ou retroceder o vídeo no engine' : 'Fonte ao vivo não permite seek'} type="range" min="0" max={durationFrames || 1} step="1" value={Math.min(scrub ?? positionFrames, durationFrames || 1)} disabled={!onSeek || durationFrames <= 0} onChange={(event) => setScrub(Number(event.target.value))} onPointerUp={(event) => { onSeek?.(Number(event.currentTarget.value)); setScrub(null) }} onKeyUp={(event) => { onSeek?.(Number(event.currentTarget.value)); setScrub(null) }} onBlur={(event) => { if (scrub !== null) onSeek?.(Number(event.currentTarget.value)); setScrub(null) }} />
          <button type="button" className="btn small frame-step" aria-label="avançar um quadro no engine" disabled={!onSeek || durationFrames <= 0} onClick={() => onSeek?.(Math.min(durationFrames, positionFrames + 1))}>+1f</button>
        </div>
      )}
      {!hideControls && status === 'live' && (
        <div className="monitor-audio">
        <button
          type="button"
          className="btn small"
          disabled={!temSom}
          title={mudo ? 'Ouvir este monitor' : 'Silenciar'}
          aria-label={mudo ? 'Ouvir este monitor' : 'Silenciar'}
          aria-pressed={!mudo}
          onClick={() => {
            const muted = !mudo
            setMudo(muted)
            if (video.current) {
              video.current.muted = muted
              video.current.volume = volume
              void video.current.play().catch(() => setReason('O navegador bloqueou a reprodução. Tente novamente.'))
            }
          }}
        >
          {!temSom ? '🔇' : mudo ? '🔇' : '🔊'}
        </button>
        {temSom && <input className="monitor-volume" aria-label="Volume deste monitor" type="range" min="0" max="1" step="0.05"
          value={volume} onChange={(event) => {
            const value = Number(event.target.value)
            setVolume(value)
            volumeRef.current = value
            if (video.current) video.current.volume = value
          }} />}
        </div>
      )}
      {hasTiers && (
        <div className="monitor-tier absolute top-1 right-1 z-30 flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold uppercase text-white" role="group" aria-label="Nível de qualidade deste monitor">
          {(['auto', 'ref', 'std', 'lite'] as const).filter((option) => option === 'auto' || available.includes(option)).map((option) => (
            <button key={option} type="button" aria-pressed={mode === option}
              title={option === 'auto' ? `Automático: começa em ${MONITOR_TIER_LABEL[ceiling]} e cai/sobe pela conexão` : `Fixar em ${MONITOR_TIER_LABEL[option]}`}
              className={`rounded px-1 ${mode === option ? 'bg-white text-black' : 'opacity-70 hover:opacity-100'}`}
              onClick={() => chooseMode(option)}>
              {option === 'auto' ? `AUTO${mode === 'auto' && tier ? `·${MONITOR_TIER_LABEL[tier].slice(0, 3)}` : ''}` : MONITOR_TIER_LABEL[option].slice(0, 3)}
            </button>
          ))}
        </div>
      )}
      {status === 'live' && reason && <div className="monitor-reason" role="status">{reason}</div>}
      {status !== 'live' && <div className="idle monitor-idle"><span>{status === 'failed' ? (reason ?? 'SEM SINAL') : 'SINTONIZANDO'}</span>{status === 'failed' && <button className="btn small" onClick={() => setAttempt((value) => value + 1)}>TENTAR NOVAMENTE</button>}</div>}
    </>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import {postWhepOffer} from '../domain/whep-offer.js'

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
  onWatching?: () => void
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
}: Props) {
  const video = useRef<HTMLVideoElement | null>(null)
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
    const next = () => {
      if (!active) return
      callbackId = element.requestVideoFrameCallback(() => {
        if (!active) return
        confirmVideoRef.current?.()
        onVideoFrameRef.current?.()
        next()
      })
    }
    next()
    return () => {
      active = false
      if (callbackId) element.cancelVideoFrameCallback(callbackId)
    }
  }, [path])

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
    if (!path || !watches) return undefined
    const beat = () => onWatchingRef.current?.()
    beat()
    const relogio = window.setInterval(beat, 5_000)
    return () => window.clearInterval(relogio)
  }, [path, watches])

  useEffect(() => {
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
  }, [path, port, attempt])

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
      {status === 'live' && reason && <div className="monitor-reason" role="status">{reason}</div>}
      {status !== 'live' && <div className="idle monitor-idle"><span>{status === 'failed' ? (reason ?? 'SEM SINAL') : 'SINTONIZANDO'}</span>{status === 'failed' && <button className="btn small" onClick={() => setAttempt((value) => value + 1)}>TENTAR NOVAMENTE</button>}</div>}
    </>
  )
}

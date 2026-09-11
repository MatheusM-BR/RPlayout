import { useEffect, useRef, useState } from 'react'

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
}

type Status = 'off' | 'connecting' | 'live' | 'failed'

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
export function Whep({ path, port, onWatching }: Props) {
  const video = useRef<HTMLVideoElement>(null)
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

  /** Sobe a cada falha e é o que faz o monitor tentar de novo. */
  const [attempt, setAttempt] = useState(0)

  /**
   * Bate o ponto enquanto a janela existe.
   *
   * O primeiro aviso é imediato -- senão o monitor levaria o intervalo inteiro
   * para acender na primeira vez --, e os seguintes são folgados: o servidor
   * só desliga depois de vinte segundos de silêncio, então avisar de cinco em
   * cinco dá margem para uma resposta perdida sem apagar a imagem.
   */
  useEffect(() => {
    if (!path || !onWatching) return undefined
    onWatching()
    const relogio = window.setInterval(onWatching, 5_000)
    return () => window.clearInterval(relogio)
  }, [path, onWatching])

  useEffect(() => {
    if (!path) {
      setStatus('off')
      return
    }

    let cancelled = false
    let retry: number | null = null
    let resource: string | null = null
    const peer = new RTCPeerConnection()
    peer.addTransceiver('video', { direction: 'recvonly' })
    // Som também. O monitor sai em Opus por MPEG-TS justamente para isto: em
    // AAC o servidor respondia a trilha de áudio com porta zero -- recusada --
    // e o navegador recebia só imagem. Pedir áudio de um caminho que não tem
    // não custa a sessão: a resposta vem com a porta zerada e o vídeo passa
    // igual, que é o que acontece num monitor ainda publicando por RTMP.
    peer.addTransceiver('audio', { direction: 'recvonly' })

    const stream = new MediaStream()
    peer.ontrack = (event) => {
      stream.addTrack(event.track)
      if (event.track.kind === 'audio') setTemSom(true)
      if (video.current) video.current.srcObject = stream
    }
    peer.onconnectionstatechange = () => {
      if (cancelled) return
      if (peer.connectionState === 'connected') {
        setStatus('live')
        setReason(null)
      }
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
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

      const response = await fetch(`http://${window.location.hostname}:${port}/${path}/whep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: peer.localDescription?.sdp ?? '',
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail.includes('codecs') ? 'CODEC' : `HTTP ${response.status}`)
      }
      resource = response.headers.get('Location')
      const answer = await response.text()
      if (cancelled) return
      await peer.setRemoteDescription({ type: 'answer', sdp: answer })
    }

    void negotiate().catch((failure: unknown) => {
      if (cancelled) return
      // "CODEC" quase sempre é navegador sem H.264, não canal fora do ar.
      const message = failure instanceof Error ? failure.message : ''
      const codec = message === 'CODEC'
      setReason(codec ? 'NAVEGADOR SEM H.264' : null)
      setStatus('failed')
      // Canal que ainda não subiu volta sozinho; navegador sem H.264 não muda
      // de ideia, então insistir só gastaria conexão.
      if (!codec) retry = window.setTimeout(() => setAttempt((n) => n + 1), 3000)
    })

    return () => {
      cancelled = true
      if (retry) window.clearTimeout(retry)
      peer.close()
      // Avisar o servidor evita sessão pendurada quando o operador troca de
      // canal várias vezes seguidas.
      if (resource) {
        void fetch(new URL(resource, `http://${window.location.hostname}:${port}`), {
          method: 'DELETE',
        }).catch(() => undefined)
      }
    }
  }, [path, port, attempt])

  return (
    <>
      <video
        ref={video}
        className="feed"
        autoPlay
        playsInline
        muted={mudo}
        hidden={status !== 'live'}
      />
      {status === 'live' && temSom && (
        <button
          type="button"
          className="som"
          title={mudo ? 'Ouvir este monitor' : 'Silenciar'}
          aria-label={mudo ? 'Ouvir este monitor' : 'Silenciar'}
          aria-pressed={!mudo}
          onClick={() => setMudo((antes) => !antes)}
        >
          {mudo ? '🔇' : '🔊'}
        </button>
      )}
      {status !== 'live' && (
        <div className="idle">
          {status === 'failed' ? (reason ?? 'SEM SINAL') : 'SINTONIZANDO'}
        </div>
      )}
    </>
  )
}

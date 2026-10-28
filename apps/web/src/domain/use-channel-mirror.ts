import { useEffect, useState } from 'react'
import { api, type ChannelMirror } from '../api.js'

/** Espelho do canal (se houver), relido a cada 30 s. Falha de leitura não
 * esconde nem inventa o espelho: fica como estava. */
export function useChannelMirror(channelId: string): ChannelMirror | null {
  const [mirror, setMirror] = useState<ChannelMirror | null>(null)
  useEffect(() => {
    let alive = true
    setMirror(null)
    const read = () => { void api.channelProgramming(channelId).then(value => { if (alive) setMirror(value.mirror) }).catch(() => undefined) }
    read()
    const timer = window.setInterval(read, 30_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [channelId])
  return mirror
}

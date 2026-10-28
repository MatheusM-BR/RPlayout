import { useEffect, useState } from 'react'
import { api, type ChannelMirror } from '../api.js'

export const MIRROR_CHANGED = 'rplayout:mirror-changed'
export const announceMirrorChange = () => window.dispatchEvent(new Event(MIRROR_CHANGED))

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
    window.addEventListener(MIRROR_CHANGED, read)
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener(MIRROR_CHANGED, read) }
  }, [channelId])
  return mirror
}

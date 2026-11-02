import { useEffect, useRef, useState } from 'react'
import { useVisiblePolling } from './live-topics.js'
import { api, type ChannelMirror } from '../api.js'

export const MIRROR_CHANGED = 'rplayout:mirror-changed'
export const announceMirrorChange = () => window.dispatchEvent(new Event(MIRROR_CHANGED))

/** Espelho do canal (se houver), relido a cada 30 s. Falha de leitura não
 * esconde nem inventa o espelho: fica como estava. */
export function useChannelMirror(channelId: string): ChannelMirror | null {
  const [mirror, setMirror] = useState<ChannelMirror | null>(null)
  const reader = useRef<() => void>(() => undefined)
  useEffect(() => {
    let alive = true
    setMirror(null)
    const read = () => { void api.channelProgramming(channelId).then(value => { if (alive) setMirror(value.mirror) }).catch(() => undefined) }
    reader.current = read
    read()
    window.addEventListener(MIRROR_CHANGED, read)
    return () => { alive = false; reader.current = () => undefined; window.removeEventListener(MIRROR_CHANGED, read) }
  }, [channelId])
  // Mudança feita nesta aba avisa na hora (MIRROR_CHANGED); a de outra
  // estação aparece em até 1 min com a aba visível.
  useVisiblePolling(() => reader.current(), 60_000)
  return mirror
}

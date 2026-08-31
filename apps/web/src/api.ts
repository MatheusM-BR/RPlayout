import type { AudioLevel, Anchor, EditScope, Trim } from '@rplayout/protocol'
import type { MediaAsset, Rundown } from '@rplayout/protocol'
import type { Snapshot } from './types.js'

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null)
    throw new Error(
      typeof detail === 'object' && detail && 'error' in detail
        ? String((detail as { error: unknown }).error)
        : `Falha em ${path}`,
    )
  }
  return (await response.json()) as T
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  send<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  state: () => send<{ rundowns: Rundown[] }>('/api/state'),
  assets: () => send<{ assets: MediaAsset[] }>('/api/assets'),
  rundown: (id: string) => send<Snapshot>(`/api/rundowns/${id}`),

  addItem: (
    rundownId: string,
    body: {
      mediaId?: string | null
      sourceRef?: string | null
      type: 'VT' | 'LIVE' | 'GFX' | 'SLATE' | 'COMMERCIAL' | 'FILLER'
      title?: string
      anchor?: Anchor
      durationOverride?: number | null
    },
  ) => post<Snapshot>(`/api/rundowns/${rundownId}/items`, body),

  patchItem: (id: string, body: Record<string, unknown>) =>
    send<Snapshot>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeItem: (id: string) => send<Snapshot>(`/api/items/${id}`, { method: 'DELETE' }),

  moveItem: (id: string, toIndex: number) =>
    post<Snapshot>(`/api/items/${id}/move`, { toIndex }),

  setTrim: (id: string, trim: Trim, scope: EditScope) =>
    post<Snapshot & { result: { message: string } }>(`/api/items/${id}/trim`, { trim, scope }),

  setAudio: (id: string, audio: AudioLevel, scope: EditScope) =>
    post<Snapshot & { result: { message: string } }>(`/api/items/${id}/audio`, { audio, scope }),

  transport: (channelId: string, action: 'take' | 'cue' | 'stop', itemId?: string | null) =>
    post<Snapshot>(`/api/channels/${channelId}/transport`, { action, itemId }),
}

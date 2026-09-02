import type {
  AudioLevel,
  Anchor,
  EditScope,
  GraphicTemplate,
  ItemGraphic,
  Trim,
} from '@rplayout/protocol'
import type { MediaAsset, Rundown } from '@rplayout/protocol'
import type {
  Distribution,
  LibraryFolder,
  OutputProfile,
  ScanStatus,
  Snapshot,
  SourceList,
} from './types.js'

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
  library: () => send<{ folders: LibraryFolder[] }>('/api/library'),
  scanStatus: () => send<ScanStatus>('/api/library/scan'),
  outputs: (channelId: string) =>
    send<{ outputs: OutputProfile[] }>(`/api/channels/${channelId}/outputs`),
  addOutput: (channelId: string, body: { name: string; kind: string; target: string }) =>
    post<{ restartRequired: boolean }>(`/api/channels/${channelId}/outputs`, body),
  patchOutput: (id: string, body: Record<string, unknown>) =>
    send<{ ok: boolean }>(`/api/outputs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  removeOutput: (id: string) => send<{ ok: boolean }>(`/api/outputs/${id}`, { method: 'DELETE' }),
  scan: () => send<ScanStatus>('/api/library/scan', { method: 'POST', body: '{}' }),
  /** `refresh` força uma varredura nova em vez de usar o resultado guardado. */
  sources: (refresh = false) => send<SourceList>(`/api/sources${refresh ? '?refresh=1' : ''}`),
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

  distribution: () => send<Distribution>('/api/distribution'),

  graphics: (channelId: string) =>
    send<{ templates: GraphicTemplate[] }>(`/api/graphics?channelId=${channelId}`),
  showGraphic: (channelId: string, templateId: string, values: Record<string, string>) =>
    post<Snapshot>(`/api/channels/${channelId}/graphic`, { templateId, values }),
  hideGraphic: (channelId: string) =>
    send<Snapshot>(`/api/channels/${channelId}/graphic`, { method: 'DELETE' }),

  itemGraphics: (itemId: string) => send<{ cues: ItemGraphic[] }>(`/api/items/${itemId}/graphics`),
  addItemGraphic: (
    itemId: string,
    templateId: string,
    values: Record<string, string>,
    atSeconds: number,
  ) => post<{ cues: ItemGraphic[] }>(`/api/items/${itemId}/graphics`, {
    templateId,
    values,
    atSeconds,
  }),
  removeItemGraphic: (id: string) =>
    send<{ cues: ItemGraphic[] }>(`/api/item-graphics/${id}`, { method: 'DELETE' }),

  addGuest: (channelId: string, label: string) =>
    post<{ streamKey: string; publishUrl: string }>(`/api/channels/${channelId}/guests`, { label }),
  removeGuest: (id: string) => send<{ ok: true }>(`/api/guests/${id}`, { method: 'DELETE' }),

  addDestination: (channelId: string, name: string, url: string) =>
    post<{ ok: true }>(`/api/channels/${channelId}/destinations`, { name, url }),
  setDestination: (id: string, body: { enabled?: boolean }) =>
    send<{ ok: true }>(`/api/destinations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeDestination: (id: string) =>
    send<{ ok: true }>(`/api/destinations/${id}`, { method: 'DELETE' }),

  undo: (rundownId: string) => post<Snapshot & { label: string }>(`/api/rundowns/${rundownId}/undo`, {}),
  redo: (rundownId: string) => post<Snapshot & { label: string }>(`/api/rundowns/${rundownId}/redo`, {}),

  group: (rundownId: string, itemIds: string[]) =>
    post<Snapshot>(`/api/rundowns/${rundownId}/blocks`, { itemIds }),
  ungroup: (blockId: string) => post<Snapshot>(`/api/blocks/${blockId}/ungroup`, {}),

  transport: (
    channelId: string,
    action: 'take' | 'cue' | 'stop' | 'park',
    target?: { itemId?: string | null; assetId?: string | null },
  ) => post<Snapshot>(`/api/channels/${channelId}/transport`, { action, ...target }),
}

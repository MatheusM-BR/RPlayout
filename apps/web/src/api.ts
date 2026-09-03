import type {
  AudioLevel,
  Anchor,
  EditScope,
  GraphicTemplate,
  ItemGraphic,
  Trim,
} from '@rplayout/protocol'
import type { Channel, MediaAsset, Rundown } from '@rplayout/protocol'
import type {
  AsRunEntry,
  Distribution,
  FillPlan,
  ScheduleRule,
  LibraryFolder,
  MediaRoot,
  OutputProfile,
  Categoria,
  PlaylistEntryView,
  PlaylistFile,
  ScanStatus,
  Snapshot,
  SourceList,
} from './types.js'

/**
 * O motivo da falha, em texto que serve para alguém agir.
 *
 * O servidor responde de duas formas: `error`, que é nossa e já vem escrita
 * para gente, e `message`, que é o que o Fastify põe quando algo estourou
 * antes de chegar na rota -- é onde mora, por exemplo, a queixa do banco de
 * dados. Ler só a primeira deixava o operador com "Falha em /api/…", que não
 * diz nada e não dá para me mandar.
 *
 * Detalhe de validação vem como objeto; virar "[object Object]" na tela seria
 * pior que não mostrar, então ele é serializado.
 */
function motivo(detalhe: unknown, path: string, status: number): string {
  if (typeof detalhe === 'object' && detalhe !== null) {
    const corpo = detalhe as { error?: unknown; message?: unknown }
    const bruto = corpo.error ?? corpo.message
    if (typeof bruto === 'string' && bruto.trim() !== '') return bruto
    if (bruto !== undefined) return JSON.stringify(bruto)
  }
  return `Falha em ${path} (HTTP ${status})`
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null)
    throw new Error(motivo(detail, path, response.status))
  }
  return (await response.json()) as T
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  send<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  state: () => send<{ channels: Channel[]; rundowns: Rundown[] }>('/api/state'),
  patchChannel: (
    id: string,
    body: {
      name?: string
      width?: number
      height?: number
      rateNum?: number
      rateDen?: number
      scan?: string
      fieldOrder?: string
    },
  ) =>
    send<{ ok: boolean; restarted: boolean; formatChanged: boolean }>(`/api/channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  addChannel: (name: string) =>
    post<{ channelId: string; rundownId: string }>('/api/channels', { name }),
  assets: () => send<{ assets: MediaAsset[] }>('/api/assets'),
  library: () => send<{ folders: LibraryFolder[]; roots: MediaRoot[] }>('/api/library'),

  patchAsset: (id: string, body: { title?: string; categoryId?: string | null }) =>
    send<{ ok: true }>(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  /**
   * Tira do acervo. Arquivo em uso responde conflito em vez de sair calado --
   * a grade que aponta para ele perderia a referência.
   */
  removeAsset: async (id: string, force = false) => {
    const response = await fetch(`/api/assets/${id}${force ? '?force=1' : ''}`, {
      method: 'DELETE',
    })
    const corpo = (await response.json()) as { error?: string; items?: number }
    if (response.status === 409) return { conflito: corpo.error, items: corpo.items }
    if (!response.ok) throw new Error(corpo.error ?? 'Não consegui tirar o arquivo.')
    return { conflito: null }
  },
  pruneAssets: () =>
    post<{ removed: number; removedItems: number }>('/api/assets/prune', {}),
  removeChannel: (id: string) =>
    send<{ ok: true }>(`/api/channels/${id}`, { method: 'DELETE' }),
  scanStatus: () => send<ScanStatus>('/api/library/scan'),
  mediaRoots: () => send<{ roots: MediaRoot[] }>('/api/library/roots'),
  addMediaRoot: (path: string, label?: string) =>
    post<{ root: MediaRoot; scanning: boolean }>('/api/library/roots', { path, label }),
  removeMediaRoot: (id: string) =>
    send<{ ok: true }>(`/api/library/roots/${id}`, { method: 'DELETE' }),
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
  /** `measure` desligado lê muito mais rápido e deixa a loudness para depois. */
  scan: (measure = true) =>
    send<ScanStatus>('/api/library/scan', {
      method: 'POST',
      body: JSON.stringify({ measure }),
    }),
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
      atIndex?: number
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

  autoFill: (
    rundownId: string,
    body: { minutes: number; avoidHours: number; preview: boolean },
  ) => post<Partial<Snapshot> & { plan: FillPlan }>(`/api/rundowns/${rundownId}/autofill`, body),

  rules: (channelId: string) =>
    send<{ rules: ScheduleRule[] }>(`/api/channels/${channelId}/rules`),
  addRule: (
    channelId: string,
    body: {
      name: string
      weekdays: string
      startMinute: number
      endMinute: number
      categories: string[]
      avoidHours: number
    },
  ) => post<{ rule: ScheduleRule }>(`/api/channels/${channelId}/rules`, body),
  /** "Estou com este monitor aberto." O engine só codifica enquanto há aviso. */
  watching: (channelId: string, bus: 'pvw' | 'mon') =>
    post<{ ok: true }>(`/api/channels/${channelId}/watching`, { bus }),

  playlists: () =>
    send<{ playlists: PlaylistFile[]; today: string | null; date: string }>('/api/playlists'),
  playlistEntries: (path: string) =>
    send<{ entries: PlaylistEntryView[] }>(
      `/api/playlists/entries?path=${encodeURIComponent(path)}`,
    ),
  loadPlaylist: (rundownId: string, path: string, replace: boolean) =>
    post<Snapshot & { loaded: number; skipped: number }>(
      `/api/rundowns/${rundownId}/playlist`,
      { path, replace },
    ),

  categories: () => send<{ categories: Categoria[] }>('/api/categories'),
  setCategoryColor: (id: string, color: string) =>
    send<{ ok: true }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ color }),
    }),
  removeCategory: (id: string) =>
    send<{ ok: true; soltos: number }>(`/api/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  removeRule: (id: string) => send<{ ok: true }>(`/api/rules/${id}`, { method: 'DELETE' }),
  autoFillDay: (rundownId: string) =>
    post<Snapshot & { bands: { rule: string; items: number; leftover: number }[] }>(
      `/api/rundowns/${rundownId}/autofill-day`,
      {},
    ),

  asRun: (channelId: string) =>
    send<{ since: string; entries: AsRunEntry[] }>(`/api/channels/${channelId}/asrun`),

  graphics: (channelId: string) =>
    send<{ templates: GraphicTemplate[] }>(`/api/graphics?channelId=${channelId}`),
  showGraphic: (channelId: string, templateId: string, values: Record<string, string>) =>
    post<Snapshot>(`/api/channels/${channelId}/graphic`, { templateId, values }),
  hideGraphic: (channelId: string) =>
    send<Snapshot>(`/api/channels/${channelId}/graphic`, { method: 'DELETE' }),

  setSlate: (channelId: string, templateId: string | null) =>
    send<{ ok: true }>(`/api/channels/${channelId}/slate`, {
      method: 'PATCH',
      body: JSON.stringify({ templateId }),
    }),

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

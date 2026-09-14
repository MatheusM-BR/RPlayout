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
    const bruto = corpo.message ?? corpo.error
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
  session: () => send<{ role: string; label: string; authenticated: boolean; required: boolean }>('/api/session'),
  logout: () => post<{ ok: true }>('/api/auth/logout', {}),
  users: () => send<{ users: Array<{ id: string; username: string; role: string; enabled: boolean; createdAt: string }> }>('/api/users'),
  addUser: (body: { username: string; password: string; role: string }) => post('/api/users', body),
  patchUser: (id: string, body: Record<string, unknown>) => send<{ ok: true }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  integrations: (channelId?: string) => send<{ integrations: Array<{ id: string; name: string; url: string; events: string[]; enabled: boolean; channelId: string | null }> }>(`/api/integrations${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ''}`),
  addIntegration: (body: { channelId: string | null; name: string; url: string; events: string[] }) => post('/api/integrations', body),
  patchIntegration: (id: string, body: Record<string, unknown>) => send<{ ok: true }>(`/api/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  testIntegration: (id: string) => post<{ ok: boolean; status?: number; error?: string }>(`/api/integrations/${id}/test`, {}),
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
  pickMediaRoot: async () => {
    const response = await fetch('/api/library/roots/pick', { method: 'POST' })
    if (response.status === 204) return null
    const body = (await response.json()) as { root: MediaRoot; scanning: boolean; error?: string }
    if (!response.ok) throw new Error(body.error ?? 'Não consegui acrescentar a pasta.')
    return body
  },

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
  /** Levanta o canal de novo, para os perfis de saída de agora valerem. */
  restartChannel: (id: string) => post<{ ok: true }>(`/api/channels/${id}/restart`, {}),
  removeChannel: (id: string) =>
    send<{ ok: true }>(`/api/channels/${id}`, { method: 'DELETE' }),
  scanStatus: () => send<ScanStatus>('/api/library/scan'),
  mediaRoots: () => send<{ roots: MediaRoot[] }>('/api/library/roots'),
  /**
   * Lê uma lista arrastada para a janela.
   *
   * Vai o conteúdo, não o caminho: o navegador não entrega o caminho de um
   * arquivo arrastado, e é por isso que este caminho existe separado do que
   * lê as listas que moram na pasta do acervo.
   */
  readPlaylist: (name: string, text: string) =>
    post<{ name: string; date: string | null; entries: PlaylistEntryView[]; missing: number }>(
      '/api/playlists/read',
      { name, text },
    ),
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
  processes: () =>
    send<{
      generatedAt: string
      processes: Array<{
        id: string
        kind: 'ENGINE' | 'MEDIAMTX' | 'OUTPUT'
        channelId: string | null
        pid: number | null
        state: string
        cpuTimeMs: number | null
        memoryBytes: number | null
        details?: Record<string, unknown>
      }>
    }>('/api/processes'),
  healthEvents: (channelId?: string) => send<{ events: Array<{ id: string; channelId: string | null; component: string; state: string; severity: 'INFO' | 'WARN' | 'CRITICAL'; message: string | null; occurredAt: string; acknowledgedAt: string | null }> }>(`/api/health-events?limit=200${channelId ? `&channelId=${encodeURIComponent(channelId)}` : ''}`),
  acknowledgeHealth: (id: string) => post<{ ok: true }>(`/api/health-events/${id}/ack`, {}),
  schedulerStatus: () => send<{ checkedAt: string; channels: Array<{ channelId: string; rundownId: string | null; activeRule: { name: string; startMinute: number; endMinute: number } | null; endsAtFrames: number; minutesRemaining: number; coverageMinutes: number; coverageHours: number; targetHours: number; coverageReady: boolean }> }>('/api/scheduler/status'),
  n1Status: () => send<{ configured: boolean; peer: string | null; reachable: boolean; latencyMs: number | null; checkedAt: string; error: string | null }>('/api/n1/status'),
  timeline: (channelId: string) => send<{ channelId: string; nowFrames: number; items: Array<{ itemId: string; title: string; type: string; start: number; end: number; duration: number; state: 'ON_AIR' | 'UP_NEXT' | 'AIRED' }> }>(`/api/channels/${encodeURIComponent(channelId)}/timeline`),

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
  loadPlaylist: (rundownId: string, path: string, replace: boolean, scheduledDate?: string) =>
    post<Snapshot & { loaded: number; skipped: number }>(
      `/api/rundowns/${rundownId}/playlist`,
      { path, replace, scheduledDate },
    ),
  /** Lista arrastada para a janela: vai o conteúdo, porque não há caminho. */
  loadPlaylistText: (rundownId: string, text: string, replace: boolean, scheduledDate?: string) =>
    post<Snapshot & { loaded: number; skipped: number }>(
      `/api/rundowns/${rundownId}/playlist`,
      { text, replace, scheduledDate },
    ),
  playlistVersions: (rundownId: string) =>
    send<{ versions: Array<{ id: string; sourceName: string; mode: 'APPEND' | 'PUBLISH_NEXT'; loaded: number; skipped: number; scheduledDate: string | null; publishedAt: string }> }>(
      `/api/rundowns/${rundownId}/playlist-versions`,
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
  updateRule: (id: string, body: Partial<{ name: string; weekdays: string; startMinute: number; endMinute: number; categories: string[]; avoidHours: number }>) =>
    send<{ rule: ScheduleRule }>(`/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
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

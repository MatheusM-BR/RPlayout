import { create } from 'zustand'
import type { Channel } from '@rplayout/protocol'
import type { RundownView, ItemView } from '../types.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'

export type TransitionType = 'CUT' | 'MIX' | 'WIPE'

interface PlayoutState {
  workspace: WorkspaceId
  channel: Channel | null
  channels: Channel[]
  view: RundownView | null
  followOnAir: boolean
  transitionMode: TransitionType
  abortArmed: boolean
  abortCountdown: number
  safeAreasVisible: boolean
  conflictDrawerOpen: boolean
  selectedItemId: string | null

  // Actions
  setWorkspace: (workspace: WorkspaceId) => void
  setChannel: (channel: Channel) => void
  setChannels: (channels: Channel[]) => void
  setView: (view: RundownView | null) => void
  setFollowOnAir: (follow: boolean | ((prev: boolean) => boolean)) => void
  setTransitionMode: (mode: TransitionType) => void
  setAbortArmed: (armed: boolean) => void
  setAbortCountdown: (count: number | ((prev: number) => number)) => void
  toggleSafeAreas: () => void
  setConflictDrawerOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  setSelectedItemId: (id: string | null) => void
}

export const usePlayoutStore = create<PlayoutState>((set) => ({
  workspace: 'master',
  channel: null,
  channels: [],
  view: null,
  followOnAir: false,
  transitionMode: 'CUT',
  abortArmed: false,
  abortCountdown: 3,
  safeAreasVisible: true,
  conflictDrawerOpen: false,
  selectedItemId: null,

  setWorkspace: (workspace) => set({ workspace }),
  setChannel: (channel) => set({ channel }),
  setChannels: (channels) => set({ channels }),
  setView: (view) => set({ view }),
  setFollowOnAir: (follow) =>
    set((state) => ({ followOnAir: typeof follow === 'function' ? follow(state.followOnAir) : follow })),
  setTransitionMode: (transitionMode) => set({ transitionMode }),
  setAbortArmed: (abortArmed) => set({ abortArmed }),
  setAbortCountdown: (count) =>
    set((state) => ({ abortCountdown: typeof count === 'function' ? count(state.abortCountdown) : count })),
  toggleSafeAreas: () => set((state) => ({ safeAreasVisible: !state.safeAreasVisible })),
  setConflictDrawerOpen: (open) =>
    set((state) => ({ conflictDrawerOpen: typeof open === 'function' ? open(state.conflictDrawerOpen) : open })),
  setSelectedItemId: (selectedItemId) => set({ selectedItemId }),
}))

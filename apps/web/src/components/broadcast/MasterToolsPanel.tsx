import type { Rate } from '@rplayout/protocol'
import type { LibraryAsset } from '../../types.js'
import { useStoredChoice } from '../../domain/stored-choice.js'
import { DynamicCgSecondaryBar } from './DynamicCgSecondaryBar.js'
import { OverlaysPanel } from './OverlaysPanel.js'
import { OperationalInsertionPanel } from './OperationalInsertionPanel.js'
import { NextPlaylistPanel } from './NextPlaylistPanel.js'
import { ContingencyTool } from './PgmProbeBanner.js'

const TABS = [
  { id: 'overlays', label: 'OVERLAYS', icon: 'layers' },
  { id: 'gfx', label: 'GRAFISMOS', icon: 'subtitles' },
  { id: 'insert', label: 'INSERÇÃO', icon: 'playlist_add' },
  { id: 'next', label: 'PRÓX. GRADE', icon: 'queue_play_next' },
  { id: 'contingency', label: 'CONTINGÊNCIA', icon: 'emergency' },
] as const
type ToolId = typeof TABS[number]['id']
export const MASTER_TOOL_IDS: readonly ToolId[] = TABS.map(tab => tab.id)

/** Ferramentas do Master numa gaveta em abas (U1). Todas ficam montadas
 * (estado e consultas continuam, ex.: passagem de grade enfileirada); a aba
 * só escolhe qual aparece, e a escolha fica guardada nesta estação. */
export function MasterToolsPanel({ channelId, rate, assets }: { channelId: string; rate: Rate; assets: readonly LibraryAsset[] }) {
  const [tab, setTab] = useStoredChoice<ToolId>('rplayout.master.tool', MASTER_TOOL_IDS, 'overlays')
  return (
    <section className="flex-1 min-h-[180px] flex flex-col bg-surface-card border border-border-subtle rounded-xl overflow-hidden" aria-label="Ferramentas do Master">
      <div role="tablist" className="flex shrink-0 border-b border-border-subtle bg-surface-panel">
        {TABS.map(item => (
          <button key={item.id} role="tab" type="button" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1 px-1 py-2 font-label-caps text-[11px] font-bold tracking-wide border-b-2 transition-colors ${tab === item.id ? 'border-primary text-primary bg-surface-card' : 'border-transparent text-outline hover:text-on-surface'}`}>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 broadcast-scroll">
        <div hidden={tab !== 'overlays'}><OverlaysPanel channelId={channelId} defaultOpen /></div>
        <div hidden={tab !== 'gfx'}><DynamicCgSecondaryBar channelId={channelId} /></div>
        <div hidden={tab !== 'insert'}><OperationalInsertionPanel channelId={channelId} rate={rate} assets={assets} defaultOpen /></div>
        <div hidden={tab !== 'next'}><NextPlaylistPanel channelId={channelId} defaultOpen /></div>
        <div hidden={tab !== 'contingency'}><ContingencyTool channelId={channelId} /></div>
      </div>
    </section>
  )
}

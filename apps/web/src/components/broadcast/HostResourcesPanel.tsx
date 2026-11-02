import { useEffect, useState } from 'react'
import { api, type HostMetricSample } from '../../api.js'
import {OperationalHistoryPanel} from './OperationalHistoryPanel.js'
import {StorageStatusPanel} from './StorageStatusPanel.js'
import {UpgradeBackupPanel} from './UpgradeBackupPanel.js'
import {HostMetricHistoryPanel} from './HostMetricHistoryPanel.js'

const pct = (value: number | null | undefined) => value == null ? 'N/D' : `${value.toFixed(1)}%`
const bytes = (value: number | null | undefined) => value == null ? 'N/D' : `${(value / 1024 ** 3).toFixed(2)} GB`
const traffic = (value: number | null | undefined) => value == null ? 'N/D' : `${(value * 8 / 1_000_000).toFixed(2)} Mbps`

/** History is collected by the server even with every browser disconnected. */
export function HostResourcesPanel({channels=[],initialChannelId}:{channels?:readonly {id:string;name:string}[];initialChannelId?:string}) {
  const [current, setCurrent] = useState<HostMetricSample | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true,pending=false,controller:AbortController|null=null
    const refresh = async () => {
      if(pending||!active)return
      pending=true;controller=new AbortController()
      const timeout=window.setTimeout(()=>controller?.abort(),10000)
      try {
        const sample = await api.hostMetrics(controller.signal)
        if (!active) return
        setCurrent(sample); setError(null)
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Histórico indisponível.')
      }finally{window.clearTimeout(timeout);pending=false}
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => { active = false;controller?.abort();window.clearInterval(timer) }
  }, [])
  return <section aria-label="Recursos e histórico do servidor" className="h-full overflow-auto rounded-lg border border-border-subtle bg-surface-panel p-4 text-on-surface">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <div><h2 className="font-semibold">Recursos e histórico do servidor</h2>
        <p className="text-xs text-outline">Coleta central a cada 10 s · retenção de 14 dias · ausência de medição aparece como N/D.</p></div>
    </div>
    <OperationalHistoryPanel channels={channels} initialChannelId={initialChannelId}/>
    <StorageStatusPanel/>
    <UpgradeBackupPanel/>
    {error && <p role="alert" className="text-on-air-crimson text-sm mb-3">Recursos globais do servidor: {error} Os dados globais exibidos abaixo podem estar desatualizados. O histórico por canal é consultado separadamente.</p>}
    <div className="grid sm:grid-cols-3 gap-3 mb-3 text-sm">
      <div className="bg-surface-base p-3 rounded"><h3>Volume do acervo</h3><p>{pct(current?.disk.percentUsed)} utilizado · {bytes(current?.disk.freeBytes)} livres</p><p className="text-xs text-outline break-all">{current?.disk.path}</p>{current?.disk.error && <p className="text-armed-amber text-xs">{current.disk.error}</p>}</div>
      <div className="bg-surface-base p-3 rounded"><h3>Tráfego da máquina</h3><p>Recepção {traffic(current?.network.receivedBytesPerSecond)} · envio {traffic(current?.network.sentBytesPerSecond)}</p><p className="text-xs text-outline">{current?.network.source ?? current?.network.error ?? 'Aguardando dois contadores válidos.'}</p></div>
      <div className="bg-surface-base p-3 rounded"><h3>Processo do servidor</h3><p>RAM {bytes(current?.process.rssBytes)} · heap {bytes(current?.process.heapUsedBytes)}</p><p className="text-xs text-outline">Última coleta: {current ? new Date(current.generatedAt).toLocaleString('pt-BR') : 'aguardando'}</p></div>
    </div>
    <HostMetricHistoryPanel/>
  </section>
}

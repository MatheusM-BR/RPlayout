import type {ManagedLiveSource,SrtTelemetry,LiveSignalPolicy} from '@rplayout/protocol'
import type {Live} from '../../types.js'
import {qcLiveSourceStatus} from '../../domain/qc-live-source-status.js'

export function QcLiveSourceRow({source,telemetry,selected,signal,onSelect,disabled,previewTarget,transportMode,now,policy}:{
  source:ManagedLiveSource;telemetry?:SrtTelemetry;selected:boolean;signal?:Live['transport']['liveSources'][number]
  onSelect:()=>void;disabled:boolean;previewTarget?:Live['transport']['preview'];transportMode?:Live['transport']['mode'];now:number;policy?:LiveSignalPolicy
}){
  const status=qcLiveSourceStatus(source,signal,previewTarget,transportMode,now,policy)
  const statusClass=status.tone==='error'?'text-on-air-crimson border-on-air-crimson/35 bg-on-air-crimson/10':
    status.tone==='ok'?'text-status-ok border-status-ok/35 bg-status-ok/10':'text-armed-amber border-armed-amber/35 bg-armed-amber/10'
  return <button type="button" onClick={onSelect} disabled={disabled}
    className={`w-full p-2 rounded-lg border flex items-center gap-2.5 text-left transition-all cursor-pointer ${selected?'bg-primary-container/20 border-primary shadow-sm ring-1 ring-primary/40':'bg-surface-panel hover:bg-surface-panel/80 border-border-subtle hover:border-border-strong'}`}
    title="Abrir esta fonte no PVW compartilhado e assistir no player QC">
    <span className="material-symbols-outlined text-accent-ice text-[20px]">sensors</span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5"><strong className="truncate font-headline-md text-[12px] text-on-surface">{source.name}</strong><span className="rounded bg-surface-base px-1 font-label-mono text-[10px] text-accent-ice">{source.kind}</span></span>
      <span className="mt-0.5 block truncate font-label-mono text-[10px] text-outline" title={source.targetUrl}>{telemetry?`Rede SRT · ${telemetry.bitrateKbps} kbps · RTT ${telemetry.rttMs.toFixed(0)} ms · perda ${telemetry.packetLossPercent.toFixed(2)}% · não confirma vídeo`:source.targetUrl}</span>
      {status.details&&<span className="mt-0.5 block font-label-mono text-[10px] text-outline" title={status.detailsTitle}>{status.details}</span>}
    </span>
    <span className={`rounded border px-1.5 py-0.5 font-label-mono text-[10px] font-bold ${statusClass}`}>{status.label}</span>
  </button>
}

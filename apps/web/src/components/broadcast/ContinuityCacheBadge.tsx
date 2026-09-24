import { useState } from 'react'

interface Props {
  className?: string
  coverage48h?: number
  coverage7d?: number
  isAutonomous?: boolean
  diskUsagePercent?: number
  freeDiskGb?: number
  totalDiskGb?: number
}

export function ContinuityCacheBadge({
  className = '',
  coverage48h = 100,
  coverage7d = 96.5,
  isAutonomous = true,
  diskUsagePercent = 34,
  freeDiskGb = 1320,
  totalDiskGb = 2000,
}: Props) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <div
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => setShowTooltip((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#051a14] border border-status-ok/40 hover:border-status-ok text-status-ok-bright cursor-pointer transition-all shadow-sm group select-none"
        title="Cache de Continuidade 48h (XMirror) - Clique para telemetria detalhada"
      >
        <span className="material-symbols-outlined text-[15px] text-status-ok group-hover:scale-110 transition-transform">
          offline_bolt
        </span>
        <div className="flex items-center gap-1">
          <span className="font-label-caps text-[10px] font-bold tracking-wide uppercase text-status-ok-bright whitespace-nowrap">
            Cache 48h: 100% AIR-GAP
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse"></span>
        </div>
      </div>

      {/* Popover técnico detalhado com métricas do SSD e Pre-warming */}
      {showTooltip && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-72 bg-surface-card border border-border-strong rounded-xl p-3 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 text-on-surface">
          <div className="flex items-center justify-between pb-2 border-b border-border-subtle mb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-status-ok text-[18px]">verified_user</span>
              <span className="font-headline-md text-[12px] font-bold uppercase tracking-wider text-on-surface">
                Cache de Continuidade (XMirror)
              </span>
            </div>
            <span className="font-label-mono text-[9px] bg-status-ok/15 text-status-ok px-1.5 py-0.5 rounded font-bold border border-status-ok/30">
              NVMe LOCAL
            </span>
          </div>

          <div className="flex flex-col gap-2 font-label-mono text-[10px]">
            {/* 48h Crítico */}
            <div className="flex items-center justify-between">
              <span className="text-outline">Buffer Crítico (48 Horas):</span>
              <span className="text-status-ok font-bold tabular-nums">{coverage48h.toFixed(1)}% (100% Local SSD)</span>
            </div>
            <div className="w-full bg-surface-container-lowest h-1.5 rounded-full overflow-hidden">
              <div className="bg-status-ok h-full rounded-full" style={{ width: `${coverage48h}%` }}></div>
            </div>

            {/* 7d Estendido */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-outline">Grade Estendida (7 Dias):</span>
              <span className="text-accent-ice font-bold tabular-nums">{coverage7d.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-surface-container-lowest h-1.5 rounded-full overflow-hidden">
              <div className="bg-accent-ice h-full rounded-full" style={{ width: `${coverage7d}%` }}></div>
            </div>

            {/* Armazenamento SSD */}
            <div className="pt-2 border-t border-border-subtle/50 flex items-center justify-between text-[9.5px]">
              <span className="text-outline">Ocupação SSD NVMe:</span>
              <span className="text-on-surface tabular-nums">
                {diskUsagePercent}% ({totalDiskGb - freeDiskGb} GB / {totalDiskGb} GB)
              </span>
            </div>

            <div className="pt-1 flex items-center justify-between text-[9px] text-outline">
              <span>Isolamento Total:</span>
              <span className="text-status-ok font-semibold">
                {isAutonomous ? 'AUTÔNOMO (Zero-Network Dependency)' : 'Sincronizando'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

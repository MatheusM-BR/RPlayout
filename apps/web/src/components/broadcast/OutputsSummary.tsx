import type { HostMetricSample } from '../../api.js'
import type { OutputProfile } from '../../types.js'

const STATE: Record<string, { label: string; tone: string }> = {
  onAir: { label: 'NO AR', tone: 'text-status-ok-bright border-status-ok/50' },
  connecting: { label: 'CONECTANDO', tone: 'text-armed-amber border-armed-amber/60' },
  retrying: { label: 'RECONECTANDO', tone: 'text-armed-amber border-armed-amber/60' },
  failed: { label: 'FALHOU', tone: 'text-on-air-crimson border-on-air-crimson/60' },
  idle: { label: 'PARADA', tone: 'text-outline border-border-subtle' },
}

/** Visão integrada: as saídas do canal (o que sai do RPlayout) antes das
 * entradas. Estado vem do engine (amostra de 10 s), nome do cadastro. */
export function OutputsSummary({ sample, channelId, profiles }: { sample: HostMetricSample | null; channelId: string; profiles: readonly OutputProfile[] }) {
  const runtime = sample?.operations?.channels.find(entry => entry.channelId === channelId)?.outputs ?? []
  const enabled = profiles.filter(profile => profile.enabled)
  // A métrica protege a identidade (hash); o nome vem do cadastro quando o
  // destino confere, então o casamento é pelo nome.
  const rows = enabled.map(profile => ({ profile, state: runtime.find(entry => entry.identityType === 'PROFILE' && entry.outputName === profile.name) ?? null }))
  return (
    <section className="shrink-0 rounded-lg border border-border-subtle bg-surface-card" aria-label="Saídas do canal">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <h3 className="font-headline-md text-[14px] font-bold tracking-wide">SAÍDAS DO CANAL</h3>
        <span className="font-label-mono text-[12px] text-outline">{sample ? `${runtime.filter(entry => entry.state === 'onAir').length}/${enabled.length} no ar · amostra ${new Date(sample.generatedAt).toLocaleTimeString('pt-BR')}` : 'Consultando…'}</span>
      </div>
      {enabled.length === 0
        ? <p className="px-3 py-3 text-[12px] text-outline">Nenhuma saída habilitada. Cadastre em Configurações › Saídas de Transmissão.</p>
        : <div className="grid gap-2 p-2 grid-cols-1 md:grid-cols-2 2xl:grid-cols-4">
          {rows.map(({ profile, state }) => {
            const look = state ? STATE[state.state] ?? { label: state.state.toUpperCase(), tone: 'text-outline border-border-subtle' } : { label: sample ? 'SEM LEITURA' : '—', tone: 'text-outline border-border-subtle' }
            return (
              <div key={profile.id} className="rounded border border-border-subtle bg-surface-panel px-3 py-2 min-w-0" title={profile.displayUrl ?? profile.resolvedTarget ?? profile.target}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-body-sm text-[13px] font-semibold">{profile.name}</span>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 font-label-caps text-[11px] font-bold ${look.tone}`}>{look.label}</span>
                </div>
                <div className="mt-1 flex items-center justify-between font-label-mono text-[12px] text-outline">
                  <span>{profile.kind} · {profile.role}</span>
                  <span>{state ? `${state.attempts > 0 ? `${state.attempts} tentativa(s)` : 'estável'}${state.hasError ? ' · com erro' : ''}` : ''}</span>
                </div>
              </div>
            )
          })}
        </div>}
    </section>
  )
}

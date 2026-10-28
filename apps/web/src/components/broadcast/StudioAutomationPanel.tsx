import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ManualExternalRun } from '../../api.js'

type Device = Awaited<ReturnType<typeof api.externalDevices>>['devices'][number]
interface Props { className?: string; onMessage?: (message: string) => void }
const formField = 'min-w-0 rounded border border-border-subtle bg-surface-base px-2 py-2 text-[11px] text-on-surface'
function requestId(): string {
  // getRandomValues also works on HTTP LAN stations; randomUUID may not.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128
  const text = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
}

export function StudioAutomationPanel({ className = '', onMessage }: Props) {
  const [devices, setDevices] = useState<Device[]>([]), [runs, setRuns] = useState<ManualExternalRun[]>([])
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState({ name: '', kind: 'VIDEOHUB_ROUTER' as Device['kind'], host: '', port: '9990' })
  const [selected, setSelected] = useState(''), [source, setSource] = useState(0), [destination, setDestination] = useState(0)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const alive = useRef(false), generation = useRef(0), pendingAction = useRef(false)
  const refresh = useCallback(async () => {
    const expected = ++generation.current
    const [report, history] = await Promise.all([api.externalDevices(), api.externalCommandRuns()])
    if (!alive.current || expected !== generation.current) return
    setDevices(report.devices); setRuns(history.runs)
  }, [])
  useEffect(() => {
    alive.current = true
    const poll = () => { if (!pendingAction.current) void refresh().catch(error => { if (alive.current) setError(error instanceof Error ? error.message : 'Consulta de automação indisponível.') }) }
    poll(); const timer = window.setInterval(poll, 5000)
    return () => { alive.current = false; ++generation.current; window.clearInterval(timer) }
  }, [refresh])
  const perform = async (work: () => Promise<unknown>, message: string) => {
    if (pendingAction.current) return
    pendingAction.current = true; setBusy(true); setError(null); ++generation.current
    try { await work(); if (alive.current) onMessage?.(message) }
    catch (error) { if (alive.current) { const text = error instanceof Error ? error.message : 'Pedido não confirmado. Confira o equipamento.'; setError(text); onMessage?.(text) } }
    finally {
      if (alive.current) { try { await refresh() } catch {} setBusy(false) }
      pendingAction.current = false
    }
  }
  const selectedDevice = devices.find(device => device.id === selected)
  const uncertain = runs.some(run => run.command.deviceId === selected && run.state === 'FIRING')
  const canRoute = selectedDevice?.enabled && selectedDevice.kind === 'VIDEOHUB_ROUTER' && !uncertain && Number.isSafeInteger(source) && Number.isSafeInteger(destination) && source >= 0 && destination >= 0 && source <= 65535 && destination <= 65535
  const control = (device: Device, action: 'PING' | 'ROUTE_CROSSPOINT') => api.controlExternalDevice(device.id, {
    requestId: requestId(), action, ...(action === 'ROUTE_CROSSPOINT' ? { source, destination } : {}),
  })

  return <section id="studio-automation-panel" className={`rounded-xl border border-border-subtle bg-surface-card p-4 ${className}`}>
    <h3 className="font-headline-md text-[15px] font-bold text-on-surface">AUTOMAÇÃO DE ESTÚDIO & CONTROLE EXTERNO</h3>
    <p className="mt-1 text-[11px] text-outline">Consulta não muda a matriz. Roteamento altera um equipamento externo e pode afetar o sinal. Confirmação de estado não homologa vídeo/áudio físico.</p>
    {error && <p role="alert" className="mt-2 rounded border border-on-air-crimson/30 p-2 text-[11px] text-on-air-crimson">{error}</p>}
    {!devices.length && <p className="my-3 text-[11px] text-outline">Nenhum equipamento cadastrado. Não há drivers fictícios conectados.</p>}
    <div className="my-3 grid gap-2 md:grid-cols-3">{devices.map(device => {
      const last = runs.find(run => run.command.deviceId === device.id)
      const supported = device.enabled && device.kind === 'VIDEOHUB_ROUTER'
      return <article key={device.id} className="rounded-lg border border-border-subtle bg-surface-panel p-3 text-[11px]">
        <strong className="block text-on-surface">{device.name}</strong><span className="block truncate text-outline">{device.host}:{device.port} · {device.kind}</span>
        <p className="my-2 text-outline">{!device.enabled ? 'Desativado' : !supported ? 'Driver físico pendente — nenhum comando enviado' : last?.state === 'FIRING' ? 'Pedido em andamento ou incerto' : last?.state === 'EXECUTED' ? `Pedido iniciado às ${new Date(last.createdAt).toLocaleTimeString('pt-BR')} teve confirmação — não é monitoramento contínuo` : last?.state === 'FAILED' ? 'Último pedido falhou — confira o registro' : last?.state === 'CLOSED_UNCERTAIN' ? 'Incerteza reconhecida pelo operador — operação física não confirmada' : 'Cadastrado, ainda sem confirmação'}</p>
        <button className="btn small" disabled={busy || !supported} onClick={() => void perform(() => control(device, 'PING'), 'Videohub respondeu à consulta. Nenhum crosspoint foi alterado.')}>CONSULTAR SEM CORTE</button>
        <button className="btn small ml-2" disabled={busy} onClick={() => void perform(() => api.updateExternalDevice(device.id, { enabled: !device.enabled }), `Cadastro ${device.enabled ? 'desativado' : 'ativado'}. Nenhuma ordem foi enviada ao equipamento; o crosspoint físico não foi alterado.`)}>{device.enabled ? 'DESATIVAR CADASTRO' : 'ATIVAR CADASTRO'}</button>
      </article>
    })}</div>
    <form className="grid gap-2 rounded-lg border border-border-subtle bg-surface-panel p-3 md:grid-cols-[1.2fr_1fr_1fr_90px_auto]" onSubmit={event => {
      event.preventDefault(); const port = Number(draft.port)
      if (!draft.name.trim() || !draft.host.trim() || !Number.isSafeInteger(port) || port < 1 || port > 65535) { setError('Informe nome, endereço e porta válida.'); return }
      void perform(async () => { await api.addExternalDevice({ name: draft.name.trim(), kind: draft.kind, host: draft.host.trim(), port, enabled: true }); if (alive.current) setDraft({ ...draft, name: '', host: '' }) }, 'Equipamento cadastrado; isso não confirma conexão nem sinal.')
    }}>
      <input aria-label="Nome do equipamento" className={formField} placeholder="Nome do equipamento" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/>
      <select aria-label="Tipo do equipamento" className={formField} value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Device['kind'], port: e.target.value === 'VIDEOHUB_ROUTER' ? '9990' : e.target.value === 'ATEM_SWITCHER' ? '9910' : '502' })}>
        <option value="VIDEOHUB_ROUTER">Videohub · TCP</option><option value="ATEM_SWITCHER">ATEM · driver pendente</option><option value="GPIO_RELAY">GPIO · driver pendente</option>
      </select>
      <input aria-label="Endereço do equipamento" className={formField} placeholder="IP ou host no servidor" value={draft.host} onChange={e => setDraft({ ...draft, host: e.target.value })}/>
      <input aria-label="Porta do equipamento" className={formField} type="number" min="1" max="65535" value={draft.port} onChange={e => setDraft({ ...draft, port: e.target.value })}/>
      <button type="submit" className="btn small" disabled={busy}>CADASTRAR</button>
    </form>
    <div className="my-3 rounded-lg border border-armed-amber/30 p-3">
      <h4 className="text-[12px] font-bold text-on-surface">Roteamento manual · Videohub</h4>
      <p className="my-1 text-[11px] text-outline">Portas do protocolo começam em 0: entrada 0 corresponde ao conector 1. Selecione o equipamento explicitamente. Não há tentativa automática após falha.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="field text-[11px]">Equipamento<select aria-label="Equipamento para roteamento" value={selected} onChange={e => setSelected(e.target.value)}><option value="">Selecione</option>{devices.filter(device => device.kind === 'VIDEOHUB_ROUTER' && device.enabled).map(device => <option key={device.id} value={device.id}>{device.name} · {device.host}:{device.port}</option>)}</select></label>
        <label className="field text-[11px]">Entrada (0…N)<input aria-label="Entrada da matriz" type="number" min="0" max="65535" value={source} onChange={e => setSource(Number(e.target.value))}/></label>
        <label className="field text-[11px]">Saída (0…N)<input aria-label="Saída da matriz" type="number" min="0" max="65535" value={destination} onChange={e => setDestination(Number(e.target.value))}/></label>
        <button className="btn small" disabled={busy || !canRoute} onClick={() => {
          if (!selectedDevice || !confirm(`Alterar ${selectedDevice.name}: saída ${destination} receberá entrada ${source}. Isso pode interromper o sinal externo. Confirmar?`)) return
          void perform(() => control(selectedDevice, 'ROUTE_CROSSPOINT'), 'Videohub confirmou o crosspoint solicitado. Confira vídeo/áudio no destino físico.')
        }}>CONFIRMAR ROTEAMENTO</button>
      </div>
      {uncertain && <p className="mt-2 text-[11px] text-armed-amber">Há um pedido em andamento ou incerto. Roteamento bloqueado nesta tela; confira o equipamento e o registro. A consulta sem corte continua disponível.</p>}
    </div>
    <h4 className="text-[12px] font-bold text-on-surface">Pedidos recentes e incertos · registro persistente</h4>
    <p className="mb-2 text-[11px] text-outline">Após queda, FIRING permanece incerto e o mesmo pedido não é reenviado. Aprovação de um pedido não comprova a imagem física.</p>
    <div className="max-h-52 overflow-auto broadcast-scroll">{!runs.length && <p className="text-[11px] text-outline">Nenhum pedido manual registrado.</p>}{runs.map(run => <div key={run.requestId} className="mb-1 rounded border border-border-subtle bg-surface-panel p-2 text-[11px]">
      <span className="text-on-surface">{new Date(run.createdAt).toLocaleString('pt-BR')} · {devices.find(device => device.id === run.command.deviceId)?.name ?? run.command.deviceId} · {run.command.action} · {run.state}</span>
      <span className="block text-outline">{run.command.action === 'ROUTE_CROSSPOINT' ? `saída ${run.command.destination} ← entrada ${run.command.source} · ` : ''}{run.result?.error ?? (run.state === 'FIRING' ? 'Confirmação pendente/incerta; não repetir automaticamente.' : `${run.result?.latencyMs ?? 'N/D'} ms`)} · pedido {run.requestId}</span>
      {run.acknowledgement && <span className="block text-outline">Conferência do operador: {run.acknowledgement} — não equivale a confirmação do pedido original.</span>}
      {run.state === 'FIRING' && <div className="mt-2 flex flex-wrap gap-2">
        <input className={formField + ' flex-1'} aria-label={`Conferência do pedido ${run.requestId}`} placeholder="Descreva o que conferiu no equipamento" value={notes[run.requestId] ?? ''} onChange={e => setNotes({ ...notes, [run.requestId]: e.target.value })}/>
        <button className="btn small" disabled={busy || (notes[run.requestId]?.trim().length ?? 0) < 10} onClick={() => {
          if (!confirm('Registrar sua conferência e liberar novos roteamentos? O pedido original continuará sem confirmação; nenhum comando será reenviado.')) return
          void perform(() => api.acknowledgeExternalCommand(run.requestId, notes[run.requestId]!.trim()), 'Incerteza reconhecida pelo operador, sem reenvio e sem confirmação física do pedido original.')
        }}>REGISTRAR CONFERÊNCIA</button>
      </div>}
    </div>)}</div>
  </section>
}

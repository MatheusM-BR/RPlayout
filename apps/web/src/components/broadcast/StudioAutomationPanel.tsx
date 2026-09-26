import { useState, useEffect } from 'react'
import { api } from '../../api.js'

export interface AutomationDeviceStatus {
  id: string
  name: string
  protocol: 'ATEM_SWITCHER' | 'VIDEOHUB_ROUTER' | 'GPIO_RELAY'
  target: string // IP:Port ou Serial COM
  port: number | string
  state: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING'
  lastLatencyMs: number
  activeCrosspointOrInput?: string
  lastAckTime: string
}

export interface AutomationAuditEntry {
  id: string
  time: string
  targetDevice: string
  action: string
  parameters: string
  latencyMs: number
  status: 'SUCCESS' | 'ACK' | 'TIMEOUT' | 'ERROR'
}

interface Props {
  className?: string
  onMessage?: (msg: string) => void
}

export function StudioAutomationPanel({ className = '', onMessage }: Props) {
  // Só são listados equipamentos realmente configurados. O projeto não tem
  // cadastro de drivers físicos ainda, portanto não inventamos ATEM/Videohub.
  const [devices, setDevices] = useState<AutomationDeviceStatus[]>([])
  const [newDevice, setNewDevice] = useState<{ name: string; kind: 'ATEM_SWITCHER' | 'VIDEOHUB_ROUTER' | 'GPIO_RELAY'; host: string; port: string }>({ name: '', kind: 'ATEM_SWITCHER', host: '', port: '9910' })
  /* Dados antigos de demonstração, mantidos aqui temporariamente só para
     referência de layout; não participam do estado operacional.
  const [devices, setDevices] = useState<AutomationDeviceStatus[]>([
    {
      id: 'atem-main',
      name: 'Blackmagic ATEM 2 M/E Constellation HD',
      protocol: 'BLACKMAGIC_ATEM',
      target: '192.168.10.50',
      port: 9910,
      state: 'CONNECTED',
      lastLatencyMs: 6.4,
      activeCrosspointOrInput: 'PGM: In 3 (Estúdio A) • PVW: In 5 (Playout)',
      lastAckTime: '13:19:42.120',
    },
    {
      id: 'videohub-main',
      name: 'Blackmagic Smart Videohub 40x40',
      protocol: 'VIDEOHUB_ROUTER',
      target: '192.168.10.60',
      port: 9990,
      state: 'CONNECTED',
      lastLatencyMs: 4.1,
      activeCrosspointOrInput: 'Out 1 -> In 5 (PGM Playout 1)',
      lastAckTime: '13:19:38.804',
    },
    {
      id: 'gpio-relay-box',
      name: 'Advantech ADAM-6060 / Tally Relays',
      protocol: 'GPIO_RELAY',
      target: 'COM3 (USB/Modbus TCP)',
      port: '502 / USB',
      state: 'CONNECTED',
      lastLatencyMs: 1.2,
      activeCrosspointOrInput: 'Ch 1: Tally On-Air (LATCH ATIVO)',
      lastAckTime: '13:19:15.002',
    },
  ]) */

  // Log Rápido de Auditoria com Latência de Resposta em ms
  const [auditLogs, setAuditLogs] = useState<AutomationAuditEntry[]>([])
  /* Dados antigos de demonstração, não exibidos nem usados.
  const demoAuditLogs: AutomationAuditEntry[] = [
    {
      id: 'log-1',
      time: '13:19:42.120',
      targetDevice: 'ATEM Constellation HD',
      action: 'TAKE M/E 1',
      parameters: 'Input: 3 (Estúdio A CAM 1), Trans: CUT',
      latencyMs: 8.2,
      status: 'SUCCESS',
    },
    {
      id: 'log-2',
      time: '13:19:35.000',
      targetDevice: 'SCTE-35 Mux / VANC',
      action: 'SPLICE_INSERT',
      parameters: 'Event: 55102, Dur: 30s, Pre-roll: 4000ms',
      latencyMs: 3.4,
      status: 'SUCCESS',
    },
    {
      id: 'log-3',
      time: '13:19:10.450',
      targetDevice: 'Smart Videohub 40x40',
      action: 'ROUTE_CROSSPOINT',
      parameters: 'Dest 4 -> Src 12 (Link Satélite 1)',
      latencyMs: 4.1,
      status: 'ACK',
    },
    {
      id: 'log-4',
      time: '13:18:55.200',
      targetDevice: 'GPIO ADAM-6060',
      action: 'PULSE',
      parameters: 'Relay #2 (Campainha Estúdio) • 150ms',
      latencyMs: 1.2,
      status: 'SUCCESS',
    },
    {
      id: 'log-5',
      time: '13:18:30.010',
      targetDevice: 'ATEM Constellation HD',
      action: 'SET_DSK',
      parameters: 'DSK 1: ON_AIR (Key: CG RGBA Fill+Alpha)',
      latencyMs: 5.6,
      status: 'SUCCESS',
    },
  ] */

  // Teste manual de ping / pulso
  useEffect(() => {
    let alive = true
    const refresh = () => void Promise.all([api.externalAutomationAudit(), api.externalDevices()])
      .then(([{ entries }, deviceReport]) => {
        if (!alive) return
        setDevices(deviceReport.devices.map((device) => ({
          id: device.id, name: device.name, protocol: device.kind, target: device.host, port: device.port,
          state: device.enabled ? 'RECONNECTING' : 'DISCONNECTED', lastLatencyMs: 0, lastAckTime: 'Sem confirmação',
        })))
        setAuditLogs(entries.map((entry) => ({
          id: entry.id,
          time: new Date(entry.timestamp).toLocaleTimeString('pt-BR'),
          targetDevice: entry.targetDevice,
          action: entry.action,
          parameters: entry.error ?? JSON.stringify(entry.details ?? {}),
          latencyMs: entry.latencyMs,
          status: entry.executionStatus === 'SUCCESS' ? 'SUCCESS' : entry.executionStatus === 'ERROR_TIMEOUT' ? 'TIMEOUT' : 'ERROR',
        })))
      })
      .catch(() => { if (alive) { setAuditLogs([]); setDevices([]) } })
    refresh()
    const timer = window.setInterval(refresh, 3000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  return (
    <div
      className={`bg-surface-card border border-border-subtle p-3.5 rounded-xl flex flex-col gap-3 shadow-sm ${className}`}
      id="studio-automation-panel"
    >
      {/* CABEÇALHO DO CARD */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent-ice/15 border border-accent-ice/30 text-accent-ice">
            <span className="material-symbols-outlined text-[20px]">precision_manufacturing</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-headline-md text-[15px] font-bold text-on-surface uppercase tracking-wider">
                AUTOMAÇÃO DE ESTÚDIO & CONTROLE EXTERNO
              </h3>
              <span className="font-label-mono text-[9px] bg-status-ok/15 text-status-ok font-bold px-1.5 py-0.2 rounded border border-status-ok/30">
                AUDITORIA REAL
              </span>
            </div>
            <p className="font-label-mono text-[10px] text-outline">
              Comandos e confirmações recebidos pelo gateway de controle externo.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-label-mono text-[10px] text-outline">
          <span className="inline-flex items-center gap-1 text-outline font-bold">
            <span className="w-2 h-2 rounded-full bg-outline"></span>
            {devices.length} DISPOSITIVOS CONFIGURADOS
          </span>
          <span>•</span>
          <span>{auditLogs.length} COMANDOS AUDITADOS</span>
        </div>
      </div>

      {/* GRADE DE STATUS DOS DISPOSITIVOS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        {devices.length === 0 && (
          <div className="md:col-span-3 rounded-lg border border-dashed border-border-strong bg-surface-base p-6 text-center font-label-mono text-[10px] text-outline">
            Nenhum driver físico configurado. Os comandos recebidos continuam disponíveis no log de auditoria abaixo.
          </div>
        )}
        {devices.map((dev) => (
          <div
            key={dev.id}
            className="bg-surface-panel p-3 rounded-lg border border-border-subtle flex flex-col justify-between gap-2.5 relative overflow-hidden group hover:border-border-strong transition-all"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-headline-md text-[13px] font-bold text-on-surface block leading-tight">
                  {dev.name}
                </span>
                <span className="font-label-mono text-[9.5px] text-outline block mt-0.5">
                  {dev.target}:{dev.port}
                </span>
              </div>
              <span className="font-label-caps text-[9px] px-1.5 py-0.5 rounded font-bold bg-armed-amber/15 text-armed-amber border border-armed-amber/30 flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-armed-amber"></span>
                CONFIGURADO
              </span>
            </div>

            <div className="bg-surface-container-lowest p-2 rounded border border-border-subtle/40 flex flex-col gap-1 font-label-mono text-[10px]">
              <div className="flex justify-between text-outline">
                <span>Estado de Barramento:</span>
                <span className="text-on-surface font-semibold">{dev.protocol.replace('_', ' ')}</span>
              </div>
              <div className="text-on-surface-variant font-medium truncate" title={dev.activeCrosspointOrInput}>
                {dev.activeCrosspointOrInput}
              </div>
            </div>

            <div className="flex items-center justify-between font-label-mono text-[9.5px] text-outline pt-1 border-t border-border-subtle/40">
              <span>Handshake: <strong className="text-armed-amber">a confirmar por comando real</strong></span>
              <button
                onClick={() => onMessage?.(`O teste de ${dev.name} precisa ser enviado pelo endpoint de controle externo configurado.`)}
                className="px-2 py-0.5 rounded bg-surface-container hover:bg-surface-card border border-border-subtle text-accent-ice hover:text-white font-bold cursor-pointer transition-colors"
                title="Enviar comando ping/pulso de teste"
              >
                {dev.protocol === 'GPIO_RELAY' ? 'PULSO 150ms' : 'TESTE PING'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <form
        className="grid grid-cols-1 gap-2 rounded-lg border border-border-subtle bg-surface-panel p-2.5 md:grid-cols-[1.3fr_1fr_1fr_90px_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          const port = Number(newDevice.port)
          if (!newDevice.name.trim() || !newDevice.host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
            onMessage?.('Informe nome, endereço e porta válida para o dispositivo externo.')
            return
          }
          void api.addExternalDevice({ name: newDevice.name.trim(), kind: newDevice.kind, host: newDevice.host.trim(), port, enabled: true })
            .then(() => { setNewDevice({ name: '', kind: 'ATEM_SWITCHER', host: '', port: '9910' }); onMessage?.('Dispositivo salvo. O próximo comando usará este endereço real.') })
            .catch((error) => onMessage?.(error instanceof Error ? error.message : 'Não foi possível salvar o dispositivo.'))
        }}
      >
        <input value={newDevice.name} onChange={(event) => setNewDevice({ ...newDevice, name: event.target.value })} placeholder="Nome do dispositivo" className="rounded border border-border-subtle bg-surface-base px-2 py-1 text-[11px]" />
        <select value={newDevice.kind} onChange={(event) => setNewDevice({ ...newDevice, kind: event.target.value as typeof newDevice.kind })} className="rounded border border-border-subtle bg-surface-base px-2 py-1 text-[11px]">
          <option value="ATEM_SWITCHER">ATEM</option><option value="VIDEOHUB_ROUTER">Videohub</option><option value="GPIO_RELAY">GPIO</option>
        </select>
        <input value={newDevice.host} onChange={(event) => setNewDevice({ ...newDevice, host: event.target.value })} placeholder="IP ou host" className="rounded border border-border-subtle bg-surface-base px-2 py-1 text-[11px]" />
        <input value={newDevice.port} onChange={(event) => setNewDevice({ ...newDevice, port: event.target.value })} placeholder="Porta" className="rounded border border-border-subtle bg-surface-base px-2 py-1 text-[11px]" />
        <button className="rounded bg-primary px-3 py-1 font-label-caps text-[10px] font-bold text-on-primary" type="submit">ADICIONAR</button>
      </form>

      {/* LOG RÁPIDO DE AUDITORIA COM LATÊNCIA EM MILISSEGUNDOS */}
      <div className="bg-surface-panel p-2.5 rounded-lg border border-border-subtle flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-label-caps text-[10px] font-bold text-outline uppercase flex items-center gap-1">
            <span className="material-symbols-outlined text-primary text-[14px]">history</span>
            Log Rápido de Auditoria de Hardware & Disparos (/api/external/control)
          </span>
          <span className="font-label-mono text-[9px] text-outline">
            Últimos comandos efetivamente recebidos
          </span>
        </div>

        <div className="max-h-[140px] overflow-y-auto broadcast-scroll flex flex-col gap-1 font-label-mono text-[10px]">
          {auditLogs.length === 0 && <p className="p-3 text-center text-outline">Nenhum comando externo registrado nesta sessão.</p>}
          {auditLogs.map((log) => (
            <div
              key={log.id}
              className="bg-surface-container-lowest/90 px-2 py-1.5 rounded border border-border-subtle/30 flex items-center justify-between gap-2 hover:bg-surface-container-lowest transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-outline tabular-nums shrink-0">{log.time}</span>
                <span className="px-1 py-0.2 rounded bg-primary/15 text-primary border border-primary/30 font-bold shrink-0 text-[9px]">
                  {log.targetDevice}
                </span>
                <span className="font-bold text-on-surface shrink-0">{log.action}:</span>
                <span className="text-on-surface-variant truncate">{log.parameters}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-outline text-[9px]">
                  Latência: <strong className="text-status-ok-bright">{log.latencyMs}ms</strong>
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded font-bold text-[8.5px] ${
                    log.status === 'SUCCESS' || log.status === 'ACK'
                      ? 'bg-status-ok/15 text-status-ok border border-status-ok/30'
                      : 'bg-armed-amber/15 text-armed-amber border border-armed-amber/30'
                  }`}
                >
                  {log.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

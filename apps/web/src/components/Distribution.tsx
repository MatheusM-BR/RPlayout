import { confirmAction } from '../domain/confirm.js'
import { useCallback, useEffect, useState,useRef } from 'react'
import { api } from '../api.js'
import { ServerFileTargetDialog } from './ServerFileTargetDialog.js'
import {captureConfigurationRevision} from '../domain/channel-configuration.js'
import {BoundedLatestRead,incidentHistoryWindow} from '../domain/bounded-latest-read.js'
import {IncidentContextDetails} from './IncidentContextDetails.js'
import type {
  Distribution as Payload,
  OutputProfile,
  ConfigurationOperation,
  PublisherStatus,
  RelayStatus,
} from '../types.js'

interface Props {
  channelId: string
  initialTab?: TabKey
  onClose: () => void
  onMessage: (text: string) => void
}

const RELAY_TONE: Record<RelayStatus['state'], string> = {
  'NO AR': 'ok',
  CONECTANDO: 'warn',
  CAIU: 'bad',
  FALHOU: 'bad',
}

const TIPO_LABEL: Record<string, string> = {
  RTMP: 'RTMP',
  SRT: 'SRT',
  FILE: 'ARQUIVO',
  SDI: 'DECKLINK',
}

const PUBLISHER_LABEL: Record<PublisherStatus['health'], string> = {
  onAir: 'NO AR',
  connecting: 'CONECTANDO',
  retrying: 'RECONECTANDO',
  failed: 'FALHA · AÇÃO NECESSÁRIA',
  idle: 'EM ESPERA',
}

/** Copia e avisa. */
async function copy(text: string, say: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    say('Endereço copiado para a área de transferência.')
  } catch {
    say('O navegador não permitiu copiar automaticamente. Selecione e copie manualmente.')
  }
}

/** Resumo do perfil em uma linha. */
function profileSummary(output: OutputProfile): string {
  const parts: string[] = []
  if (output.width !== null && output.height !== null) {
    parts.push(`${output.width}×${output.height}`)
  }
  if (output.rateNum !== null && output.rateDen !== null) {
    parts.push(`${(output.rateNum / output.rateDen).toFixed(2).replace(/\.00$/, '')} fps`)
  }
  if (output.bitrateKbps !== null) parts.push(`${output.bitrateKbps} kbps`)
  if (output.scan !== null) {
    parts.push(output.scan === 'INTERLACED' ? 'entrelaçada' : 'progressiva')
  }

  if (parts.length === 0) return 'Herda padrão do canal'
  return `${parts.join(' · ')} · resto como o canal`
}

type TabKey = 'resumo' | 'saidas' | 'destinos' | 'processos' | 'saude' | 'convidados'

export function Distribution({ channelId, onClose, onMessage, initialTab }: Props) {
  return <DistributionContent key={channelId} channelId={channelId} onClose={onClose} onMessage={onMessage} initialTab={initialTab}/>
}
function DistributionContent({channelId,onClose,onMessage,initialTab='resumo'}:Props){
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
  const [data, setData] = useState<Payload | null>(null)
  const [processes, setProcesses] = useState<Awaited<ReturnType<typeof api.processes>>['processes']>([])
  const [healthEvents, setHealthEvents] = useState<Awaited<ReturnType<typeof api.healthEvents>>['events']>([])
  const [scheduler, setScheduler] = useState<Awaited<ReturnType<typeof api.schedulerStatus>>['channels'][number] | null>(null)
  const [n1, setN1] = useState<Awaited<ReturnType<typeof api.n1Status>> | null>(null)
  const [timeline, setTimeline] = useState<Awaited<ReturnType<typeof api.timeline>>['items']>([])
  const [healthFilter, setHealthFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'CRITICAL'>('ALL')
  const [healthAckFilter,setHealthAckFilter]=useState<'ALL'|'PENDING'|'ACKNOWLEDGED'>('ALL')
  const [healthNavigation,setHealthNavigation]=useState<Array<{until:string;beforeAt:string;beforeId:string}>>([])
  const [healthAnchor,setHealthAnchor]=useState<string|null>(null)
  const [healthPage,setHealthPage]=useState<Awaited<ReturnType<typeof api.healthEvents>>['page']|null>(null)
  const [healthPending,setHealthPending]=useState<{critical:number;warn:number}|null>(null)
  const [healthRisk,setHealthRisk]=useState<Awaited<ReturnType<typeof api.healthEvents>>['risk']|null>(null)
  const [healthLoading,setHealthLoading]=useState(true)
  const healthWindow=healthNavigation.at(-1)
  const [processKind, setProcessKind] = useState<'ALL' | 'ENGINE' | 'OUTPUT' | 'MEDIAMTX'>('ALL')
  const [processChannel, setProcessChannel] = useState<'ALL' | 'CURRENT'>('CURRENT')
  const [outputs, setOutputs] = useState<OutputProfile[]>([])
  const [decklinkSources, setDecklinkSources] = useState<{ reference: string; label: string }[]>([])
  const [decklinkReason, setDecklinkReason] = useState('Consultando saídas DeckLink no servidor…')
  const [outName, setOutName] = useState('')
  const [outTarget, setOutTarget] = useState('')
  const [choosingFile, setChoosingFile] = useState(false)
  const [outKind, setOutKind] = useState<'RTMP' | 'SRT' | 'FILE' | 'SDI'>('RTMP')
  const [guestLabel, setGuestLabel] = useState('')
  const [destName, setDestName] = useState('')
  const [destUrl, setDestUrl] = useState('')
  const [srtMode, setSrtMode] = useState<'caller' | 'listener' | 'rendezvous'>('caller')
  const [srtLatency, setSrtLatency] = useState('800')
  const [srtStreamId, setSrtStreamId] = useState('')
  const [srtPassphrase, setSrtPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [acknowledgingHealth,setAcknowledgingHealth]=useState<string|null>(null)
  const [healthActionError,setHealthActionError]=useState<string|null>(null)
  const [rascunho, setRascunho] = useState<Record<string, {value:string;revision:number|undefined}>>({})
  const [operation,setOperation]=useState<ConfigurationOperation|null>(null)
  const [outputRevision,setOutputRevision]=useState<number|undefined>()
  const draftRevision=useRef<number|undefined>()
  const reads=useRef(new BoundedLatestRead(10000))
  const [busy,setBusy]=useState(false),busyRef=useRef(false),mounted=useRef(true),sequence=useRef(0)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++}},[])

  useEffect(() => {
    if (outKind !== 'SDI') return
    void api.sources().then((sources) => {
      setDecklinkSources(sources.sdiOutputs.sources)
      setDecklinkReason(sources.sdiOutputs.reason || 'Nenhuma porta de saída de vídeo foi enumerada. Confira o perfil da placa no Desktop Video do servidor.')
    }).catch(() => {
      setDecklinkSources([])
      setDecklinkReason('Não foi possível consultar as saídas DeckLink no servidor.')
    })
  }, [outKind])

  const refresh = useCallback(async (reopen=false,replace=true) => {
    const read=reads.current.start(replace);if(!read)return
    const generation=++sequence.current
    setHealthLoading(true)
    try {
      const [payload, profiles, processReport, healthReport, schedulerReport, n1Report, timelineReport] = await Promise.all([
        api.distribution(read.signal),
        api.outputs(channelId,read.signal),
        api.processes(read.signal),
        api.healthEvents(channelId,{severity:healthFilter,acknowledgement:healthAckFilter,...incidentHistoryWindow(healthAnchor,healthWindow)},read.signal),
        api.schedulerStatus(read.signal),
        api.n1Status(read.signal),
        api.timeline(channelId,read.signal),
      ])
      if(!mounted.current || generation!==sequence.current)return
      const captured=captureConfigurationRevision(channelId,draftRevision.current,profiles.configurationRevision,reopen)
      setData(payload)
      setOutputs(profiles.outputs)
      setOperation(profiles.configurationOperation);setOutputRevision(profiles.configurationRevision);draftRevision.current=captured
      if(reopen){setRascunho({});setOutName('');setOutTarget('')}
      setProcesses(processReport.processes)
      setHealthEvents(healthReport.events)
      setHealthPage(healthReport.page);setHealthPending(healthReport.pending);setHealthRisk(healthReport.risk)
      setScheduler(schedulerReport.channels.find((entry) => entry.channelId === channelId) ?? null)
      setN1(n1Report)
      setTimeline(timelineReport.items)
      setError(null)
    } catch (failure) {
      if(mounted.current && generation===sequence.current&&read.isCurrent())setError(read.timedOut()?'A consulta excedeu 10 segundos. Tente atualizar novamente.':failure instanceof Error ? failure.message : 'Falha ao ler a distribuição.')
    } finally {
      read.finish()
      if(mounted.current && generation===sequence.current)setHealthLoading(false)
    }
  }, [channelId,healthFilter,healthAckFilter,healthWindow,healthAnchor])

  useEffect(() => {
    let active = true
    let polling = false
    let timer = 0
    const poll = async (): Promise<void> => {
      if (!active || polling) return
      polling=true
      try{if (document.visibilityState === 'visible') await refresh(false,false)}finally{polling=false}
      if (!active) return
      timer = window.setTimeout(() => void poll(), document.visibilityState === 'visible' ? 3000 : 15000)
    }
    void poll()
    const resume = (): void => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(timer)
      void poll()
    }
    document.addEventListener('visibilitychange', resume)
    return () => {
      active = false
      sequence.current++;reads.current.cancel()
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [refresh])

  const guard = async (action: () => Promise<void>,reconcile=false): Promise<void> => {
    if(busyRef.current)return
    if(operation && operation.state!=='IDLE' && !reconcile){setError(operation.reason);return}
    busyRef.current=true;setBusy(true)
    try {
      await action()
      await refresh()
    } catch (failure) {
      if(mounted.current)setError(failure instanceof Error ? failure.message : 'Não consegui aplicar a configuração.')
    }finally{busyRef.current=false;if(mounted.current)setBusy(false)}
  }

  const salvarBitrate = (output: OutputProfile): void => {
    const digitado = rascunho[output.id]
    if (digitado === undefined) return

    const limpo = digitado.value.trim()
    const valor = limpo === '' ? null : Number(limpo)
    const lightweight=output.role==='PREVIEW' || output.role==='MONITOR'
    if (valor !== null && (!Number.isInteger(valor) || valor < 50 || valor > (lightweight?450:80000)) || lightweight && valor===null) {
      setError(lightweight?'Preview e monitor usam de 50 a 450 kbps; não herdam o bitrate do PGM.':'Bitrate deve ser um inteiro de 50 a 80000 kbps.')
      return
    }
    if (valor === output.bitrateKbps) {
      setRascunho((atual) => {
        const proximo = { ...atual }
        delete proximo[output.id]
        return proximo
      })
      return
    }

    void guard(async () => {
      const result=await api.patchOutput(output.id, { bitrateKbps: valor === null ? null : Math.round(valor) },channelId,digitado.revision)
      setRascunho((atual) => {
        const proximo = { ...atual }
        delete proximo[output.id]
        return proximo
      })
      if(mounted.current)onMessage(result.engineError?`Configuração gravada; atenção no engine: ${result.engineError}`:result.restartRequired?'Qualidade gravada. Reinício controlado solicitado; confira o destino.':'Troca do publisher aceita pelo engine. Confira a entrega no destino; ACK não homologa sinal físico.')
    })
  }

  const channel = data?.channels.find((entry) => entry.channelId === channelId)
  const criticalPending = healthPending?.critical ?? null
  const warnPending = healthPending?.warn ?? null
  const visibleProcesses = processes.filter((process) =>
    (processKind === 'ALL' || process.kind === processKind) &&
    (processChannel === 'ALL' || process.channelId === channelId || (process.kind === 'MEDIAMTX' && processChannel === 'CURRENT')),
  )
  const visibleHealthEvents = healthEvents
  const resetHealthPage=()=>{setHealthEvents([]);setHealthPage(null);setHealthNavigation([]);setHealthAnchor(null);setHealthLoading(true)}

  const tipoReal = (output: OutputProfile): string => {
    const alvo = output.resolvedTarget ?? ''
    if (alvo.startsWith('srt://')) return 'SRT'
    if (alvo.startsWith('rtmp://')) return 'RTMP'
    return TIPO_LABEL[output.kind] ?? output.kind
  }

  const saudeDe = (output: OutputProfile) =>
    channel?.publishers.find((publisher) => publisher.url === output.resolvedTarget) ?? null

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Distribuição e saídas" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-surface-card border border-border-subtle rounded-xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden text-on-surface"
        onClick={(event) => event.stopPropagation()}
      >
        {/* HEADER MODAL */}
        <header className="px-6 py-4 border-b border-border-subtle flex items-center justify-between shrink-0 bg-surface-panel/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-[22px]">cell_tower</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-headline-md text-base text-on-surface uppercase tracking-wider font-bold">
                  Saídas do Canal &amp; Distribuição
                </h2>
                {data?.server.running ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-status-ok/20 text-status-ok-bright border border-status-ok/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse"></span>
                    MEDIAMTX ATIVO ({data.server.host})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-on-air-crimson/20 text-on-air-crimson border border-on-air-crimson/30" title="O servidor de distribuição (RTMP/SRT/HLS/monitor) não está rodando">
                    MEDIAMTX PARADO
                  </span>
                )}
                {data?.server.exposed && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-armed-amber/20 text-armed-amber border border-armed-amber/30">
                    <span className="material-symbols-outlined text-[13px]">warning</span>
                    EXPOSTO EXTERNAMENTE
                  </span>
                )}
              </div>
              <span className="font-label-mono text-[12px] text-outline">
                {data === null && !error
                  ? 'Carregando estado do cluster de distribuição…'
                  : `Canal ${channel?.channelId ?? channelId} · Transmissão, decodificadores e relays`}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-surface-panel flex items-center justify-center text-outline hover:text-on-surface transition-colors cursor-pointer text-base font-bold"
            title="Fechar (Esc)"
          >
            ✕
          </button>
        </header>

        {/* ERRO BANNER */}
        {error && (
          <div className="px-6 py-2.5 bg-on-air-crimson/10 border-b border-on-air-crimson/30 text-on-air-crimson text-xs font-label-mono flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">error</span>
              {error}
            </span>
            <button onClick={() => setError(null)} className="hover:underline cursor-pointer">fechar</button>
          </div>
        )}

        {operation && operation.state!=='IDLE' && <div role="alert" className="px-6 py-3 border-b border-armed-amber text-armed-amber text-xs">
          <p>{operation.reason} Pare o PGM e limpe o CUE antes de reconciliar. Não haverá TAKE automático.</p>
          <button type="button" disabled={busy || !operation.reconcilable || outputRevision===undefined} className="mt-2 text-primary disabled:opacity-40" onClick={()=>void guard(async()=>{
            if(!operation.runId || !(await confirmAction('Reabrir as saídas gravadas com PGM parado e CUE limpo? Não haverá TAKE automático.')))return
            await api.reconcileConfiguration(channelId,operation.runId,outputRevision)
            if(mounted.current)onMessage('Configuração reconciliada com o canal parado. Confira o sinal antes de CUE/TAKE.')
          },true)}>RECONCILIAR CONFIGURAÇÃO PARADA</button>
        </div>}

        {/* NAVEGAÇÃO DE ABAS */}
        {healthActionError && <div role="alert" className="shrink-0 px-6 py-2.5 bg-on-air-crimson/10 border-b border-on-air-crimson/30 text-on-air-crimson text-xs flex items-center justify-between gap-3">
          <span>Reconhecimento não gravado: {healthActionError} O incidente continua pendente; confira antes de tentar novamente.</span>
          <button type="button" onClick={()=>setHealthActionError(null)}>FECHAR AVISO</button>
        </div>}
        <div className="px-6 pt-3 pb-0 bg-surface-base border-b border-border-subtle/70 flex items-center gap-2 shrink-0 overflow-x-auto broadcast-scroll">
          <button
            onClick={() => setActiveTab('resumo')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t text-xs font-label-caps transition-all cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === 'resumo'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">cast</span>
            Endereços &amp; Sinal
          </button>

          <button
            onClick={() => setActiveTab('saidas')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t text-xs font-label-caps transition-all cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === 'saidas'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">output</span>
            Perfis de Saída
            <span className="ml-1 px-1.5 py-0.2 rounded bg-surface-card text-[12px] font-label-mono text-outline">
              {outputs.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('destinos')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t text-xs font-label-caps transition-all cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === 'destinos'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">share</span>
            Destinos &amp; Relays
            <span className="ml-1 px-1.5 py-0.2 rounded bg-surface-card text-[12px] font-label-mono text-outline">
              {data?.destinations.length ?? 0}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('processos')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t text-xs font-label-caps transition-all cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === 'processos'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">memory</span>
            Processos ({visibleProcesses.length})
          </button>

          <button
            onClick={() => setActiveTab('saude')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t text-xs font-label-caps transition-all cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === 'saude'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">vital_signs</span>
            Saúde &amp; Telemetria
            {criticalPending !== null && criticalPending > 0 ? (
              <span className="ml-1 px-1.5 py-0.2 rounded bg-on-air-crimson/20 text-on-air-crimson font-label-mono text-[12px] font-bold">
                {criticalPending}
              </span>
            ) : warnPending !== null && warnPending > 0 ? (
              <span className="ml-1 px-1.5 py-0.2 rounded bg-armed-amber/20 text-armed-amber font-label-mono text-[12px] font-bold">
                {warnPending}
              </span>
            ) : null}
          </button>

          <button
            onClick={() => setActiveTab('convidados')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-t text-xs font-label-caps transition-all cursor-pointer border-b-2 whitespace-nowrap ${
              activeTab === 'convidados'
                ? 'border-primary text-primary font-bold bg-surface-panel/80'
                : 'border-transparent text-outline hover:text-on-surface hover:bg-surface-panel/40'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            Convidados (SRT)
            <span className="ml-1 px-1.5 py-0.2 rounded bg-surface-card text-[12px] font-label-mono text-outline">
              {data?.guests.length ?? 0}
            </span>
          </button>
        </div>

        {/* CORPO MODAL COM SCROLL INTERNO */}
        <div className="p-6 flex-1 min-h-0 overflow-y-auto broadcast-scroll flex flex-col gap-6">

          {/* TAB 1: RESUMO / ENDEREÇOS */}
          {activeTab === 'resumo' && (
            <div className="flex flex-col gap-5">
              {/* Formato do canal card */}
              {channel?.format && (
                <div className="p-4 rounded-xl bg-surface-panel/60 border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-label-caps uppercase text-outline font-bold tracking-wider">
                      PADRÃO DE RASTERIZAÇÃO DO CANAL
                    </span>
                    <div className="text-sm font-label-mono font-bold text-on-surface mt-0.5">
                      Sinal mestre em <span className="text-primary">{channel.format.channel}</span>
                      {channel.format.channel !== channel.format.network && (
                        <span className="text-outline font-normal">
                          {' '}· Saída de rede adaptada para <span className="text-status-ok-bright">{channel.format.network}</span> (progressivo)
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-lg bg-surface-base border border-border-subtle text-[12px] font-label-mono text-primary font-bold shrink-0">
                    59.94 Hz BROADCAST READY
                  </span>
                </div>
              )}

              {/* Endereços de programa para cópia rápida */}
              {channel?.urls && (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-primary">link</span>
                      ENDEREÇOS DO PROGRAMA (INGRESS / EGRESS)
                    </span>
                    <span className="text-[12px] font-label-mono text-outline">
                      Clique em qualquer link para copiar
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(channel.urls).map(([protocol, url]) => (
                      <button
                        key={protocol}
                        type="button"
                        onClick={() => void copy(url, onMessage)}
                        className="p-3 rounded-lg bg-surface-panel hover:bg-surface-panel/80 border border-border-subtle hover:border-primary/50 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-primary/20 text-primary border border-primary/30 uppercase">
                              {protocol}
                            </span>
                            <span className="text-[12px] text-outline font-label-mono">STREAM FEED</span>
                          </div>
                          <p className="text-xs font-label-mono text-on-surface truncate mt-1 group-hover:text-primary">
                            {url}
                          </p>
                        </div>
                        <span className="material-symbols-outlined text-outline group-hover:text-primary shrink-0 text-[18px]">
                          content_copy
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* O que está passando agora no servidor */}
              <div className="flex flex-col gap-2.5 pt-2">
                <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-primary">sensors</span>
                  FLUXOS ATIVOS NO SERVIDOR LOCAL
                </span>
                <div className="flex flex-col gap-2">
                  {(data?.paths ?? []).map((path) => (
                    <div
                      key={path.name}
                      className="p-3 rounded-lg bg-surface-panel/50 border border-border-subtle flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary text-[20px]">radio</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-label-mono font-bold text-on-surface">{path.name}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[12px] font-label-mono font-bold ${
                                path.ready
                                  ? 'bg-status-ok/20 text-status-ok-bright border border-status-ok/30'
                                  : 'bg-surface-base text-outline border border-border-subtle'
                              }`}
                            >
                              {path.ready ? 'NO AR' : 'PARADO'}
                            </span>
                          </div>
                          <span className="text-[12px] font-label-mono text-outline">
                            {(path.bytesReceived / 1048576).toFixed(1)} MiB recebidos · {path.readers} {path.readers === 1 ? 'leitor ativo' : 'leitores ativos'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(data?.paths ?? []).length === 0 && (
                    <div className="p-6 rounded-lg bg-surface-panel/30 border border-border-subtle/50 text-center text-outline text-xs font-label-mono">
                      {data === null && !error ? 'Carregando fluxos…' : 'Nenhum fluxo publicado no momento.'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PERFIS DE SAÍDA */}
          {activeTab === 'saidas' && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider">
                    CONFIGURAÇÃO DE SAÍDAS (SDI, SRT, RTMP, ARQUIVO)
                  </span>
                  <p className="text-[11px] text-outline mt-0.5">
                    Trocar um publisher pode interromper brevemente a saída. Habilitar ou remover solicita reinício controlado; confira o sinal no destino.
                  </p>
                </div>
                <button type="button" disabled={busy} className="text-xs text-primary disabled:opacity-40" onClick={async()=>{
                  if(await confirmAction('Reabrir a configuração atual e descartar os rascunhos de saída/bitrate?'))void refresh(true)
                }}>REABRIR CONFIGURAÇÃO</button>
              </div>

              <fieldset disabled={busy || outputRevision===undefined || Boolean(operation && operation.state!=='IDLE')} className="flex flex-col gap-3 disabled:opacity-60">

              {/* Lista de Saídas */}
              <div className="flex flex-col gap-3">
                {outputs.map((output) => {
                  const saude = saudeDe(output)
                  return (
                    <div
                      key={output.id}
                      className="p-4 rounded-xl bg-surface-panel/70 border border-border-subtle flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <h4 className="font-headline-md text-sm font-bold text-on-surface">{output.name}</h4>
                          <span className="px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-primary/20 text-primary border border-primary/30">
                            {tipoReal(output)}
                          </span>
                          {output.role !== 'EXTRA' ? (
                            <span className="px-2 py-0.5 rounded text-[12px] font-label-mono text-outline bg-surface-base border border-border-subtle">
                              DO SISTEMA
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[12px] font-label-mono text-armed-amber bg-armed-amber/10 border border-armed-amber/30">
                              EXTRA
                            </span>
                          )}
                          {!output.enabled ? (
                            <span className="px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-on-air-crimson/20 text-on-air-crimson border border-on-air-crimson/30">
                              DESLIGADA
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-status-ok/20 text-status-ok-bright border border-status-ok/30">
                              LIGADA
                            </span>
                          )}
                          {saude && (
                            <span
                              className={`px-2 py-0.5 rounded text-[12px] font-label-mono font-bold ${
                                saude.health === 'onAir'
                                  ? 'bg-status-ok/20 text-status-ok-bright border border-status-ok/30'
                                  : saude.health === 'connecting'
                                  ? 'bg-armed-amber/20 text-armed-amber border border-armed-amber/30'
                                  : saude.health === 'retrying' || saude.health === 'failed'
                                  ? 'bg-on-air-crimson/20 text-on-air-crimson border border-on-air-crimson/30'
                                  : 'bg-surface-base text-outline border border-border-subtle'
                              }`}
                            >
                              {PUBLISHER_LABEL[saude.health]}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-col gap-1.5">
                          <p className="text-xs font-label-mono text-on-surface truncate">
                            {output.displayUrl || output.target || output.resolvedTarget || '(sem destino configurado)'}
                          </p>
                          {output.streamUrls && (
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              {Object.entries(output.streamUrls).map(([proto, url]) => (
                                <button
                                  key={proto}
                                  type="button"
                                  onClick={() => void copy(url, onMessage)}
                                  className="px-2 py-0.5 rounded bg-surface-base hover:bg-surface-card border border-border-subtle text-[12px] font-label-mono text-primary uppercase flex items-center gap-1 cursor-pointer transition-colors"
                                  title={`Copiar ${proto.toUpperCase()}: ${url}`}
                                >
                                  <span className="font-bold">{proto}</span>
                                  <span className="material-symbols-outlined text-[12px] text-outline">content_copy</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <p className="text-[12px] font-label-mono text-outline mt-0.5">
                          {profileSummary(output)}
                        </p>

                        {saude && (
                          <div className="text-[12px] font-label-mono text-outline mt-1.5 flex items-center gap-2">
                            <span>
                              {saude.delivered > 0
                                ? `${saude.delivered.toLocaleString('pt-BR')} pacotes entregues`
                                : 'Aguardando fluxo de pacotes'}
                            </span>
                            {saude.attempts > 1 && <span>· {saude.attempts} tentativas</span>}
                            {saude.error && <span className="text-on-air-crimson">· {saude.error}</span>}
                          </div>
                        )}
                      </div>

                      {/* Controle de Bitrate & Ações */}
                      <div className="flex flex-wrap items-center gap-3 shrink-0">
                        <div className="flex items-center gap-2 bg-surface-base px-2.5 py-1 rounded-lg border border-border-subtle">
                          <label htmlFor={`br-${output.id}`} className="text-[11px] font-label-caps uppercase text-outline">
                            Bitrate:
                          </label>
                          <input
                            id={`br-${output.id}`}
                            type="number"
                            min={50}
                            max={output.role==='PREVIEW'||output.role==='MONITOR'?450:80000}
                            step={50}
                            value={rascunho[output.id]?.value ?? output.bitrateKbps ?? ''}
                            placeholder={
                              output.suggestedBitrateKbps === null
                                ? 'automático'
                                : `auto (${output.suggestedBitrateKbps})`
                            }
                            onChange={(event) =>
                              setRascunho((atual) => ({ ...atual, [output.id]: {value:event.target.value,revision:atual[output.id]?.revision??output.configurationRevision} }))
                            }
                            onBlur={() => salvarBitrate(output)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur()
                              if (event.key === 'Escape') {
                                setRascunho((atual) => {
                                  const proximo = { ...atual }
                                  delete proximo[output.id]
                                  return proximo
                                })
                              }
                            }}
                            className="bg-transparent border-0 text-on-surface text-xs font-label-mono w-20 focus:outline-none"
                          />
                          <span className="text-[12px] font-label-mono text-outline">kbps</span>
                          {output.bitrateKbps !== null && output.role!=='PREVIEW' && output.role!=='MONITOR' && (
                            <button
                              type="button"
                              className="px-1.5 py-0.5 text-[12px] font-label-mono font-bold rounded bg-surface-panel hover:bg-surface-panel/80 text-primary border border-border-subtle cursor-pointer"
                              onClick={() =>
                                void guard(async () => {
                                  const result=await api.patchOutput(output.id, { bitrateKbps: null },channelId,output.configurationRevision)
                                  setRascunho((atual) => {
                                    const proximo = { ...atual }
                                    delete proximo[output.id]
                                    return proximo
                                  })
                                  onMessage(result.engineError?`Configuração gravada; atenção no engine: ${result.engineError}`:'Modo automático gravado; confira o publisher e a entrega.')
                                })
                              }
                              title="Restaurar modo automático sincronizado ao formato"
                            >
                              AUTO
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            void guard(async () => {
                              const result=await api.patchOutput(output.id, { enabled: !output.enabled },channelId,output.configurationRevision)
                              onMessage(result.engineError?`Configuração gravada; atenção no engine: ${result.engineError}`:'Habilitação gravada. Reinício solicitado; confira o sinal no destino.')
                            })
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-label-caps font-bold cursor-pointer transition-colors border ${
                            output.enabled
                              ? 'bg-armed-amber/15 hover:bg-armed-amber/25 border-armed-amber/30 text-armed-amber'
                              : 'bg-status-ok/15 hover:bg-status-ok/25 border-status-ok/30 text-status-ok-bright'
                          }`}
                        >
                          {output.enabled ? 'DESLIGAR' : 'LIGAR'}
                        </button>

                        {output.role === 'EXTRA' && (
                          <button
                            type="button"
                            onClick={() =>
                              void guard(async () => {
                                const result=await api.removeOutput(output.id,channelId,output.configurationRevision)
                                onMessage(result.engineError?`Saída removida do cadastro; atenção no engine: ${result.engineError}`:'Saída removida do cadastro. Reinício controlado solicitado.')
                              })
                            }
                            className="px-3 py-1.5 rounded-lg text-xs font-label-caps font-bold cursor-pointer transition-colors border bg-on-air-crimson/10 hover:bg-on-air-crimson/20 border-on-air-crimson/30 text-on-air-crimson"
                          >
                            REMOVER
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Adicionar nova saída */}
              <div className="p-4 rounded-xl bg-surface-panel/40 border border-border-subtle flex flex-col gap-3 mt-2">
                <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-primary">add_circle</span>
                  CRIAR NOVA SAÍDA DE TRANSMISSÃO
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder="Nome da saída (ex: DeckLink PGM 1)"
                    value={outName}
                    onChange={(event) => setOutName(event.target.value)}
                    className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-xs font-label-mono px-3 py-2 rounded-lg focus:outline-none"
                  />
                  <select
                    value={outKind}
                    onChange={(event) => setOutKind(event.target.value as typeof outKind)}
                    className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-xs font-label-mono px-3 py-2 rounded-lg focus:outline-none"
                  >
                    <option value="RTMP">RTMP (Servidor / CDN)</option>
                    <option value="SRT">SRT (Baixa Latência)</option>
                    <option value="FILE">Arquivo (Gravação Local)</option>
                    <option value="SDI">SDI / DeckLink (Hardware)</option>
                  </select>

                  <div className="sm:col-span-2 flex items-center gap-2">
                    {outKind === 'SDI' ? (
                      <select
                        value={outTarget}
                        onChange={(event) => setOutTarget(event.target.value)}
                        className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-xs font-label-mono px-3 py-2 rounded-lg focus:outline-none flex-1"
                      >
                        <option value="">Selecione o conector DeckLink…</option>
                        {decklinkSources.map((source) => (
                          <option key={source.reference} value={source.reference.replace(/^sdi:/i, '')}>
                            {source.label} ({source.reference})
                          </option>
                        ))}
                      </select>
                    ) : outKind === 'FILE' ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={outTarget}
                          readOnly
                          placeholder="Caminho do arquivo de gravação…"
                          className="bg-surface-base border border-border-subtle text-on-surface text-xs font-label-mono px-3 py-2 rounded-lg flex-1"
                        />
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg bg-surface-panel hover:bg-surface-base border border-border-subtle text-xs font-label-caps text-on-surface cursor-pointer shrink-0"
                          onClick={() => setChoosingFile(true)}
                        >
                          EXPLORAR…
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="rtmp:// ou srt://..."
                        value={outTarget}
                        onChange={(event) => setOutTarget(event.target.value)}
                        className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-xs font-label-mono px-3 py-2 rounded-lg focus:outline-none flex-1"
                      />
                    )}

                    <button
                      type="button"
                      disabled={!outName.trim() || !outTarget.trim()}
                      onClick={() =>
                        void guard(async () => {
                          const result=await api.addOutput(channelId, {
                            name: outName.trim(),
                            kind: outKind,
                            target: outTarget.trim(),
                          },draftRevision.current)
                          if(!mounted.current)return
                          draftRevision.current=result.configurationRevision
                          setOutName('')
                          setOutTarget('')
                          onMessage(result.engineError?`Saída gravada; atenção no engine: ${result.engineError}`:'Saída gravada. Reinício controlado solicitado; confira a imagem e o destino.')
                        })
                      }
                      className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary font-label-caps text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                    >
                      ADICIONAR
                    </button>
                  </div>
                </div>

                {outKind === 'SDI' && decklinkSources.length === 0 && (
                  <p className="text-[12px] text-armed-amber font-label-mono mt-1">
                    {decklinkReason}
                  </p>
                )}
              </div>
              </fieldset>
            </div>
          )}

          {/* TAB 3: DESTINOS / RELAYS */}
          {activeTab === 'destinos' && (
            <div className="flex flex-col gap-5">
              <div>
                <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider">
                  DESTINOS DE TRANSMISSÃO EXTERNA (RELAYS)
                </span>
                <p className="text-[11px] text-outline mt-0.5">
                  Reencaminhamento para YouTube, redes sociais, retransmissoras ou links SRT ponto a ponto.
                </p>
              </div>

              {/* Lista de Destinos */}
              <div className="flex flex-col gap-3">
                {(data?.destinations ?? []).map((destination) => {
                  const relay = data?.relays.find((entry) => entry.id === destination.id)
                  return (
                    <div
                      key={destination.id}
                      className="p-4 rounded-xl bg-surface-panel/70 border border-border-subtle flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <h4 className="font-headline-md text-sm font-bold text-on-surface">{destination.name}</h4>
                          {relay && (
                            <span
                              className={`px-2 py-0.5 rounded text-[12px] font-label-mono font-bold ${
                                relay.state === 'NO AR'
                                  ? 'bg-status-ok/20 text-status-ok-bright border border-status-ok/30'
                                  : relay.state === 'CONECTANDO'
                                  ? 'bg-armed-amber/20 text-armed-amber border border-armed-amber/30'
                                  : 'bg-on-air-crimson/20 text-on-air-crimson border border-on-air-crimson/30'
                              }`}
                            >
                              {relay.state}
                            </span>
                          )}
                          {!destination.enabled && (
                            <span className="px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-surface-base text-outline border border-border-subtle">
                              DESLIGADO
                            </span>
                          )}
                        </div>

                        <p className="text-xs font-label-mono text-on-surface truncate">{destination.url}</p>

                        {relay && (
                          <div className="text-[12px] font-label-mono text-outline mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="px-1.5 py-0.2 rounded bg-surface-base border border-border-subtle text-[11px] text-primary">
                              {relay.transport}{relay.transport === 'SRT' ? ` · ${relay.mode}` : ''}
                            </span>
                            {relay.latencyMs != null && <span>· Latência: {relay.latencyMs} ms</span>}
                            {relay.rttMs != null && <span>· RTT: {relay.rttMs} ms</span>}
                            {relay.lossPct != null && <span>· Perda: {relay.lossPct.toFixed(1)}%</span>}
                            {relay.bitrateKbps != null && (
                              <span>· {relay.bitrateKbps.toLocaleString('pt-BR')} kbps</span>
                            )}
                            <span>· {relay.primary ? 'Primário' : `Backup de ${relay.backupFor ?? '—'}`}</span>
                          </div>
                        )}

                        {relay && (
                          <div className="text-[12px] font-label-mono text-outline mt-1">
                            {relay.delivered > 0
                              ? `${relay.delivered.toLocaleString('pt-BR')} pacotes entregues`
                              : 'Aguardando entrega de pacotes'}
                            {relay.attempts > 1 && ` · ${relay.attempts} tentativas`}
                            {relay.reason && <span className="text-on-air-crimson"> · {relay.reason}</span>}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            void guard(() =>
                              api.setDestination(destination.id, { enabled: !destination.enabled }).then(() => undefined),
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-label-caps font-bold cursor-pointer transition-colors border ${
                            destination.enabled
                              ? 'bg-armed-amber/15 hover:bg-armed-amber/25 border-armed-amber/30 text-armed-amber'
                              : 'bg-status-ok/15 hover:bg-status-ok/25 border-status-ok/30 text-status-ok-bright'
                          }`}
                        >
                          {destination.enabled ? 'DESLIGAR' : 'LIGAR'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void guard(() => api.removeDestination(destination.id).then(() => undefined))
                          }
                          className="px-3 py-1.5 rounded-lg text-xs font-label-caps font-bold cursor-pointer transition-colors border bg-on-air-crimson/10 hover:bg-on-air-crimson/20 border-on-air-crimson/30 text-on-air-crimson"
                        >
                          REMOVER
                        </button>
                      </div>
                    </div>
                  )
                })}

                {(data?.destinations ?? []).length === 0 && (
                  <div className="p-6 rounded-lg bg-surface-panel/30 border border-border-subtle/50 text-center text-outline text-xs font-label-mono">
                    Nenhum destino externo configurado. O sinal continua disponível na rede local via RTSP/SRT/HLS.
                  </div>
                )}
              </div>

              {/* Criar Destino Form */}
              <div className="p-4 rounded-xl bg-surface-panel/40 border border-border-subtle flex flex-col gap-3 mt-2">
                <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-primary">add_link</span>
                  CRIAR NOVO RELAY / DESTINO
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    placeholder="Nome (ex: YouTube Live)"
                    value={destName}
                    onChange={(event) => setDestName(event.target.value)}
                    className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-xs font-label-mono px-3 py-2 rounded-lg focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="rtmp:// ou srt://..."
                    value={destUrl}
                    onChange={(event) => setDestUrl(event.target.value)}
                    className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-xs font-label-mono px-3 py-2 rounded-lg focus:outline-none sm:col-span-2"
                  />
                </div>

                {destUrl.trim().toLowerCase().startsWith('srt://') && (
                  <div className="p-3 rounded-lg bg-surface-base border border-border-subtle flex flex-col gap-2 mt-1">
                    <span className="text-[11px] font-label-caps text-outline uppercase font-bold">
                      PARÂMETROS DE TRANSMISSÃO SRT
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <select
                        value={srtMode}
                        onChange={(event) => setSrtMode(event.target.value as typeof srtMode)}
                        className="bg-surface-panel border border-border-subtle text-on-surface text-xs font-label-mono px-2.5 py-1.5 rounded focus:outline-none"
                      >
                        <option value="caller">caller (origem)</option>
                        <option value="listener">listener (escuta)</option>
                        <option value="rendezvous">rendezvous (p2p)</option>
                      </select>
                      <input
                        value={srtLatency}
                        onChange={(event) => setSrtLatency(event.target.value)}
                        placeholder="latência ms (800)"
                        className="bg-surface-panel border border-border-subtle text-on-surface text-xs font-label-mono px-2.5 py-1.5 rounded focus:outline-none"
                      />
                      <input
                        value={srtStreamId}
                        onChange={(event) => setSrtStreamId(event.target.value)}
                        placeholder="streamid (opcional)"
                        className="bg-surface-panel border border-border-subtle text-on-surface text-xs font-label-mono px-2.5 py-1.5 rounded focus:outline-none"
                      />
                      <input
                        type="password"
                        value={srtPassphrase}
                        onChange={(event) => setSrtPassphrase(event.target.value)}
                        placeholder="passphrase AES (opcional)"
                        className="bg-surface-panel border border-border-subtle text-on-surface text-xs font-label-mono px-2.5 py-1.5 rounded focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    disabled={destName.trim() === '' || destUrl.trim() === ''}
                    onClick={() =>
                      void guard(async () => {
                        let destination = destUrl.trim()
                        if (destination.toLowerCase().startsWith('srt://')) {
                          const url = new URL(destination)
                          url.searchParams.set('mode', srtMode)
                          if (srtLatency.trim() !== '') url.searchParams.set('latency', srtLatency.trim())
                          if (srtStreamId.trim() !== '') url.searchParams.set('streamid', srtStreamId.trim())
                          if (srtPassphrase.trim() !== '') url.searchParams.set('passphrase', srtPassphrase.trim())
                          destination = url.toString()
                        }
                        await api.addDestination(channelId, destName.trim(), destination)
                        setDestName('')
                        setDestUrl('')
                        setSrtStreamId('')
                        setSrtPassphrase('')
                        onMessage('Destino criado. O relay começará a entregar em instantes.')
                      })
                    }
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary font-label-caps text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ADICIONAR DESTINO
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PROCESSOS */}
          {activeTab === 'processos' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider">
                    PROCESSOS DO ENGINE &amp; MONITORES
                  </span>
                  <p className="text-[11px] text-outline mt-0.5">
                    PID, CPU acumulada e consumo de memória lidos diretamente do SO.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={processKind}
                    onChange={(event) => setProcessKind(event.target.value as typeof processKind)}
                    className="bg-surface-panel border border-border-subtle text-on-surface text-xs font-label-mono px-3 py-1.5 rounded-lg focus:outline-none"
                  >
                    <option value="ALL">Todos os processos</option>
                    <option value="ENGINE">Engines</option>
                    <option value="OUTPUT">Saídas RTMP/SRT</option>
                    <option value="MEDIAMTX">MediaMTX</option>
                  </select>

                  <select
                    value={processChannel}
                    onChange={(event) => setProcessChannel(event.target.value as typeof processChannel)}
                    className="bg-surface-panel border border-border-subtle text-on-surface text-xs font-label-mono px-3 py-1.5 rounded-lg focus:outline-none"
                  >
                    <option value="CURRENT">Canal atual</option>
                    <option value="ALL">Todos os canais</option>
                  </select>
                </div>
              </div>

              {/* Tabela de processos */}
              <div className="rounded-xl border border-border-subtle overflow-hidden bg-surface-panel/40">
                <table className="w-full text-left border-collapse text-xs font-label-mono">
                  <thead>
                    <tr className="bg-surface-base text-outline uppercase font-label-caps text-[11px] tracking-wider border-b border-border-subtle">
                      <th className="py-2.5 px-3">Processo</th>
                      <th className="py-2.5 px-3">PID</th>
                      <th className="py-2.5 px-3">Estado</th>
                      <th className="py-2.5 px-3 text-right">CPU Acumulada</th>
                      <th className="py-2.5 px-3 text-right">Memória</th>
                      <th className="py-2.5 px-3">Saídas Ativas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProcesses.map((process) => {
                      const publishers = Array.isArray(process.details?.publishers) ? process.details.publishers : []
                      return (
                        <tr key={process.id} className="border-b border-border-subtle/50 hover:bg-surface-panel/60 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-on-surface">
                            {process.kind === 'MEDIAMTX'
                              ? 'MediaMTX (RTSP/SRT Server)'
                              : process.kind === 'ENGINE'
                              ? `Engine Playout · ${process.channelId ?? ''}`
                              : `${String((process.details?.transport as string | undefined) ?? 'OUTPUT')} · ${String(
                                  (process.details?.url as string | undefined) ?? process.id,
                                )}`}
                          </td>
                          <td className="py-2.5 px-3 text-outline">{process.pid ?? '—'}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[11px] bg-surface-base border border-border-subtle text-status-ok-bright font-bold">
                              {process.state}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-on-surface">
                            {process.cpuTimeMs === null ? '—' : `${(process.cpuTimeMs / 1000).toFixed(1)} s`}
                          </td>
                          <td className="py-2.5 px-3 text-right text-on-surface">
                            {process.memoryBytes === null
                              ? '—'
                              : `${(process.memoryBytes / 1024 / 1024).toFixed(0)} MB`}
                          </td>
                          <td className="py-2.5 px-3 text-outline truncate max-w-xs">
                            {publishers.length > 0
                              ? publishers.map((pub) => String((pub as { health?: unknown }).health ?? '')).join(', ')
                              : '—'}
                          </td>
                        </tr>
                      )
                    })}
                    {visibleProcesses.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-outline">
                          Nenhum processo em execução para este filtro.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: SAÚDE & TELEMETRIA */}
          {activeTab === 'saude' && (
            <div className="flex flex-col gap-5">
              {/* Telemetria Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {scheduler && (
                  <div className="p-3.5 rounded-xl bg-surface-panel/60 border border-border-subtle flex flex-col gap-1">
                    <span className="text-[11px] font-label-caps text-outline uppercase font-bold">
                      Grade &amp; Scheduler
                    </span>
                    <span className="text-sm font-label-mono font-bold text-on-surface">
                      {scheduler.activeRule?.name ?? 'Modo Direto / Manual'}
                    </span>
                    <span className="text-[12px] font-label-mono text-outline">
                      {scheduler.minutesRemaining === null ? scheduler.reason : `${scheduler.minutesRemaining} min restantes · Projeção ${scheduler.coverageHours}h`}
                    </span>
                    <span className="text-[11px] text-outline">
                      {scheduler.source === 'PUBLISHED' ? 'Playlist publicada em execução' : scheduler.source === 'LEGACY' ? 'Execução legada — sem revisão publicada' : 'Sem playlist em execução'}
                      {scheduler.rundownDate ? ` · ${scheduler.rundownDate}` : ''}
                    </span>
                    <span className="text-[11px] text-outline">Confira e enfileire a passagem para a próxima revisão publicada no Master.</span>
                  </div>
                )}

                {n1?.configured && (
                  <div className="p-3.5 rounded-xl bg-surface-panel/60 border border-border-subtle flex flex-col gap-1">
                    <span className="text-[11px] font-label-caps text-outline uppercase font-bold">
                      Redundância N+1
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[12px] font-label-mono font-bold ${
                          n1.reachable
                            ? 'bg-status-ok/20 text-status-ok-bright border border-status-ok/30'
                            : 'bg-on-air-crimson/20 text-on-air-crimson border border-on-air-crimson/30'
                        }`}
                      >
                        {n1.reachable ? 'ALCANÇÁVEL' : 'INDISPONÍVEL'}
                      </span>
                      {n1.latencyMs != null && (
                        <span className="text-[12px] font-label-mono text-outline">
                          {n1.latencyMs} ms
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="p-3.5 rounded-xl bg-surface-panel/60 border border-border-subtle flex flex-col gap-1">
                  <span className="text-[11px] font-label-caps text-outline uppercase font-bold">
                    Eventos Pendentes
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`px-2 py-0.5 rounded font-label-mono text-xs font-bold border ${criticalPending ? 'bg-on-air-crimson/20 text-on-air-crimson border-on-air-crimson/30' : 'bg-surface-container text-outline border-border-subtle'}`}>
                      Críticos sem reconhecimento: {criticalPending??'N/D'}
                    </span>
                    <span className={`px-2 py-0.5 rounded font-label-mono text-xs font-bold border ${warnPending ? 'bg-armed-amber/20 text-armed-amber border-armed-amber/30' : 'bg-surface-container text-outline border-border-subtle'}`}>
                      Atenção sem reconhecimento: {warnPending??'N/D'}
                    </span>
                  </div>
                </div>
              </div>

              <section aria-label="Incidentes nativos sem recuperação medida" className="p-3 rounded border border-armed-amber/40 text-xs">
                <h3 className="font-semibold">INCIDENTES NATIVOS QUE AINDA EXIGEM CONFERÊNCIA</h3>
                <p>Sem recuperação ou fim de observação registrado: {healthRisk?.observedUnresolved??'N/D'} · Observação encerrada sem recuperação: {healthRisk?.observationEndedUnresolved??'N/D'} · Sem contexto histórico: {healthRisk?.withoutContext??'N/D'}</p>
                <p className="text-outline mt-1">Abrange PGM, entradas e saídas de todo o canal, mesmo reconhecidos. Histórico não confirma defeito ou sinal saudável agora; confira a sonda e o destino físico.</p>
              </section>
              {/* Barra de Ações & Filtro */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Severidade dos incidentes"
                    value={healthFilter}
                    onChange={(event) => {resetHealthPage();setHealthFilter(event.target.value as typeof healthFilter)}}
                    className="bg-surface-panel border border-border-subtle text-on-surface text-xs font-label-mono px-3 py-1.5 rounded-lg focus:outline-none"
                  >
                    <option value="ALL">Todos os níveis de severidade</option>
                    <option value="CRITICAL">Somente Críticos</option>
                    <option value="WARN">Somente Atenção</option>
                    <option value="INFO">Somente Informativos</option>
                  </select>
                  <select aria-label="Reconhecimento dos incidentes" value={healthAckFilter} onChange={event=>{resetHealthPage();setHealthAckFilter(event.target.value as typeof healthAckFilter)}} className="bg-surface-panel border border-border-subtle text-xs p-1.5 rounded">
                    <option value="ALL">Todos os reconhecimentos</option><option value="PENDING">Sem reconhecimento</option><option value="ACKNOWLEDGED">Reconhecidos</option>
                  </select>
                </div>

                <a
                  className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-panel/80 border border-border-subtle text-xs font-label-caps text-primary font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  href={`/api/health-events.csv?channelId=${encodeURIComponent(channelId)}`}
                  download
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  BAIXAR CSV (ATÉ 10.000 RECENTES)
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs" aria-label="Navegação dos incidentes">
                <button type="button" disabled={!healthAnchor||healthLoading} onClick={resetHealthPage}>MAIS RECENTES</button>
                <button type="button" disabled={!healthNavigation.length||healthLoading} onClick={()=>{setHealthEvents([]);setHealthPage(null);setHealthLoading(true);setHealthNavigation(value=>value.slice(0,-1))}}>PÁGINA ANTERIOR</button>
                <span>Página {healthNavigation.length+1} · {healthPage?`${healthPage.totalMatching} eventos na janela`:'consulta pendente'}</span>
                <button type="button" disabled={healthLoading||!healthPage?.nextBefore} onClick={()=>{if(healthPage?.nextBefore){const {occurredAt,id}=healthPage.nextBefore;setHealthAnchor(healthPage.until);setHealthEvents([]);setHealthLoading(true);setHealthNavigation(value=>[...value,{until:healthPage.until,beforeAt:occurredAt,beforeId:id}]);setHealthPage(null)}}}>REGISTROS ANTERIORES</button>
                <button type="button" disabled={healthLoading} onClick={()=>void refresh()}>{healthLoading?'CONSULTANDO…':'ATUALIZAR PÁGINA'}</button>
                <p className="w-full text-outline">Mais recentes primeiro. Contagens de pendentes abrangem todo o canal, não apenas esta página. Reconhecimento não confirma recuperação.{healthAnchor?' Janela de datas fixa até MAIS RECENTES; reconhecimento e retenção refletem o estado atual.':''}{error?' Consulta falhou; registros e contagens anteriores podem estar desatualizados.':''}</p>
              </div>

              {/* Tabela de Eventos */}
              <div className="rounded-xl border border-border-subtle overflow-hidden bg-surface-panel/40">
                <table className="w-full text-left border-collapse text-xs font-label-mono">
                  <thead>
                    <tr className="bg-surface-base text-outline uppercase font-label-caps text-[11px] tracking-wider border-b border-border-subtle">
                      <th className="py-2.5 px-3">Horário</th>
                      <th className="py-2.5 px-3">Componente</th>
                      <th className="py-2.5 px-3">Severidade</th>
                      <th className="py-2.5 px-3">Estado</th>
                      <th className="py-2.5 px-3">Mensagem &amp; Resolução</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHealthEvents.map((event) => (
                      <tr key={event.id} className="border-b border-border-subtle/50 hover:bg-surface-panel/60 transition-colors">
                        <td className="py-2.5 px-3 text-outline">
                          <span title={`UTC: ${event.occurredAt}`}>{new Date(event.occurredAt).toLocaleString('pt-BR', { hour12: false })}</span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-on-surface">{event.component}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              event.severity === 'CRITICAL'
                                ? 'bg-on-air-crimson/20 text-on-air-crimson border border-on-air-crimson/30'
                                : event.severity === 'WARN'
                                ? 'bg-armed-amber/20 text-armed-amber border border-armed-amber/30'
                                : 'bg-status-ok/20 text-status-ok-bright border border-status-ok/30'
                            }`}
                          >
                            {event.severity}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-outline">{event.state}
                          {event.resolvedAt&&<span className="block text-primary">RECUPERADO POR MEDIÇÃO</span>}
                          {!event.resolvedAt&&event.observationEndedAt&&<span className="block text-armed-amber">OBSERVAÇÃO ENCERRADA · NÃO RESOLVIDO</span>}
                        </td>
                        <td className="py-2.5 px-3 text-on-surface">
                          <div className="flex items-center justify-between gap-3">
                            <div><span>{event.message ?? '—'}</span><IncidentContextDetails context={event.context}/></div>
                            {event.acknowledgedAt ? (
                              <span className="px-2 py-0.5 rounded bg-surface-base text-outline text-[11px] font-bold">
                                RECONHECIDO · NÃO CONFIRMA RECUPERAÇÃO
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="px-2.5 py-1 rounded bg-primary/20 hover:bg-primary/30 text-primary text-[11px] font-label-caps font-bold cursor-pointer transition-colors shrink-0"
                                disabled={acknowledgingHealth!==null}
                                title="Registra sua conferência; não confirma que o sinal foi recuperado."
                                onClick={() => {setHealthActionError(null);setAcknowledgingHealth(event.id);void api.acknowledgeHealth(event.id).then(()=>refresh()).catch(failure=>{if(mounted.current)setHealthActionError(failure instanceof Error?failure.message:'Não foi possível reconhecer o alerta.')}).finally(()=>{if(mounted.current)setAcknowledgingHealth(null)})}}
                              >
                                {acknowledgingHealth===event.id?'REGISTRANDO…':'RECONHECER'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visibleHealthEvents.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-outline">
                          {healthLoading?'Consultando incidentes…':error?'Não foi possível conferir os incidentes.':healthPage?'Nenhum evento registrado para os filtros selecionados.':'Incidentes ainda não consultados.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: CONVIDADOS (SRT INGRESS) */}
          {activeTab === 'convidados' && (
            <div className="flex flex-col gap-5">
              <div>
                <span className="font-label-caps text-[11px] text-outline font-bold uppercase tracking-wider">
                  LINKS DE INGRESS PARA CONVIDADOS &amp; REPÓRTERES (SRT)
                </span>
                <p className="text-[11px] text-outline mt-0.5">
                  Gera URLs dedicadas com chaves seguras para transmissão remota ao vivo diretamente no playout.
                </p>
              </div>

              {/* Lista de Convidados */}
              <div className="flex flex-col gap-3">
                {(data?.guests ?? []).map((guest) => {
                  const path = data?.paths.find((entry) => entry.name.endsWith(guest.streamKey))
                  return (
                    <div
                      key={guest.id}
                      className="p-4 rounded-xl bg-surface-panel/70 border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-headline-md text-sm font-bold text-on-surface">{guest.label}</span>
                          {path?.ready && (
                            <span className="px-2 py-0.5 rounded text-[12px] font-label-mono font-bold bg-status-ok/20 text-status-ok-bright border border-status-ok/30">
                              CONECTADO
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void copy(guest.publishUrl, onMessage)}
                          className="text-xs font-label-mono text-outline hover:text-primary transition-colors cursor-pointer text-left truncate max-w-xl block"
                          title="Clique para copiar a URL de publicação"
                        >
                          {guest.publishUrl}
                        </button>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void copy(guest.publishUrl, onMessage)}
                          className="px-3 py-1.5 rounded-lg bg-surface-panel hover:bg-surface-panel/80 border border-border-subtle text-xs font-label-caps text-on-surface font-bold cursor-pointer transition-colors"
                        >
                          COPIAR LINK
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void guard(async () => {
                              await api.removeGuest(guest.id)
                              onMessage(`Chave de acesso de ${guest.label} foi revogada.`)
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-on-air-crimson/10 hover:bg-on-air-crimson/20 border border-on-air-crimson/30 text-xs font-label-caps text-on-air-crimson font-bold cursor-pointer transition-colors"
                        >
                          REVOGAR
                        </button>
                      </div>
                    </div>
                  )
                })}

                {(data?.guests ?? []).length === 0 && (
                  <div className="p-6 rounded-lg bg-surface-panel/30 border border-border-subtle/50 text-center text-outline text-xs font-label-mono">
                    Nenhum convidado cadastrado. Crie um nome abaixo para gerar uma URL de transmissão remota.
                  </div>
                )}
              </div>

              {/* Criar Convidado Form */}
              <div className="p-4 rounded-xl bg-surface-panel/40 border border-border-subtle flex flex-col sm:flex-row items-center gap-3 mt-2">
                <input
                  type="text"
                  placeholder="Nome do repórter ou estúdio remoto (ex: Link Externo SP)"
                  value={guestLabel}
                  onChange={(event) => setGuestLabel(event.target.value)}
                  className="bg-surface-base border border-border-subtle focus:border-primary text-on-surface text-xs font-label-mono px-3 py-2 rounded-lg focus:outline-none flex-1 w-full"
                />
                <button
                  type="button"
                  disabled={guestLabel.trim() === ''}
                  onClick={() =>
                    void guard(async () => {
                      const created = await api.addGuest(channelId, guestLabel.trim())
                      setGuestLabel('')
                      await copy(created.publishUrl, onMessage)
                    })
                  }
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary font-label-caps text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 w-full sm:w-auto"
                >
                  CRIAR CHAVE &amp; COPIAR URL
                </button>
              </div>
            </div>
          )}

        </div>

        {/* FOOTER MODAL */}
        <footer className="px-6 py-3.5 border-t border-border-subtle flex items-center justify-between shrink-0 bg-surface-panel/40">
          <span className="text-[12px] font-label-mono text-outline">
            Distribuição pelo MediaMTX desta estação
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-surface-panel hover:bg-surface-panel/80 border border-border-subtle text-xs font-label-caps text-on-surface font-bold cursor-pointer transition-colors"
          >
            FECHAR
          </button>
        </footer>
      </div>
      {choosingFile && <ServerFileTargetDialog onClose={() => setChoosingFile(false)} onChoose={path => { setOutTarget(path); setChoosingFile(false) }} />}
    </div>
  )
}

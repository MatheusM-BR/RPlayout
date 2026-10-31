import { confirmAction } from '../domain/confirm.js'
import { MultichannelProgrammingPanel } from '../components/MultichannelProgrammingPanel.js'
import { deniedReason, useCan } from '../domain/permissions.js'
import { useState, useEffect, useCallback,useRef } from 'react'
import { sameRate, type Channel, type Scan, type FieldOrder } from '@rplayout/protocol'
import {CadenceConversionDialog,type CadenceConversionRequest} from '../components/CadenceConversionDialog.js'
import {ProjectRestorePanel} from '../components/ProjectRestorePanel.js'
import {formatStandardRate} from '../format.js'
import { api } from '../api.js'
import {channelConfigurationPatch} from '../domain/channel-configuration.js'
import { BUILD_COMMIT, buildDate } from '../build.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { PastasPanel } from '../components/PastasPanel.js'
import { CategoriasPanel } from '../components/CategoriasPanel.js'
import { UsersPanel } from '../components/UsersPanel.js'
import { IntegrationsPanel } from '../components/IntegrationsPanel.js'
import {OwnershipDiagnosticsPanel} from '../components/OwnershipDiagnosticsPanel.js'
import { SaidasTransmissaoPanel } from '../components/SaidasTransmissaoPanel.js'
import { EntradasAoVivoPanel } from '../components/EntradasAoVivoPanel.js'
import type { Live } from '../types.js'
import { engineIndicator } from '../domain/engine-indicator.js'

interface Props {
  channel: Channel
  live?: Live | null
  channels: Channel[]
  onNavigate: (workspace: WorkspaceId) => void
  onSelectChannel: (channelId: string) => void
  onMessage: (msg: string) => void
  onChanged: () => void
  sessionRole?: string
  authRequired?: boolean
  onOpenFormat?: (channelId: string) => void
  onOpenDistribution?: () => void
  onOpenGraphics?: () => void
  onOpenAudit?: () => void
}

type SettingsTab =
  | 'canais'
  | 'saidas'
  | 'entradas'
  | 'pastas'
  | 'categorias'
  | 'projetos'
  | 'usuarios'
  | 'integracoes'

export function SettingsView({
  channel,
  live = null,
  channels,
  onNavigate,
  onSelectChannel,
  onMessage,
  onChanged,
  sessionRole = 'Operador Master',
  authRequired = false,
  onOpenGraphics,
  onOpenAudit,
}: Props) {
  const canManageUsers = useCan('USER_MANAGE_LOWER')
  const canConfigure = useCan('OUTPUT_CONTROL')
  const [activeTab, setActiveTab] = useState<SettingsTab>('canais')
  const canRestoreProject = sessionRole === 'Supervisor' || sessionRole === 'Gestor' || sessionRole === 'Administrador'
  const [engineProcess, setEngineProcess] = useState<Awaited<ReturnType<typeof api.processes>>['processes'][number]>()
  const [processError, setProcessError] = useState(false)
  useEffect(() => {
    let active = true
    setEngineProcess(undefined); setProcessError(false)
    const refresh = async () => {
      try {
        const result = await api.processes()
        if (active) {
          setEngineProcess(result.processes.find(process => process.kind === 'ENGINE' && process.channelId === channel.id))
          setProcessError(false)
        }
      } catch { if (active) { setEngineProcess(undefined); setProcessError(true) } }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => { active = false; clearInterval(timer) }
  }, [channel.id])
  const engine = engineIndicator(engineProcess, processError || Boolean(live?.alerts.some(alert => alert.kind === 'ENGINE')))

  // Estado de edição de canal
  const [editingChannelId, setEditingChannelId] = useState<string>(channel.id)
  const currentEditingChannel = channels.find((c) => c.id === editingChannelId) || channel
  const [channelBaseline,setChannelBaseline]=useState(()=>structuredClone(currentEditingChannel))
  const editingChannelRef=useRef(currentEditingChannel.id)
  editingChannelRef.current=currentEditingChannel.id

  const [channelName, setChannelName] = useState(currentEditingChannel.name)
  const [width, setWidth] = useState(currentEditingChannel.width)
  const [height, setHeight] = useState(currentEditingChannel.height)
  const [rateNum, setRateNum] = useState(currentEditingChannel.rate.num)
  const [rateDen, setRateDen] = useState(currentEditingChannel.rate.den)
  const [scan, setScan] = useState<Scan>(currentEditingChannel.scan)
  const [fieldOrder, setFieldOrder] = useState<FieldOrder>(currentEditingChannel.fieldOrder)
  const [targetLufs, setTargetLufs] = useState(currentEditingChannel.targetLufs)
  const [ceilingDbtp, setCeilingDbtp] = useState(currentEditingChannel.ceilingDbtp)

  const [newChannelName, setNewChannelName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [conversion,setConversion]=useState<CadenceConversionRequest|null>(null)
  const [archivedChannels,setArchivedChannels]=useState<Channel[]>([])
  const loadArchivedChannels=useCallback(async()=>{
    try {setArchivedChannels((await api.archivedChannels()).channels)}
    catch(error){onMessage(error instanceof Error ? error.message : 'Não foi possível consultar canais arquivados.')}
  },[onMessage])
  useEffect(()=>{void loadArchivedChannels()},[loadArchivedChannels,channels])
  const handleReactivateChannel=async(archived:Channel)=>{
    if(!(await confirmAction(`Reativar “${archived.name}”? O PGM continuará parado. As saídas e chaves cadastradas voltarão a ficar disponíveis; confira a configuração antes de operar.`)))return
    setIsSaving(true)
    try{await api.reactivateChannel(archived.id);await loadArchivedChannels();onChanged();onMessage(`Canal “${archived.name}” reativado, sem TAKE automático.`)}
    catch(error){onMessage(error instanceof Error ? error.message : 'Não foi possível reativar o canal.')}
    finally{setIsSaving(false)}
  }

  const resetChannelDraft=(fresh:Channel)=>{
    setChannelBaseline(structuredClone(fresh));setChannelName(fresh.name);setWidth(fresh.width);setHeight(fresh.height)
    setRateNum(fresh.rate.num);setRateDen(fresh.rate.den);setScan(fresh.scan);setFieldOrder(fresh.fieldOrder)
    setTargetLufs(fresh.targetLufs);setCeilingDbtp(fresh.ceilingDbtp)
  }
  // Background snapshots never replace the baseline or erase a local draft.
  useEffect(() => {resetChannelDraft(currentEditingChannel)}, [currentEditingChannel.id])

  // Salva alterações no canal
  const handleSaveChannel = async () => {
    if(currentEditingChannel.id!==channelBaseline.id){onMessage('O canal selecionado mudou; nenhum campo foi enviado. Confira novamente.');return}
    const patch=channelConfigurationPatch(channelBaseline,{name:channelName,width,height,scan,fieldOrder,targetLufs,ceilingDbtp,rateNum,rateDen})
    if(!sameRate(channelBaseline.rate,{num:rateNum,den:rateDen})){
      const {rateNum:ignoredNum,rateDen:ignoredDen,...format}=patch
      setConversion({channel:channelBaseline,rate:{num:rateNum,den:rateDen},format})
      return
    }
    if(!Object.keys(patch).length){onMessage('Nenhuma configuração alterada.');return}
    setIsSaving(true)
    try {
      const result = await api.patchChannel(channelBaseline.id,patch,channelBaseline.configurationRevision)
      if(editingChannelRef.current!==channelBaseline.id){onChanged();onMessage(`Configuração de ${channelBaseline.name} gravada; a tela atual foi preservada.${result.engineError?` Atenção: ${result.engineError}`:''}`);return}
      setChannelBaseline({...channelBaseline,name:channelName,width,height,rate:{num:rateNum,den:rateDen},scan,fieldOrder,targetLufs,ceilingDbtp,configurationRevision:result.configurationRevision})
      onChanged()
      onMessage(
        result.engineError?`Configuração gravada, mas o engine exige conferência: ${result.engineError}. Confira antes de operar.`:result.formatChanged
          ? `Configuração de ${channelName} gravada. Reinício controlado solicitado; confira o estado do engine antes de operar.`
          : `Canal ${channelName} atualizado com sucesso.`,
      )
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao salvar configurações do canal.')
    } finally {
      setIsSaving(false)
    }
  }

  // Cria um novo canal
  const reloadChannelConfiguration=async()=>{
    if(!(await confirmAction('Reabrir a configuração atual do servidor? Isso descarta somente os campos locais deste formulário.')))return
    const id=currentEditingChannel.id
    setIsSaving(true)
    try{
      const {channel:fresh}=await api.channelConfiguration(id)
      if(editingChannelRef.current!==id)return
      resetChannelDraft(fresh)
      onChanged();onMessage('Configuração atual carregada. Revise antes de salvar.')
    }catch(error){onMessage(error instanceof Error?error.message:'Não foi possível reabrir; seus campos foram conservados.')}
    finally{setIsSaving(false)}
  }
  const handleCreateChannel = async () => {
    const nome = newChannelName.trim()
    if (!nome) return
    setIsSaving(true)
    try {
      await api.addChannel(nome)
      setNewChannelName('')
      onChanged()
      onMessage(`Canal "${nome}" criado com sucesso.`)
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao criar canal.')
    } finally {
      setIsSaving(false)
    }
  }

  // Archive never deletes history. Only the server knows the global active
  // count: the browser may see a single channel because of access policy.
  const handleDeleteChannel = async (id: string, nome: string) => {
    if (!(await confirmAction(`Arquivar o canal “${nome}”? Pare o PGM e limpe o CUE primeiro. Ele sairá da operação, mas grades, publicações, histórico de exibição e auditoria serão preservados.`))) {
      return
    }
    setIsSaving(true)
    try {
      await api.removeChannel(id)
      await loadArchivedChannels()
      onChanged()
      onMessage(`Canal “${nome}” arquivado. O histórico continua disponível em AIRED.`)
      if (editingChannelId === id) {
        const remaining = channels.filter((c) => c.id !== id)
        if (remaining[0]) setEditingChannelId(remaining[0].id)
      }
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao arquivar canal.')
    } finally {
      setIsSaving(false)
    }
  }

  // Presets de formato de vídeo
  // Presets: o destacado é o que bate com o formulário (antes 1080i ficava
  // sempre destacado, mesmo com o canal em 1080p29,97, que nem tinha preset).
  const VIDEO_PRESETS = [
    { id: '1080p29', label: '1080p29.97', width: 1920, height: 1080, num: 30000, den: 1001, scan: 'PROGRESSIVE' as const, title: 'Progressivo 29,97 qps (formato do canal RW)' },
    { id: '1080i59', label: '1080i59.94', width: 1920, height: 1080, num: 30000, den: 1001, scan: 'INTERLACED' as const, title: 'Entrelaçado 59,94 campos (TFF)' },
    { id: '1080p59', label: '1080p59.94', width: 1920, height: 1080, num: 60000, den: 1001, scan: 'PROGRESSIVE' as const, title: 'Progressivo 59,94 qps' },
    { id: '720p59', label: '720p59.94', width: 1280, height: 720, num: 60000, den: 1001, scan: 'PROGRESSIVE' as const, title: 'Progressivo 59,94 qps' },
    { id: '4k59', label: '4K 59.94', width: 3840, height: 2160, num: 60000, den: 1001, scan: 'PROGRESSIVE' as const, title: 'UHD progressivo 59,94 qps' },
  ]
  const applyVideoPreset = (id: string) => {
    const preset = VIDEO_PRESETS.find(entry => entry.id === id)
    if (!preset) return
    setWidth(preset.width); setHeight(preset.height); setRateNum(preset.num); setRateDen(preset.den); setScan(preset.scan); setFieldOrder('TFF')
  }

  if(conversion)return <CadenceConversionDialog request={conversion} onCancel={()=>setConversion(null)} onApplied={message=>{
    const id=conversion.channel.id
    setConversion(null);setIsSaving(true);onChanged();onMessage(message)
    void api.channelConfiguration(id).then(({channel:fresh})=>{if(editingChannelRef.current===id)resetChannelDraft(fresh)})
      .catch(error=>onMessage(`A conversão foi gravada, mas o formulário não foi recarregado. Reabra a configuração antes de salvar: ${error instanceof Error?error.message:'consulta indisponível'}`))
      .finally(()=>setIsSaving(false))
  }}/>
  return (
    <div className="bg-surface-base text-on-surface antialiased select-none flex flex-col h-screen overflow-hidden font-body-md text-body-md">
      {/* 1. CABEÇALHO PADRÃO RPLAYOUT */}
      <BroadcastHeader
        activeWorkspace="settings"
        channel={channel}
        channels={channels}
        onSelectChannel={onSelectChannel}
        onNavigate={onNavigate}
        sessionRole={sessionRole}
        authRequired={authRequired}
        onOpenSettings={() => setActiveTab('canais')}
      />

      <main className="w-full bg-surface-base flex-1 min-h-0 flex flex-col overflow-y-auto broadcast-scroll">
        {/* 2. BARRA DE TÍTULO TÁTICA */}
        <div className="w-full bg-surface-card border-b border-border-subtle px-margin py-3 flex flex-wrap items-center justify-between gap-gutter shadow-sm">
          <div className="flex items-center gap-space-md">
            <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shadow-sm">
              <span className="material-symbols-outlined text-[20px]">settings</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-headline-md text-headline-md tracking-wider text-on-surface uppercase leading-none font-bold">
                  CONFIGURAÇÕES // SISTEMA & CANAIS
                </h1>
                <span className={`font-label-caps text-[11px] px-2 py-0.5 rounded border font-bold uppercase ${engine.ok ? 'bg-status-ok/20 text-status-ok-bright border-status-ok/40' : 'text-armed-amber border-armed-amber/40'}`}>
                  {engine.label}
                </span>
              </div>
              <span className="font-label-mono text-label-mono text-outline">
                Canal em Foco: {channel.name} • Formato: {formatStandardRate(channel.rate,channel.scan,channel.height)} • {channel.width}x{channel.height}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-space-sm">
            {onOpenGraphics&&<button onClick={onOpenGraphics} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle font-body-sm text-[12px]" title="Abrir cadastro de artes, apresentação técnica e comandos de grafismo"><span className="material-symbols-outlined text-[16px]">subtitles</span><span>Grafismo & Artes</span></button>}
            {onOpenAudit && (
              <button
                onClick={onOpenAudit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle font-body-sm text-[12px] transition-colors cursor-pointer"
                title="Abrir auditoria completa do sistema"
              >
                <span className="material-symbols-outlined text-[16px]">policy</span>
                <span>Auditoria</span>
              </button>
            )}
            <button
              onClick={() => onNavigate('master')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-primary hover:bg-accent-ice text-surface-base font-body-sm text-[13px] font-semibold transition-all shadow-sm cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">play_circle</span>
              <span>VOLTAR AO MASTER</span>
            </button>
          </div>
        </div>

        {/* 3. LAYOUT DE ABAS LATERAIS + PAINEL DE CONTEÚDO */}
        <div className="px-margin py-space-md flex-1 flex flex-col lg:flex-row gap-gutter">
          {/* Menu Lateral de Abas */}
          <aside className="w-full lg:w-72 flex flex-col gap-1 shrink-0">
            <span className="font-label-caps text-[11px] text-outline uppercase font-bold px-1 mb-1">
              Categorias de Configuração
            </span>
            <div className="bg-surface-card rounded-xl border border-border-subtle p-2 flex flex-col gap-1 shadow-sm">
              <button
                onClick={() => setActiveTab('canais')}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeTab === 'canais'
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">tv</span>
                <div className="flex flex-col">
                  <span className="font-body-sm text-[12.5px] leading-tight">Canais & Formatos</span>
                  <span className="font-label-mono text-[12px] opacity-75">Resolução, fps, varredura</span>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('saidas')}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeTab === 'saidas'
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">output</span>
                <div className="flex flex-col">
                  <span className="font-body-sm text-[12.5px] leading-tight">Saídas de Transmissão</span>
                  <span className="font-label-mono text-[12px] opacity-75">DeckLink, NDI, SRT, RTMP</span>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('entradas')}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeTab === 'entradas'
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">input</span>
                <div className="flex flex-col">
                  <span className="font-body-sm text-[12.5px] leading-tight">Entradas & Ao Vivo</span>
                  <span className="font-label-mono text-[12px] opacity-75">SDI Ingest, NDI Discovery, SRT</span>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('projetos')}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeTab === 'projetos'
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                <div className="flex flex-col">
                  <span className="font-body-sm text-[12.5px] leading-tight">Projetos & Restauração</span>
                  <span className="font-label-mono text-[12px] opacity-75">Pontos seguros por canal</span>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('pastas')}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeTab === 'pastas'
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">folder_special</span>
                <div className="flex flex-col">
                  <span className="font-body-sm text-[12.5px] leading-tight">Acervo & Pastas MAM</span>
                  <span className="font-label-mono text-[12px] opacity-75">Diretórios de mídia locais</span>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('categorias')}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeTab === 'categorias'
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">palette</span>
                <div className="flex flex-col">
                  <span className="font-body-sm text-[12.5px] leading-tight">Categorias & Cores</span>
                  <span className="font-label-mono text-[12px] opacity-75">Badges operacionais</span>
                </div>
              </button>

              {canManageUsers && <button
                onClick={() => setActiveTab('usuarios')}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeTab === 'usuarios'
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">group</span>
                <div className="flex flex-col">
                  <span className="font-body-sm text-[12.5px] leading-tight">Usuários & Acesso</span>
                  <span className="font-label-mono text-[12px] opacity-75">Contas e papéis RBAC</span>
                </div>
              </button>}

              <button
                onClick={() => setActiveTab('integracoes')}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left transition-all cursor-pointer ${
                  activeTab === 'integracoes'
                    ? 'bg-primary-container text-on-primary-container font-bold border border-border-strong shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-panel'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">hub</span>
                <div className="flex flex-col">
                  <span className="font-body-sm text-[12.5px] leading-tight">Integrações & API</span>
                  <span className="font-label-mono text-[12px] opacity-75">Webhooks, SCTE-35</span>
                </div>
              </button>
            </div>

            {/* Carimbo de Build e Versão */}
            <div className="bg-surface-card rounded-xl border border-border-subtle p-3 mt-2 shadow-sm flex flex-col gap-1 font-label-mono text-[12px] text-outline">
              <div className="flex items-center justify-between">
                <span>COMMIT:</span>
                <span className="text-on-surface font-bold">{BUILD_COMMIT || 'DEV-LOCAL'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>BUILD:</span>
                <span>{buildDate() || 'Recente'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>ESTADO:</span>
                <span className={`font-bold ${engine.ok ? 'text-status-ok-bright' : 'text-armed-amber'}`}>{engine.label}</span>
              </div>
            </div>
          </aside>

          {/* Área Central da Aba Selecionada */}
          <section className="flex-1 min-h-0 flex flex-col gap-gutter min-w-0">
            {/* TAB 1: CANAIS E FORMATOS */}
            {activeTab === 'canais' && (
              <div className="flex flex-col gap-gutter">
                {/* Lista de Canais Configurados */}
                <div className="bg-surface-card rounded-xl border border-border-subtle p-4 shadow-sm flex flex-col gap-3">
                  <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
                    <div>
                      <h3 className="font-headline-md text-[16px] text-on-surface font-bold">
                        Canais de Exibição Ativos
                      </h3>
                      <p className="font-body-sm text-[11.5px] text-outline">
                        Cada canal roda em processo independente com seu próprio pipeline de engine e grade linear.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {channels.map((ch) => {
                      const isSelected = ch.id === editingChannelId
                      const isFocused = ch.id === channel.id
                      return (
                        <div
                          key={ch.id}
                          onClick={() => setEditingChannelId(ch.id)}
                          className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                            isSelected
                              ? 'bg-primary-container/20 border-primary shadow-sm'
                              : 'bg-surface-panel border-border-subtle hover:border-border-strong'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-primary text-[20px]">
                                tv
                              </span>
                              <div>
                                <h4 className="font-headline-md text-[14px] text-on-surface font-bold leading-tight">
                                  {ch.name}
                                </h4>
                                <span className="font-label-mono text-[12px] text-outline">
                                  ID: {ch.id.slice(0, 8)}...
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {isFocused && (
                                <span className="font-label-caps text-[11px] px-1.5 py-0.5 rounded bg-primary text-surface-base font-bold">
                                  CANAL EM FOCO
                                </span>
                              )}
                              {isSelected && (
                                <span className="font-label-caps text-[11px] px-1.5 py-0.5 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40 font-bold">
                                  SELECIONADO
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between font-label-mono text-[12px] text-on-surface-variant border-t border-border-subtle/50 pt-2">
                            <span>
                              {ch.width}x{ch.height} • {formatStandardRate(ch.rate,ch.scan,ch.height)}
                            </span>
                            <span>
                              {ch.scan === 'INTERLACED' ? 'Entrelaçado' : 'Progressivo'}
                            </span>
                          </div>

                          <div className="flex items-center justify-end gap-1.5 pt-1">
                            {!isFocused && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onSelectChannel(ch.id)
                                }}
                                className="px-2 py-1 rounded bg-surface-base hover:bg-surface-container text-on-surface font-label-caps text-[11px] border border-border-subtle cursor-pointer"
                              >
                                Focar Canal
                              </button>
                            )}
                            <button
                              disabled={isSaving || !canRestoreProject}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteChannel(ch.id, ch.name)
                              }}
                              className="px-2 py-1 rounded bg-on-air-crimson/20 hover:bg-on-air-crimson/30 text-on-air-crimson font-label-caps text-[11px] border border-on-air-crimson/40 cursor-pointer disabled:opacity-30"
                              title="Arquivar canal sem apagar histórico; exige PGM parado e CUE limpo."
                            >
                              Arquivar
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Adição Rápida de Canal */}
                  {archivedChannels.length>0 && <div className="border border-border-subtle rounded p-3 space-y-2">
                    <h4 className="text-sm font-bold">Canais arquivados — histórico preservado</h4>
                    <p className="text-xs text-outline">Não aparecem no Master nem iniciam engine. Consulte os registros no seletor de histórico do AIRED.</p>
                    {archivedChannels.map(archived=><div key={archived.id} className="flex items-center justify-between gap-3">
                      <span className="text-xs">{archived.name} · {archived.archivedAt ? new Date(archived.archivedAt).toLocaleString('pt-BR') : ''}</span>
                      <button disabled={isSaving || !canRestoreProject} onClick={()=>void handleReactivateChannel(archived)} className="rounded border border-border-subtle px-2 py-1 text-xs disabled:opacity-40">REATIVAR PARADO</button>
                    </div>)}
                  </div>}
                  <div className="flex items-center gap-2 pt-2 border-t border-border-subtle mt-1">
                    <input
                      type="text"
                      placeholder="Nome para novo canal (ex: Canal 2 - TV Aberta)"
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateChannel()}
                      className="flex-1 bg-surface-panel text-on-surface px-3 py-1.5 rounded border border-border-subtle font-body-sm text-[12.5px] outline-none focus:border-primary"
                    />
                    <button
                      disabled={isSaving || !newChannelName.trim() || !canConfigure}
                      title={canConfigure ? undefined : deniedReason('criar canais')}
                      onClick={handleCreateChannel}
                      className="px-4 py-1.5 rounded bg-primary-container hover:bg-accent-ice text-on-primary-container font-headline-md text-headline-md tracking-wider transition-all disabled:opacity-40 cursor-pointer"
                    >
                      CRIAR NOVO CANAL
                    </button>
                  </div>
                </div>

                {/* Painel de Edição Detalhada do Canal Selecionado */}
                <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                    <div>
                      <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
                        Parâmetros Técnicos de Exibição // {currentEditingChannel.name}
                      </h3>
                      <p className="font-body-sm text-[11.5px] text-outline">
                        Ajuste as características de vídeo, cadência de quadros e alvos de normalização acústica.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-label-caps text-[11px] text-outline uppercase font-bold">Presets:</span>
                      {VIDEO_PRESETS.map(preset => {
                        const current = preset.width === width && preset.height === height && preset.num === rateNum && preset.den === rateDen && preset.scan === scan
                        return (
                          <button key={preset.id} onClick={() => applyVideoPreset(preset.id)} title={preset.title} aria-pressed={current}
                            className={`px-2 py-0.5 rounded font-label-caps text-[11px] border cursor-pointer ${current ? 'bg-primary/20 text-primary font-bold border-primary/40' : 'bg-surface-panel hover:bg-surface-container border-border-subtle'}`}>
                            {preset.label}{current ? ' · atual' : ''}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Nome do Canal */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-label-caps text-[11px] text-outline uppercase font-bold">
                        Nome do Canal
                      </label>
                      <input
                        type="text"
                        value={channelName}
                        onChange={(e) => setChannelName(e.target.value)}
                        className="bg-surface-panel text-on-surface px-3 py-2 rounded border border-border-subtle font-body-sm text-[13px] outline-none focus:border-primary"
                      />
                    </div>

                    {/* Resolução */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-label-caps text-[11px] text-outline uppercase font-bold">
                        Resolução de Vídeo
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={width}
                          onChange={(e) => setWidth(Number(e.target.value))}
                          className="w-1/2 bg-surface-panel text-on-surface px-3 py-2 rounded border border-border-subtle font-label-mono text-[12px] outline-none focus:border-primary"
                          placeholder="Largura"
                        />
                        <span className="text-outline">×</span>
                        <input
                          type="number"
                          value={height}
                          onChange={(e) => setHeight(Number(e.target.value))}
                          className="w-1/2 bg-surface-panel text-on-surface px-3 py-2 rounded border border-border-subtle font-label-mono text-[12px] outline-none focus:border-primary"
                          placeholder="Altura"
                        />
                      </div>
                    </div>

                    {/* Cadência / Framerate */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-label-caps text-[11px] text-outline uppercase font-bold">
                        Taxa de Quadros (FPS)
                      </label>
                      <select
                        value={`${rateNum}/${rateDen}`}
                        onChange={(e) => {
                          const [num, den] = e.target.value.split('/').map(Number)
                          setRateNum(num || 50)
                          setRateDen(den || 1)
                        }}
                        className="bg-surface-panel text-on-surface px-3 py-2 rounded border border-border-subtle font-label-mono text-[12px] outline-none focus:border-primary cursor-pointer"
                      >
                        <option value="60000/1001">59.94 fps (NTSC Broadcast)</option>
                        <option value="50/1">50.00 fps (PAL / EBU)</option>
                        <option value="30000/1001">29.97 fps (NTSC Legado)</option>
                        <option value="25/1">25.00 fps (PAL Cinema)</option>
                        <option value="24000/1001">23.98 fps (Cinema Film)</option>
                        <option value="60/1">60.00 fps (Digital)</option>
                      </select>
                    </div>

                    {/* Varredura */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-label-caps text-[11px] text-outline uppercase font-bold">
                        Padrão de Varredura
                      </label>
                      <select
                        value={scan}
                        onChange={(e) => setScan(e.target.value as Scan)}
                        className="bg-surface-panel text-on-surface px-3 py-2 rounded border border-border-subtle font-label-caps text-[11px] outline-none focus:border-primary cursor-pointer"
                      >
                        <option value="PROGRESSIVE">Progressivo (p)</option>
                        <option value="INTERLACED">Entrelaçado (i)</option>
                      </select>
                    </div>

                    {/* Loudness Target */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-label-caps text-[11px] text-outline uppercase font-bold">
                        Target de Loudness (EBU R128)
                      </label>
                      <select
                        value={targetLufs}
                        onChange={(e) => setTargetLufs(Number(e.target.value))}
                        className="bg-surface-panel text-on-surface px-3 py-2 rounded border border-border-subtle font-label-mono text-[12px] outline-none focus:border-primary cursor-pointer"
                      >
                        <option value={-24}>-24.0 LUFS (ATSC A/85 · comum na TV brasileira)</option>
                        <option value={-23}>-23.0 LUFS (EBU R128)</option>
                        <option value={-16}>-16.0 LUFS (Podcasts / Apple)</option>
                        <option value={-14}>-14.0 LUFS (Web / YouTube)</option>
                      </select>
                    </div>

                    {/* True Peak Ceiling */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-label-caps text-[11px] text-outline uppercase font-bold">
                        Teto de Pico Verdadeiro (True Peak)
                      </label>
                      <select
                        value={ceilingDbtp}
                        onChange={(e) => setCeilingDbtp(Number(e.target.value))}
                        className="bg-surface-panel text-on-surface px-3 py-2 rounded border border-border-subtle font-label-mono text-[12px] outline-none focus:border-primary cursor-pointer"
                      >
                        <option value={-1.0}>-1.0 dBTP (EBU R128 Rigoroso)</option>
                        <option value={-0.5}>-0.5 dBTP (Padrão Masterização)</option>
                        <option value={-2.0}>-2.0 dBTP (Compressão Lossy)</option>
                      </select>
                    </div>
                  </div>

                  {currentEditingChannel.configurationRevision!==channelBaseline.configurationRevision&&<p role="alert" className="text-sm text-armed-amber">A configuração mudou desde a abertura. Seus campos foram conservados; reabra a configuração para conferir antes de aplicar.</p>}
                  <button disabled={isSaving} onClick={()=>void reloadChannelConfiguration()} className="text-primary text-sm disabled:opacity-50">REABRIR CONFIGURAÇÃO DO SERVIDOR</button>
                  <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
                    <span className="font-label-mono text-[12px] text-outline">
                      Alterar o formato reconstrói o engine e provoca uma interrupção controlada do canal.
                    </span>
                    <button
                      disabled={isSaving || !canConfigure}
                      title={canConfigure ? undefined : deniedReason('alterar o formato do canal')}
                      onClick={handleSaveChannel}
                      className="flex items-center gap-2 px-5 py-2 rounded bg-primary hover:bg-accent-ice text-surface-base font-body-sm text-[13px] font-semibold transition-all shadow-md cursor-pointer disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">save</span>
                      <span>{isSaving ? 'SALVANDO...' : 'SALVAR CANAL'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SAÍDAS DE TRANSMISSÃO */}
            {activeTab === 'canais' && <MultichannelProgrammingPanel channel={channel} channels={channels} onMessage={onMessage} onChanged={onChanged} />}

            {activeTab === 'saidas' && (
              <SaidasTransmissaoPanel
                channel={currentEditingChannel}
                onMessage={onMessage}
                onChanged={onChanged}
              />
            )}

            {/* TAB 3: ENTRADAS E AO VIVO */}
            {activeTab === 'entradas' && (
              <EntradasAoVivoPanel
                key={currentEditingChannel.id}
                channel={currentEditingChannel}
                onMessage={onMessage}
                onChanged={onChanged}
              />
            )}

            {activeTab === 'projetos' && (
              <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm max-w-4xl">
                <div className="border-b border-border-subtle pb-3 mb-4">
                  <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">inventory_2</span>
                    Projetos do Canal: {currentEditingChannel.name}
                  </h3>
                  <p className="font-body-sm text-[11.5px] text-outline mt-1">Salva grade, fontes ao vivo, saídas, regras, multiview e gráficos deste canal. Restaurar exige Supervisor/Gestor/Administrador, PGM parado e CUE limpo; reinicia o engine para aplicar a configuração. Publicações existentes são preservadas: revise e publique a grade restaurada. Não altera os demais canais nem o acervo MAM.</p>
                </div>
                <ProjectRestorePanel key={currentEditingChannel.id} channelId={currentEditingChannel.id} canRestore={canRestoreProject} externalBusy={isSaving} onMessage={onMessage} onChanged={onChanged}/>
              </div>
            )}

            {/* TAB 4: ACERVO E PASTAS MAM */}
            {activeTab === 'pastas' && (
              <div className="flex flex-col gap-gutter">
                <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm">
                  <div className="border-b border-border-subtle pb-3 mb-4">
                    <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-[20px]">folder_special</span>
                      Diretórios Raiz do Acervo MAM
                    </h3>
                    <p className="font-body-sm text-[11.5px] text-outline">
                      Pastas monitoradas continuamente no disco local ou storage SAN/NAS. Somente arquivos de vídeo válidos entram na biblioteca.
                    </p>
                  </div>
                  <PastasPanel onMessage={onMessage} onChanged={onChanged} />
                </div>
              </div>
            )}

            {/* TAB 5: CATEGORIAS E CORES */}
            {activeTab === 'categorias' && (
              <div className="flex flex-col gap-gutter">
                <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm">
                  <div className="border-b border-border-subtle pb-3 mb-4">
                    <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-[20px]">palette</span>
                      Taxonomia de Programação & Categorias
                    </h3>
                    <p className="font-body-sm text-[11.5px] text-outline">
                      Defina códigos de identificação e paleta cromática para organização visual rápida da grade linear e relatórios As-Run.
                    </p>
                  </div>
                  <CategoriasPanel onMessage={onMessage} onChanged={onChanged} />
                </div>
              </div>
            )}

            {/* TAB 6: USUÁRIOS E ACESSO RBAC */}
            {activeTab === 'usuarios' && canManageUsers && (
              <div className="flex flex-col gap-gutter">
                <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm">
                  <div className="border-b border-border-subtle pb-3 mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-[20px]">group</span>
                        Controle de Acesso Baseado em Papéis (RBAC)
                      </h3>
                      <p className="font-body-sm text-[11.5px] text-outline">
                        Crie credenciais para Operadores Master, Programadores de Playlist, Engenharia e Administradores de Sistema.
                      </p>
                    </div>
                    <span className={`font-label-caps text-[11px] px-2.5 py-0.5 rounded font-bold ${
                      authRequired
                        ? 'bg-status-ok/20 text-status-ok-bright border border-status-ok/40'
                        : 'bg-primary/20 text-primary border border-primary/40'
                    }`}>
                      {authRequired ? 'LOGIN AUTENTICADO ATIVO' : 'MODO LOCAL DESENVOLVIMENTO'}
                    </span>
                  </div>
                  <UsersPanel onMessage={onMessage} />
                </div>
              </div>
            )}

            {/* TAB 7: INTEGRAÇÕES & API */}
            {activeTab === 'integracoes' && (
              <div className="flex flex-col gap-gutter">
                <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm">
                  <div className="border-b border-border-subtle pb-3 mb-4">
                    <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-[20px]">hub</span>
                      Disparos SCTE-35, Webhooks & Automação de Estúdio
                    </h3>
                    <p className="font-body-sm text-[11.5px] text-outline">
                      Gatilhos HTTP ficam em fila durável. A confirmação depende da resposta do gateway; não comprova inserção física SCTE na saída.
                    </p>
                  </div>
                  <IntegrationsPanel channelId={channel.id} onMessage={onMessage} />
                  <OwnershipDiagnosticsPanel channelId={channel.id}/>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

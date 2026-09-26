import { useState, useEffect, useCallback } from 'react'
import { formatVideoFormat, type Channel, type Scan, type FieldOrder } from '@rplayout/protocol'
import { api } from '../api.js'
import { BUILD_COMMIT, buildDate } from '../build.js'
import type { WorkspaceId } from '../components/WorkspaceShell.js'
import { BroadcastHeader } from '../components/broadcast/BroadcastHeader.js'
import { PastasPanel } from '../components/PastasPanel.js'
import { CategoriasPanel } from '../components/CategoriasPanel.js'
import { UsersPanel } from '../components/UsersPanel.js'
import { IntegrationsPanel } from '../components/IntegrationsPanel.js'
import { SaidasTransmissaoPanel } from '../components/SaidasTransmissaoPanel.js'
import { EntradasAoVivoPanel } from '../components/EntradasAoVivoPanel.js'

interface Props {
  channel: Channel
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
  channels,
  onNavigate,
  onSelectChannel,
  onMessage,
  onChanged,
  sessionRole = 'Operador Master',
  authRequired = false,
  onOpenAudit,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('canais')

  // Estado de edição de canal
  const [editingChannelId, setEditingChannelId] = useState<string>(channel.id)
  const currentEditingChannel = channels.find((c) => c.id === editingChannelId) || channel

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
  const [projectLabel, setProjectLabel] = useState('')
  const [projects, setProjects] = useState<Array<{ id: string; label: string; createdAt: string }>>([])

  const loadProjects = useCallback(async () => {
    try {
      const result = await api.channelProjects(currentEditingChannel.id)
      setProjects(result.projects)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Não foi possível consultar os projetos do canal.')
    }
  }, [currentEditingChannel.id, onMessage])

  // Atualiza os campos do formulário quando o canal em edição muda
  useEffect(() => {
    setChannelName(currentEditingChannel.name)
    setWidth(currentEditingChannel.width)
    setHeight(currentEditingChannel.height)
    setRateNum(currentEditingChannel.rate.num)
    setRateDen(currentEditingChannel.rate.den)
    setScan(currentEditingChannel.scan)
    setFieldOrder(currentEditingChannel.fieldOrder)
    setTargetLufs(currentEditingChannel.targetLufs)
    setCeilingDbtp(currentEditingChannel.ceilingDbtp)
  }, [editingChannelId, currentEditingChannel])

  useEffect(() => {
    if (activeTab === 'projetos') void loadProjects()
  }, [activeTab, loadProjects])

  const handleSaveProject = async () => {
    const label = projectLabel.trim() || `Ponto manual ${new Date().toLocaleString('pt-BR')}`
    setIsSaving(true)
    try {
      const result = await api.saveChannelProject(currentEditingChannel.id, label)
      setProjects(result.projects)
      setProjectLabel('')
      onMessage(`Projeto do canal salvo: ${result.project.label}.`)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Não foi possível salvar o projeto.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRestoreProject = async (project: { id: string; label: string }) => {
    if (!window.confirm(`Restaurar “${project.label}” somente neste canal? A configuração e a grade atuais deste canal serão substituídas.`)) return
    setIsSaving(true)
    try {
      const result = await api.restoreChannelProject(currentEditingChannel.id, project.id)
      await loadProjects()
      onChanged()
      onMessage(`Projeto restaurado: ${result.restored.label}.`)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Não foi possível restaurar o projeto.')
    } finally {
      setIsSaving(false)
    }
  }

  // Salva alterações no canal
  const handleSaveChannel = async () => {
    setIsSaving(true)
    try {
      const result = await api.patchChannel(currentEditingChannel.id, {
        name: channelName,
        width,
        height,
        rateNum,
        rateDen,
        scan,
        fieldOrder,
      })
      onChanged()
      onMessage(
        result.formatChanged
          ? `Canal ${channelName} reconfigurado para novo formato. O engine foi reconstruído.`
          : `Canal ${channelName} atualizado com sucesso.`,
      )
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao salvar configurações do canal.')
    } finally {
      setIsSaving(false)
    }
  }

  // Cria um novo canal
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

  // Exclui um canal
  const handleDeleteChannel = async (id: string, nome: string) => {
    if (channels.length <= 1) {
      onMessage('Não é possível apagar o único canal do sistema.')
      return
    }
    if (!window.confirm(`Tem certeza que deseja apagar o canal "${nome}"? Sua programação e saídas associadas serão removidas.`)) {
      return
    }
    setIsSaving(true)
    try {
      await api.removeChannel(id)
      onChanged()
      onMessage(`Canal "${nome}" excluído.`)
      if (editingChannelId === id) {
        const remaining = channels.filter((c) => c.id !== id)
        if (remaining[0]) setEditingChannelId(remaining[0].id)
      }
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao excluir canal.')
    } finally {
      setIsSaving(false)
    }
  }

  // Presets de formato de vídeo
  const applyVideoPreset = (preset: '1080i59' | '1080p59' | '720p59' | '4k59') => {
    switch (preset) {
      case '1080i59':
        setWidth(1920)
        setHeight(1080)
        setRateNum(30000)
        setRateDen(1001)
        setScan('INTERLACED')
        setFieldOrder('TFF')
        break
      case '1080p59':
        setWidth(1920)
        setHeight(1080)
        setRateNum(60000)
        setRateDen(1001)
        setScan('PROGRESSIVE')
        setFieldOrder('TFF')
        break
      case '720p59':
        setWidth(1280)
        setHeight(720)
        setRateNum(60000)
        setRateDen(1001)
        setScan('PROGRESSIVE')
        setFieldOrder('TFF')
        break
      case '4k59':
        setWidth(3840)
        setHeight(2160)
        setRateNum(60000)
        setRateDen(1001)
        setScan('PROGRESSIVE')
        setFieldOrder('TFF')
        break
    }
  }

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
                <span className="font-label-caps text-[9px] px-2 py-0.5 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40 font-bold uppercase">
                  MASTER ENG OK
                </span>
              </div>
              <span className="font-label-mono text-label-mono text-outline">
                Canal em Foco: {channel.name} • Formato: {formatVideoFormat(channel)} • {channel.width}x{channel.height}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-space-sm">
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
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-primary hover:bg-accent-ice text-surface-base font-headline-md text-headline-md tracking-wide transition-all shadow-sm cursor-pointer"
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
            <span className="font-label-caps text-[10px] text-outline uppercase font-bold px-1 mb-1">
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
                  <span className="font-label-mono text-[9px] opacity-75">Resolução, fps, varredura</span>
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
                  <span className="font-label-mono text-[9px] opacity-75">DeckLink, NDI, SRT, RTMP</span>
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
                  <span className="font-label-mono text-[9px] opacity-75">SDI Ingest, NDI Discovery, SRT</span>
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
                  <span className="font-label-mono text-[9px] opacity-75">Pontos seguros por canal</span>
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
                  <span className="font-label-mono text-[9px] opacity-75">Diretórios de mídia locais</span>
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
                  <span className="font-label-mono text-[9px] opacity-75">Badges operacionais</span>
                </div>
              </button>

              <button
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
                  <span className="font-label-mono text-[9px] opacity-75">Contas e papéis RBAC</span>
                </div>
              </button>

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
                  <span className="font-label-mono text-[9px] opacity-75">Webhooks, SCTE-35</span>
                </div>
              </button>
            </div>

            {/* Carimbo de Build e Versão */}
            <div className="bg-surface-card rounded-xl border border-border-subtle p-3 mt-2 shadow-sm flex flex-col gap-1 font-label-mono text-[10px] text-outline">
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
                <span className="text-status-ok-bright font-bold">ESTÁVEL</span>
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
                                <span className="font-label-mono text-[10px] text-outline">
                                  ID: {ch.id.slice(0, 8)}...
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              {isFocused && (
                                <span className="font-label-caps text-[8.5px] px-1.5 py-0.5 rounded bg-primary text-surface-base font-bold">
                                  NO AR
                                </span>
                              )}
                              {isSelected && (
                                <span className="font-label-caps text-[8.5px] px-1.5 py-0.5 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40 font-bold">
                                  SELECIONADO
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between font-label-mono text-[10px] text-on-surface-variant border-t border-border-subtle/50 pt-2">
                            <span>
                              {ch.width}x{ch.height} • {formatVideoFormat(ch)}
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
                                className="px-2 py-1 rounded bg-surface-base hover:bg-surface-container text-on-surface font-label-caps text-[9.5px] border border-border-subtle cursor-pointer"
                              >
                                Focar Canal
                              </button>
                            )}
                            <button
                              disabled={channels.length <= 1}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteChannel(ch.id, ch.name)
                              }}
                              className="px-2 py-1 rounded bg-on-air-crimson/20 hover:bg-on-air-crimson/30 text-on-air-crimson font-label-caps text-[9.5px] border border-on-air-crimson/40 cursor-pointer disabled:opacity-30"
                              title="Excluir canal"
                            >
                              Excluir
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Adição Rápida de Canal */}
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
                      disabled={isSaving || !newChannelName.trim()}
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
                      <span className="font-label-caps text-[10px] text-outline uppercase font-bold">Presets:</span>
                      <button
                        onClick={() => applyVideoPreset('1080i59')}
                        className="px-2 py-0.5 rounded bg-primary/20 hover:bg-primary/30 text-primary font-label-caps text-[9.5px] font-bold border border-primary/40 cursor-pointer"
                        title="Padrão Broadcast Nacional (1080i 59.94Hz, 29.97 fps, Top Field First)"
                      >
                        1080i59.94 (Padrão)
                      </button>
                      <button
                        onClick={() => applyVideoPreset('1080p59')}
                        className="px-2 py-0.5 rounded bg-surface-panel hover:bg-surface-container font-label-caps text-[9.5px] border border-border-subtle cursor-pointer"
                        title="Padrão Progressivo 59.94 fps"
                      >
                        1080p59.94
                      </button>
                      <button
                        onClick={() => applyVideoPreset('720p59')}
                        className="px-2 py-0.5 rounded bg-surface-panel hover:bg-surface-container font-label-caps text-[9.5px] border border-border-subtle cursor-pointer"
                      >
                        720p59.94
                      </button>
                      <button
                        onClick={() => applyVideoPreset('4k59')}
                        className="px-2 py-0.5 rounded bg-surface-panel hover:bg-surface-container font-label-caps text-[9.5px] border border-border-subtle cursor-pointer"
                      >
                        4K 59.94
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Nome do Canal */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-label-caps text-[10px] text-outline uppercase font-bold">
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
                      <label className="font-label-caps text-[10px] text-outline uppercase font-bold">
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
                      <label className="font-label-caps text-[10px] text-outline uppercase font-bold">
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
                      <label className="font-label-caps text-[10px] text-outline uppercase font-bold">
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
                      <label className="font-label-caps text-[10px] text-outline uppercase font-bold">
                        Target de Loudness (EBU R128)
                      </label>
                      <select
                        value={targetLufs}
                        onChange={(e) => setTargetLufs(Number(e.target.value))}
                        className="bg-surface-panel text-on-surface px-3 py-2 rounded border border-border-subtle font-label-mono text-[12px] outline-none focus:border-primary cursor-pointer"
                      >
                        <option value={-24}>-24.0 LUFS (Padrão TV Brasil / EBU R128)</option>
                        <option value={-23}>-23.0 LUFS (EBU Estendido)</option>
                        <option value={-16}>-16.0 LUFS (Podcasts / Apple)</option>
                        <option value={-14}>-14.0 LUFS (Web / YouTube)</option>
                      </select>
                    </div>

                    {/* True Peak Ceiling */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-label-caps text-[10px] text-outline uppercase font-bold">
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

                  <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
                    <span className="font-label-mono text-[11px] text-outline">
                      Configurações aplicadas reiniciarão suavemente o pipeline de exibição do canal.
                    </span>
                    <button
                      disabled={isSaving}
                      onClick={handleSaveChannel}
                      className="flex items-center gap-2 px-5 py-2 rounded bg-primary hover:bg-accent-ice text-surface-base font-headline-md text-headline-md tracking-wider transition-all shadow-md cursor-pointer disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">save</span>
                      <span>{isSaving ? 'SALVANDO...' : 'SALVAR CANAL'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SAÍDAS DE TRANSMISSÃO */}
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
                  <p className="font-body-sm text-[11.5px] text-outline mt-1">Salva grade, fontes ao vivo, saídas, regras, multiview e gráficos deste canal. Restaurar não altera os demais canais nem o acervo MAM.</p>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  <input value={projectLabel} onChange={(event) => setProjectLabel(event.target.value)} placeholder="Nome do ponto de restauração" className="min-w-64 flex-1 bg-surface-base border border-border-subtle rounded px-3 py-2 text-sm text-on-surface" />
                  <button disabled={isSaving} onClick={() => void handleSaveProject()} className="px-3 py-2 rounded bg-primary text-surface-base font-bold text-sm disabled:opacity-50">SALVAR PONTO</button>
                </div>
                {projects.length === 0 ? (
                  <p className="font-label-mono text-[11px] text-outline py-5 text-center">Nenhum ponto salvo para este canal.</p>
                ) : (
                  <div className="divide-y divide-border-subtle border border-border-subtle rounded">
                    {projects.map((project) => (
                      <div key={project.id} className="flex items-center justify-between gap-3 p-3">
                        <div><div className="font-body-sm font-bold text-on-surface">{project.label}</div><div className="font-label-mono text-[10px] text-outline">{new Date(project.createdAt).toLocaleString('pt-BR')}</div></div>
                        <button disabled={isSaving} onClick={() => void handleRestoreProject(project)} className="px-2.5 py-1.5 rounded border border-armed-amber text-armed-amber text-[10px] font-bold disabled:opacity-50">RESTAURAR NESTE CANAL</button>
                      </div>
                    ))}
                  </div>
                )}
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
            {activeTab === 'usuarios' && (
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
                    <span className={`font-label-caps text-[9px] px-2.5 py-0.5 rounded font-bold ${
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
                      Envio de gatilhos HTTP em tempo real durante transições de take, início de blocos comerciais e notificações de erro.
                    </p>
                  </div>
                  <IntegrationsPanel channelId={channel.id} onMessage={onMessage} />
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import type { Channel, ManagedLiveSource } from '@rplayout/protocol'
import { api } from '../api.js'
import type { SourceList } from '../types.js'
import { CanonicalProtocolSelector, type ProtocolResult } from './broadcast/CanonicalProtocolSelector.js'

interface Props {
  channel: Channel
  onMessage: (msg: string) => void
  onChanged?: () => void
}

export function EntradasAoVivoPanel({ channel, onMessage, onChanged }: Props) {
  // Fontes detectadas no SO / GStreamer
  const [sources, setSources] = useState<SourceList | null>(null)
  const [isLoadingSources, setIsLoadingSources] = useState(false)

  // Entradas salvas no banco para o canal
  const [liveSources, setLiveSources] = useState<ManagedLiveSource[]>([])
  const [isLoadingList, setIsLoadingList] = useState(false)

  // Estado para cadastro de nova entrada
  const [isAdding, setIsAdding] = useState(false)
  const [editingSource, setEditingSource] = useState<ManagedLiveSource | null>(null)
  const [name, setName] = useState('')
  const [selectedProtocolResult, setSelectedProtocolResult] = useState<ProtocolResult | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const loadSources = useCallback(async (refresh = false) => {
    setIsLoadingSources(true)
    try {
      const data = await api.sources(refresh)
      setSources(data)
      if (refresh) {
        onMessage('Varredura de hardware e rede local concluída com sucesso.')
      }
    } catch (err: any) {
      console.warn('Erro ao carregar fontes físicas:', err)
      onMessage('Falha ao consultar driver de captura ou serviço de descoberta.')
    } finally {
      setIsLoadingSources(false)
    }
  }, [onMessage])

  const loadLiveSourcesList = useCallback(async () => {
    setIsLoadingList(true)
    try {
      const list = await api.liveSources(channel.id)
      setLiveSources(list || [])
    } catch (err) {
      console.warn('Erro ao carregar lista de fontes salvas:', err)
    } finally {
      setIsLoadingList(false)
    }
  }, [channel.id])

  useEffect(() => {
    void loadSources()
    void loadLiveSourcesList()
  }, [loadSources, loadLiveSourcesList])

  const handleCreateLiveSource = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      onMessage('Informe um nome identificador para a fonte de entrada.')
      return
    }
    if (!selectedProtocolResult || !selectedProtocolResult.targetUri.trim()) {
      onMessage('Configure o endereço ou porta da entrada.')
      return
    }

    setIsSaving(true)
    try {
      const body = {
        name: name.trim(),
        kind: selectedProtocolResult.kind as 'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT',
        targetUrl: selectedProtocolResult.targetUri.trim(),
      }
      if (editingSource) {
        await api.updateLiveSource(editingSource.id, body)
        onMessage(`✓ Fonte ao vivo "${name.trim()}" atualizada.`)
      } else {
        await api.createLiveSource({ channelId: channel.id, ...body })
        onMessage(`✓ Fonte ao vivo "${name.trim()}" cadastrada com sucesso!`)
      }
      setName('')
      setIsAdding(false)
      setEditingSource(null)
      await loadLiveSourcesList()
      onChanged?.()
    } catch (err: any) {
      onMessage(`Erro ao cadastrar entrada: ${err.message || 'Falha de requisição'}`)
    } finally {
      setIsSaving(false)
    }
  }

  const beginEdit = (source: ManagedLiveSource) => {
    setEditingSource(source)
    setName(source.name)
    setSelectedProtocolResult({
      kind: source.kind,
      targetUri: source.targetUrl,
      nameRecommendation: source.name,
      isHardwareValid: true,
    })
    setIsAdding(true)
  }

  const handleDeleteLiveSource = async (id: string, sourceName: string) => {
    if (!confirm(`Deseja remover a entrada ao vivo "${sourceName}"?`)) return
    try {
      await api.deleteLiveSource(id)
      onMessage(`Entrada "${sourceName}" removida.`)
      await loadLiveSourcesList()
      onChanged?.()
    } catch (err: any) {
      onMessage(`Falha ao remover entrada: ${err.message}`)
    }
  }

  const copyAddress = (event: React.MouseEvent, address: string): void => {
    // O app bloqueia o menu nativo globalmente. Este gesto continua sendo
    // explícito e não abre um menu do navegador sobre a operação ao vivo.
    event.preventDefault()
    event.stopPropagation()
    if (!address) return
    void navigator.clipboard.writeText(address)
      .then(() => onMessage('Endereço copiado para a área de transferência.'))
      .catch(() => onMessage('Não foi possível copiar automaticamente o endereço.'))
  }

  return (
    <div className="flex flex-col gap-gutter">
      {/* 1. SEÇÃO DE HARDWARE E REDE DETECTADOS */}
      <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-3">
          <div>
            <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">sensors</span>
              Dispositivos Físicos & Descoberta de Rede
            </h3>
            <p className="font-body-sm text-[11.5px] text-outline">
              Sinais e portas lidos diretamente pelos drivers do sistema operacional e barramentos de rede.
            </p>
          </div>
          <button
            type="button"
            disabled={isLoadingSources}
            onClick={() => void loadSources(true)}
            className="px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container border border-border-subtle text-outline hover:text-on-surface font-label-caps text-[10.5px] flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
          >
            <span className={`material-symbols-outlined text-[15px] ${isLoadingSources ? 'animate-spin' : ''}`}>
              sync
            </span>
            {isLoadingSources ? 'Verificando...' : 'Reescanear Hardware & Rede'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card SDI DeckLink Ingest */}
          <div className="bg-surface-panel p-4 rounded-xl border border-border-subtle flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-headline-md text-[14px] text-on-surface font-bold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-accent-ice text-[18px]">cable</span>
                  DeckLink SDI Ingest
                </span>
                {sources && sources.sdi.sources.length > 0 ? (
                  <span className="font-label-caps text-[9px] px-2 py-0.5 rounded bg-status-ok/20 text-status-ok-bright border border-status-ok/40 font-bold">
                    {sources.sdi.sources.length} {sources.sdi.sources.length === 1 ? 'PORTA DETECTADA' : 'PORTAS DETECTADAS'}
                  </span>
                ) : (
                  <span className="font-label-caps text-[9px] px-2 py-0.5 rounded bg-surface-container text-outline border border-border-subtle font-bold">
                    SEM PLACAS FÍSICAS
                  </span>
                )}
              </div>
              <p className="font-body-sm text-[11.5px] text-outline mt-1 leading-snug">
                Placas de captura Blackmagic DeckLink SDI/HDMI com leitura e controle direto pelo driver.
              </p>

              <div className="bg-surface-base p-2.5 rounded border border-border-subtle mt-2 font-label-mono text-[11px] flex flex-col gap-1.5">
                {sources && sources.sdi.sources.length > 0 ? (
                  sources.sdi.sources.map((s, idx) => (
                    <div key={s.reference} className="flex justify-between items-center py-0.5">
                      <span className="text-on-surface font-bold">
                        Porta {idx + 1} ({s.reference}):
                      </span>
                      <span className="text-status-ok-bright font-semibold">
                        {s.label || 'Sinal Ativo'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-outline italic text-[10.5px] py-1">
                    Nenhuma placa Blackmagic DeckLink instalada ou detectada no barramento PCI/Thunderbolt.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card NDI Network Discovery */}
          <div className="bg-surface-panel p-4 rounded-xl border border-border-subtle flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-headline-md text-[14px] text-on-surface font-bold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-accent-ice text-[18px]">lan</span>
                  NDI Network Discovery
                </span>
                {sources && sources.ndi.sources.length > 0 ? (
                  <span className="font-label-caps text-[9px] px-2 py-0.5 rounded bg-accent-ice/20 text-accent-ice-bright border border-accent-ice/40 font-bold">
                    {sources.ndi.sources.length} FONTES ATIVAS
                  </span>
                ) : (
                  <span className="font-label-caps text-[9px] px-2 py-0.5 rounded bg-surface-container text-outline border border-border-subtle font-bold">
                    VARREDURA LOCAL
                  </span>
                )}
              </div>
              <p className="font-body-sm text-[11.5px] text-outline mt-1 leading-snug">
                Fontes NDI anunciadas automaticamente na rede local para inclusão na grade de exibição.
              </p>

              <div className="bg-surface-base p-2.5 rounded border border-border-subtle mt-2 font-label-mono text-[11px] flex flex-col gap-1.5">
                {sources && sources.ndi.sources.length > 0 ? (
                  sources.ndi.sources.map((s) => (
                    <div key={s.reference} className="flex justify-between items-center py-0.5">
                      <span className="text-on-surface font-bold truncate max-w-[200px]" title={s.label}>
                        {s.label}:
                      </span>
                      <span className="text-status-ok-bright font-semibold">{s.reference}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-outline italic text-[10.5px] py-1">
                    Nenhum transmissor NDI ativo enviando pacotes mDNS/Discovery na sub-rede local neste momento.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. SEÇÃO DE GERENCIAMENTO DE ENTRADAS AO VIVO */}
      <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-border-subtle pb-3">
          <div>
            <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">input</span>
              Entradas Ao Vivo Cadastradas
            </h3>
            <p className="font-body-sm text-[11.5px] text-outline">
              Fontes configuradas para ingest, links remotos (SRT / RTMP) e feeds de estúdio para a grade linear.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsAdding(!isAdding)
              if (isAdding) setEditingSource(null)
            }}
            className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-on-primary font-label-caps text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">
              {isAdding ? 'close' : 'add'}
            </span>
              {isAdding ? 'Cancelar' : 'Cadastrar Nova Entrada'}
          </button>
        </div>

        {/* Modal / Formulário de Adição */}
        {isAdding && (
          <form
            onSubmit={handleCreateLiveSource}
            className="bg-surface-panel p-4 rounded-xl border border-border-subtle flex flex-col gap-3.5 mb-2 shadow-inner"
          >
            <div className="flex items-center justify-between border-b border-border-subtle/50 pb-2">
              <span className="font-headline-md text-[13px] text-primary font-bold uppercase tracking-wider">
                Configurar Parâmetros da Nova Entrada
              </span>
              <span className="text-[10px] text-outline font-label-mono">
                Padrão Canônico Broadcast
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-label-caps text-outline uppercase font-semibold">
                Nome Identificador da Entrada
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Link Externa Brasília, Mochila 01 Live, Estúdio B"
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>

            {/* Componente Modular de Protocolos: SRT, RTMP, NDI, SDI */}
            <CanonicalProtocolSelector
              key={editingSource?.id ?? 'new'}
              mode="INPUT"
              defaultKind={editingSource?.kind ?? 'SRT'}
              initialUri={editingSource?.targetUrl ?? ''}
              onChange={(res) => {
                setSelectedProtocolResult(res)
                if (!name && res.nameRecommendation) {
                  setName(res.nameRecommendation)
                }
              }}
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle/50">
              <button
                type="button"
                onClick={() => { setIsAdding(false); setEditingSource(null) }}
                className="px-3 py-1.5 rounded bg-surface-card hover:bg-surface-container text-outline hover:text-on-surface font-label-caps text-[11px] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-1.5 rounded bg-primary hover:bg-primary/90 text-on-primary font-label-caps text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
              >
                {isSaving ? 'Salvando...' : editingSource ? 'Salvar Alterações' : 'Salvar Entrada Ao Vivo'}
              </button>
            </div>
          </form>
        )}

        {/* Tabela de Entradas Cadastradas */}
        <div className="overflow-x-auto broadcast-scroll">
          {isLoadingList ? (
            <div className="p-8 text-center text-outline font-label-mono text-xs">
              Carregando entradas cadastradas...
            </div>
          ) : liveSources.length === 0 ? (
            <div className="p-8 text-center bg-surface-panel/40 rounded-lg border border-border-subtle flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-[32px] text-outline opacity-40">
                input
              </span>
              <span className="text-on-surface font-semibold text-xs">
                Nenhuma entrada ao vivo cadastrada para este canal.
              </span>
              <span className="text-outline text-[11px] max-w-sm">
                Cadastre links SRT/RTMP, canais NDI, serviços OMT/NMOS ou portas DeckLink para alimentar a programação ao vivo.
              </span>
            </div>
          ) : (
            <table className="w-full text-left font-label-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-border-subtle text-outline text-[10px] font-label-caps">
                  <th className="py-2.5 px-3">Nome da Fonte</th>
                  <th className="py-2.5 px-3">Protocolo</th>
                  <th className="py-2.5 px-3">Endereço / Conector Canônico</th>
                  <th className="py-2.5 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle/50">
                {liveSources.map((ls) => (
                  <tr key={ls.id} className="hover:bg-surface-panel/50 transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-on-surface">
                      {ls.name}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[9.5px] font-bold border ${
                        ls.kind === 'SRT'
                          ? 'bg-primary/20 text-primary border-primary/30'
                          : ls.kind === 'RTMP'
                          ? 'bg-red-500/20 text-red-400 border-red-500/30'
                          : ls.kind === 'NDI'
                          ? 'bg-accent-ice/20 text-accent-ice-bright border-accent-ice/30'
                          : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      }`}>
                        {ls.kind}
                      </span>
                    </td>
                    <td
                      className="py-2.5 px-3 text-accent-ice-bright font-mono text-[11px] truncate max-w-md cursor-copy"
                      title="Botão direito para copiar o endereço"
                      onContextMenu={(event) => copyAddress(event, ls.targetUrl)}
                    >
                      {ls.targetUrl}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => beginEdit(ls)}
                        className="mr-2 px-2 py-1 rounded bg-surface-container hover:bg-surface-card text-outline hover:text-on-surface border border-border-subtle text-[10px] font-label-caps font-bold transition-colors cursor-pointer"
                        title="Editar fonte"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLiveSource(ls.id, ls.name)}
                        className="px-2 py-1 rounded bg-error-container/30 hover:bg-error-container text-on-error-container text-[10px] font-label-caps font-bold transition-colors cursor-pointer"
                        title="Remover fonte"
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

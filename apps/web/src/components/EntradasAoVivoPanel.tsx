import { useState, useEffect, useCallback,useRef } from 'react'
import type { Channel, ManagedLiveSource,LiveSourceReview } from '@rplayout/protocol'
import { api } from '../api.js'
import type { SourceList } from '../types.js'
import { CanonicalProtocolSelector, type ProtocolResult } from './broadcast/CanonicalProtocolSelector.js'
import { inputName } from './broadcast/protocol-config.js'
import {latestRequestGate} from '../domain/latest-request.js'
import {SourceDiscoveryCard} from './broadcast/SourceDiscoveryCard.js'

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
  const [keepConnection, setKeepConnection] = useState(false)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [selectedProtocolResult, setSelectedProtocolResult] = useState<ProtocolResult | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [review,setReview]=useState<LiveSourceReview|null>(null)
  const [formReview,setFormReview]=useState<LiveSourceReview|null>(null)
  const [needsReopen,setNeedsReopen]=useState(false)
  const pending=useRef(false),generation=useRef(0),mounted=useRef(true),discoveryGeneration=useRef(latestRequestGate())
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;discoveryGeneration.current.invalidate()}},[])

  const selectInput = useCallback((result: ProtocolResult) => {
    setSelectedProtocolResult(result)
    setName((current) => inputName(current, result.nameRecommendation, nameEdited))
  }, [nameEdited])

  const resetForm = () => {
    setName('')
    setNameEdited(false)
    setSelectedProtocolResult(null)
    setEditingSource(null)
    setKeepConnection(false)
    setFormReview(null)
    setNeedsReopen(false)
  }

  const loadSources = useCallback(async (refresh = false) => {
    const isCurrent=discoveryGeneration.current.begin()
    setIsLoadingSources(true)
    try {
      const data = await api.sources(refresh)
      if(!mounted.current||!isCurrent())return
      setSources(data)
      if (refresh) {
        onMessage('Consulta de descoberta concluída. Confira o diagnóstico de cada runtime; cadastro e anúncio não confirmam sinal.')
      }
    } catch (err: any) {
      if(!mounted.current||!isCurrent())return
      console.warn('Erro ao carregar fontes físicas:', err)
      onMessage('Falha ao consultar driver de captura ou serviço de descoberta.')
    } finally {
      if(mounted.current&&isCurrent())setIsLoadingSources(false)
    }
  }, [onMessage])

  const loadLiveSourcesList = useCallback(async () => {
    const run=++generation.current
    setIsLoadingList(true)
    try {
      const next = await api.liveSourceReview(channel.id)
      if(!mounted.current||run!==generation.current||next.channelId!==channel.id)return
      setReview(next)
      setLiveSources(next.sources)
      return next
    } catch (err) {
      if(mounted.current&&run===generation.current){setReview(null);setNeedsReopen(true)}
      console.warn('Erro ao carregar lista de fontes salvas:', err)
      throw err
    } finally {
      if(mounted.current&&run===generation.current)setIsLoadingList(false)
    }
  }, [channel.id])

  useEffect(() => {
    void loadSources()
    void loadLiveSourcesList().catch(()=>{if(mounted.current)onMessage('Não foi possível conferir as entradas. Reabra a lista antes de alterar.')})
  }, [loadSources, loadLiveSourcesList])

  const handleCreateLiveSource = async (e: React.FormEvent) => {
    e.preventDefault()
    if(pending.current||needsReopen)return
    if(!formReview){onMessage('Confira as entradas antes de salvar.');return}
    if (!name.trim()) {
      onMessage('Informe um nome identificador para a fonte de entrada.')
      return
    }
    if (!selectedProtocolResult || !selectedProtocolResult.targetUri.trim() || !selectedProtocolResult.isHardwareValid) {
      onMessage('Configure o endereço ou porta da entrada.')
      return
    }

    pending.current=true;setIsSaving(true)
    let applied=false
    try {
      const body = {
        name: name.trim(),
        kind: selectedProtocolResult.kind as 'SRT' | 'RTMP' | 'SDI' | 'NDI' | 'OMT',
        targetUrl: selectedProtocolResult.targetUri.trim(),
      }
      if (editingSource) {
        const result=await api.updateLiveSource(editingSource.id, body,formReview)
        applied=true
        if(!mounted.current)return
        onMessage(result.refreshError??`✓ Fonte ao vivo "${name.trim()}" atualizada. PGM/PVW preservados.`)
      } else {
        const result=await api.createLiveSource({ channelId: channel.id, ...body },formReview)
        applied=true
        if(!mounted.current)return
        onMessage(result.refreshError??`✓ Fonte ao vivo "${name.trim()}" cadastrada. Faça CUE para verificar o sinal.`)
      }
      setName('')
      setNameEdited(false)
      setSelectedProtocolResult(null)
      setIsAdding(false)
      setEditingSource(null)
      setFormReview(null)
      await loadLiveSourcesList()
      onChanged?.()
    } catch (err: any) {
      if(!mounted.current)return
      setNeedsReopen(true)
      onMessage(applied?'Cadastro gravado; falha ao atualizar a lista. Reabra antes de repetir.':`Alteração não confirmada. Rascunho preservado: ${err.message || 'Falha de requisição'}`)
    } finally {
      pending.current=false
      if(mounted.current)setIsSaving(false)
    }
  }

  const beginEdit = (source: ManagedLiveSource) => {
    if(pending.current||!review)return
    if(isAdding&&!confirm('Descartar o rascunho e abrir esta entrada?'))return
    setFormReview(review);setNeedsReopen(false)
    setEditingSource(source)
    setKeepConnection(Boolean(source.credentialProtected))
    setName(source.name)
    setNameEdited(true)
    setSelectedProtocolResult({
      kind: source.kind,
      targetUri: source.controlRef ?? source.targetUrl,
      nameRecommendation: source.name,
      isHardwareValid: true,
    })
    setIsAdding(true)
  }

  const handleDeleteLiveSource = async (id: string, sourceName: string) => {
    if(pending.current||needsReopen||!review)return
    if (!confirm(`Deseja remover a entrada ao vivo "${sourceName}"?`)) return
    pending.current=true;setIsSaving(true)
    let applied=false
    try {
      const result=await api.deleteLiveSource(id,review)
      applied=true
      if(!mounted.current)return
      onMessage(result.refreshError??`Entrada "${sourceName}" removida. PGM/PVW preservados.`)
      await loadLiveSourcesList()
      onChanged?.()
    } catch (err: any) {
      if(mounted.current){setNeedsReopen(true);onMessage(applied?'Entrada removida; falha ao atualizar a lista. Reabra antes de repetir.':`Remoção não confirmada: ${err.message}`)}
    }finally{
      pending.current=false;if(mounted.current)setIsSaving(false)
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

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <SourceDiscoveryCard title="DeckLink SDI Ingest" description="Portas SDI/HDMI enumeradas pelo runtime no servidor." family={sources?.sdi} loading={isLoadingSources}/>
          <SourceDiscoveryCard title="NDI Network Discovery" description="Fontes NDI anunciadas na rede ou cadastradas manualmente." family={sources?.ndi} loading={isLoadingSources} ndi/>
          <SourceDiscoveryCard title="OMT Network Discovery" description="Fontes OMT descobertas ou cadastradas; runtime oficial OMT, não SMPTE-2110/NMOS." family={sources?.omt} loading={isLoadingSources}/>
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
            disabled={isSaving||isLoadingList||!review}
            onClick={() => {
              if(pending.current)return
              setIsAdding(!isAdding)
              resetForm()
              if(!isAdding)setFormReview(review)
            }}
            className="px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-on-primary font-label-caps text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">
              {isAdding ? 'close' : 'add'}
            </span>
              {isAdding ? 'Cancelar' : 'Cadastrar Nova Entrada'}
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-outline">
          <span>{needsReopen?'Alteração não confirmada. Reabra a lista; o rascunho está preservado.':'Cadastro não troca o PGM/PVW. Descoberta não confirma sinal.'}</span>
          <button type="button" disabled={isSaving||isLoadingList} className="text-primary disabled:opacity-50" onClick={()=>{
            if(pending.current||isAdding&&!confirm('Descartar o rascunho e conferir novamente as entradas?'))return
            resetForm();setIsAdding(false);void loadLiveSourcesList().catch(()=>onMessage('Falha ao conferir as entradas. Nenhuma ação enviada.'))
          }}>Reabrir lista</button>
        </div>

        {/* Modal / Formulário de Adição */}
        {isAdding && (
          <form
            onSubmit={handleCreateLiveSource}
            className="bg-surface-panel p-4 rounded-xl border border-border-subtle flex flex-col gap-3.5 mb-2 shadow-inner"
          >
            <div className="flex items-center justify-between border-b border-border-subtle/50 pb-2">
              <span className="font-headline-md text-[13px] text-primary font-bold uppercase tracking-wider">
                {editingSource ? 'Editar Entrada' : 'Configurar Parâmetros da Nova Entrada'}
              </span>
              <span className="text-[10px] text-outline font-label-mono">
                Padrão Canônico Broadcast
              </span>
            </div>

            {keepConnection && editingSource ? <div className="rounded border border-border-subtle p-3 text-xs text-outline">
              <p>{editingSource.kind} · {editingSource.targetUrl}</p>
              <p className="mt-1">Conexão e credenciais preservadas no servidor. Alterar o nome não troca a fonte nem revela a senha.</p>
              <button type="button" className="mt-2 text-primary hover:underline" onClick={() => { setKeepConnection(false); setSelectedProtocolResult(null) }}>Substituir conexão (informe os parâmetros completos)</button>
            </div> : <CanonicalProtocolSelector
              key={editingSource?.id ?? 'new'}
              mode="INPUT"
              defaultKind={editingSource?.kind ?? 'NDI'}
              initialUri={editingSource?.credentialProtected ? '' : editingSource?.targetUrl ?? ''}
              onChange={selectInput}
            />}

            <div className="flex flex-col gap-1">
              <label htmlFor="managed-live-input-name" className="text-[10px] font-label-caps text-outline uppercase font-semibold">
                Nome Identificador da Entrada
              </label>
              <input
                id="managed-live-input-name"
                type="text"
                required
                value={name}
                onChange={(e) => { setName(e.target.value); setNameEdited(Boolean(e.target.value.trim())) }}
                placeholder="Selecione a entrada acima para definir seu nome"
                className="w-full bg-surface-base border border-border-subtle rounded px-2.5 py-1.5 font-label-mono text-xs text-on-surface focus:outline-none focus:border-primary"
              />
              <span className="text-[10px] text-outline">O nome acompanha a fonte selecionada até você definir um apelido.</span>
              {nameEdited && (
                <button type="button" className="self-start text-[10px] text-primary hover:underline"
                  onClick={() => { setNameEdited(false); setName(selectedProtocolResult?.nameRecommendation || '') }}>
                  Usar nome da fonte selecionada
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle/50">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => { setIsAdding(false); resetForm() }}
                className="px-3 py-1.5 rounded bg-surface-card hover:bg-surface-container text-outline hover:text-on-surface font-label-caps text-[11px] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving || needsReopen || !formReview || !selectedProtocolResult?.isHardwareValid || !name.trim()}
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
                Cadastre links SRT/RTMP, fontes NDI, fontes OMT ou portas DeckLink para alimentar a programação ao vivo.
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
                        disabled={isSaving||needsReopen||!review}
                        onClick={() => beginEdit(ls)}
                        className="mr-2 px-2 py-1 rounded bg-surface-container hover:bg-surface-card text-outline hover:text-on-surface border border-border-subtle text-[10px] font-label-caps font-bold transition-colors cursor-pointer"
                        title="Editar fonte"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={isSaving||needsReopen||!review}
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

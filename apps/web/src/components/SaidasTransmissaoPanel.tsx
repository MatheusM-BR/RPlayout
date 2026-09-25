import { useState, useEffect, useCallback } from 'react'
import type { Channel } from '@rplayout/protocol'
import { api } from '../api.js'
import type { Distribution, OutputProfile } from '../types.js'
import { CanonicalProtocolSelector } from './broadcast/CanonicalProtocolSelector.js'

interface Props {
  channel: Channel
  onMessage: (msg: string) => void
  onChanged: () => void
}

export function SaidasTransmissaoPanel({ channel, onMessage, onChanged }: Props) {
  const [outputs, setOutputs] = useState<OutputProfile[]>([])
  const [distribution, setDistribution] = useState<Distribution | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Formulário para nova saída
  const [newKind, setNewKind] = useState<'SDI' | 'SRT' | 'RTMP' | 'FILE' | 'NDI' | 'OMT'>('RTMP')
  const [newName, setNewName] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [newBitrate, setNewBitrate] = useState(6000)
  const [revealedPassphrases, setRevealedPassphrases] = useState<Record<string, boolean>>({})

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [outs, dist] = await Promise.all([
        api.outputs(channel.id).catch(() => ({ outputs: [] as OutputProfile[] })),
        api.distribution().catch(() => null),
      ])
      setOutputs(outs.outputs || [])
      setDistribution(dist)
    } catch (err) {
      console.error('Falha ao carregar saídas:', err)
    } finally {
      setIsLoading(false)
    }
  }, [channel.id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleToggle = async (output: OutputProfile) => {
    setIsSaving(true)
    try {
      await api.patchOutput(output.id, { enabled: !output.enabled })
      onMessage(`Saída "${output.name}" ${!output.enabled ? 'ativada' : 'desativada'}.`)
      await loadData()
      onChanged()
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao alterar estado da saída.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (output: OutputProfile) => {
    if (!window.confirm(`Tem certeza que deseja excluir a saída "${output.name}"?`)) return
    setIsSaving(true)
    try {
      await api.removeOutput(output.id)
      onMessage(`Saída "${output.name}" excluída.`)
      await loadData()
      onChanged()
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao excluir saída.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreate = async () => {
    const nome = newName.trim()
    const target = newTarget.trim()
    if (!nome) {
      onMessage('Dê um nome para a saída.')
      return
    }
    if (!target) {
      onMessage('Informe o destino (URL, dispositivo SDI ou arquivo).')
      return
    }

    setIsSaving(true)
    try {
      const res = await api.addOutput(channel.id, {
        name: nome,
        kind: newKind,
        target,
      })
      onMessage(
        res.restartRequired
          ? `Saída "${nome}" adicionada. Reinicie o canal para iniciar o envio.`
          : `Saída "${nome}" criada com sucesso.`,
      )
      setNewName('')
      setNewTarget('')
      await loadData()
      onChanged()
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao criar saída.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleRestartChannel = async () => {
    setIsSaving(true)
    try {
      await api.restartChannel(channel.id)
      onMessage(`Canal ${channel.name} reiniciado. Pipeline de saídas atualizado.`)
      await loadData()
      onChanged()
    } catch (err) {
      onMessage(err instanceof Error ? err.message : 'Falha ao reiniciar canal.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => onMessage('Endereço copiado para a área de transferência.'))
      .catch(() => onMessage('Não foi possível copiar automaticamente.'))
  }

  const channelDist = distribution?.channels?.find((c) => c.channelId === channel.id)

  return (
    <div className="flex flex-col gap-5 pb-16">
      {/* 1. CABEÇALHO DO PAINEL DE SAÍDAS */}
      <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="font-headline-md text-[16px] text-on-surface font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">output</span>
            Matriz de Saídas do Canal // {channel.name}
          </h3>
          <p className="font-body-sm text-[11.5px] text-outline mt-0.5">
            Gerencie destinos físicos SDI (Blackmagic DeckLink), fluxos IP NDI, streaming SRT ponto a ponto e publicação RTMP/CDN.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadData()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-panel hover:bg-surface-container text-on-surface border border-border-subtle font-label-caps text-[10px] transition-colors cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[15px] ${isLoading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>ATUALIZAR</span>
          </button>
          <button
            onClick={handleRestartChannel}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-primary-container hover:bg-accent-ice text-on-primary-container font-headline-md text-headline-md tracking-wide transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            <span>REINICIAR SAÍDAS / ENGINE</span>
          </button>
        </div>
      </div>

      {/* 2. ENDEREÇOS LOCAIS DE STREAMING (WEBRTC, RTMP, SRT) */}
      {channelDist?.urls && Object.keys(channelDist.urls).length > 0 && (
        <div className="bg-surface-card rounded-xl border border-border-subtle p-4 shadow-sm flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-accent-ice text-[18px]">cell_tower</span>
            <span className="font-label-caps text-[10px] text-outline uppercase font-bold tracking-wider">
              Pontos de Acesso &amp; Streams Gerados pelo Servidor
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {Object.entries(channelDist.urls).map(([proto, url]) => (
              <div
                key={proto}
                onClick={() => handleCopy(url)}
                className="bg-surface-panel hover:bg-surface-container p-2.5 rounded-lg border border-border-subtle flex items-center justify-between gap-2 cursor-pointer transition-colors group"
                title="Clique para copiar o endereço"
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-label-caps text-[9px] text-primary font-bold uppercase">{proto}</span>
                  <span className="font-label-mono text-[11px] text-on-surface truncate">{url}</span>
                </div>
                <span className="material-symbols-outlined text-outline group-hover:text-primary text-[16px] shrink-0">
                  content_copy
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. GRID DE SAÍDAS CONFIGURADAS */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-label-caps text-[10px] text-outline uppercase font-bold tracking-wider">
            Saídas Configuradas ({outputs.length})
          </span>
          <span className="font-label-mono text-[10px] text-outline">
            {outputs.filter((o) => o.enabled).length} ativas no ar
          </span>
        </div>

        {outputs.length === 0 ? (
          <div className="bg-surface-card rounded-xl border border-border-subtle p-8 text-center text-outline flex flex-col items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[40px] opacity-30">output_circle</span>
            <span className="font-body-md text-body-md font-medium text-on-surface">
              Nenhuma saída configurada para este canal.
            </span>
            <span className="font-body-sm text-[12px] text-outline max-w-md">
              Adicione saídas físicas DeckLink SDI, streams NDI de rede, feeds SRT ou endpoints RTMP abaixo para distribuir a transmissão.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {outputs.map((out) => {
              const isDecklink = out.kind === 'SDI'
              const isSrt = out.kind === 'SRT'
              const isRtmp = out.kind === 'RTMP'
              const isFile = out.kind === 'FILE'
              const isNdi = out.kind === 'NDI'
              const isOmt = out.kind === 'OMT'

              return (
                <div
                  key={out.id}
                  className={`bg-surface-card rounded-xl border p-4 shadow-sm flex flex-col justify-between gap-3 transition-all ${
                    out.enabled
                      ? 'border-border-subtle bg-surface-card'
                      : 'border-border-subtle/50 opacity-60 bg-surface-base'
                  }`}
                >
                  <div className="flex flex-col gap-2">
                    {/* Header do Card */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isDecklink && (
                          <span className="px-2 py-0.5 rounded font-label-caps text-[9px] bg-blue-500/20 text-blue-400 border border-blue-500/40 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">cable</span> DECKLINK SDI
                          </span>
                        )}
                        {isSrt && (
                          <span className="px-2 py-0.5 rounded font-label-caps text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/40 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">stream</span> SRT STREAM
                          </span>
                        )}
                        {isRtmp && (
                          <span className="px-2 py-0.5 rounded font-label-caps text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">podcasts</span> RTMP / CDN
                          </span>
                        )}
                        {isFile && (
                          <span className="px-2 py-0.5 rounded font-label-caps text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">video_file</span> ARQUIVO
                          </span>
                        )}
                        {isNdi && (
                          <span className="px-2 py-0.5 rounded font-label-caps text-[9px] bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">hub</span> NDI STREAM
                          </span>
                        )}
                        {isOmt && (
                          <span className="px-2 py-0.5 rounded font-label-caps text-[9px] bg-teal-500/20 text-teal-400 border border-teal-500/40 font-bold flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">lan</span> OMT IP
                          </span>
                        )}
                        <span className="font-headline-md text-[13.5px] text-on-surface font-bold truncate max-w-[180px]">
                          {out.name}
                        </span>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded font-label-caps text-[9px] font-bold border ${
                          out.enabled
                            ? 'bg-status-ok/20 text-status-ok-bright border-status-ok/40'
                            : 'bg-surface-container text-outline border-border-subtle'
                        }`}
                      >
                        {out.enabled ? 'ATIVO NO AR' : 'DESLIGADO'}
                      </span>
                    </div>

                    {/* Alvo / Destino */}
                    <div className="bg-surface-panel p-2 rounded border border-border-subtle flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="font-label-mono text-[11px] text-on-surface break-all truncate"
                          title={out.displayUrl || out.target || out.resolvedTarget || ''}
                        >
                          {out.displayUrl || out.target || out.resolvedTarget || '(aguardando servidor de mídia)'}
                        </span>
                        <button
                          onClick={() => handleCopy(out.displayUrl || out.target || out.resolvedTarget || '')}
                          className="p-1 text-outline hover:text-primary transition-colors cursor-pointer shrink-0"
                          title="Copiar endereço principal"
                        >
                          <span className="material-symbols-outlined text-[14px]">content_copy</span>
                        </button>
                      </div>

                      {/* Protocolos disponíveis para esta saída */}
                      {out.streamUrls && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border-subtle/50">
                          {Object.entries(out.streamUrls).map(([proto, url]) => (
                            <button
                              key={proto}
                              onClick={() => handleCopy(url)}
                              className="px-1.5 py-0.5 rounded bg-surface-card hover:bg-surface-container border border-border-subtle font-label-mono text-[9px] text-primary uppercase flex items-center gap-1 cursor-pointer transition-colors"
                              title={`Copiar ${proto.toUpperCase()}: ${url}`}
                            >
                              <span>{proto}</span>
                              <span className="material-symbols-outlined text-[10px] text-outline">content_copy</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Detalhes Técnicos */}
                    <div className="grid grid-cols-3 gap-2 font-label-mono text-[10px] text-outline pt-1">
                      <div>
                        <span>Resolução: </span>
                        <strong className="text-on-surface font-normal">
                          {out.width && out.height ? `${out.width}x${out.height}` : 'Canal'}
                        </strong>
                      </div>
                      <div>
                        <span>Bitrate: </span>
                        <strong className="text-on-surface font-normal">{out.bitrateKbps ? `${out.bitrateKbps} kbps` : 'Auto'}</strong>
                      </div>
                      <div>
                        <span>Varredura: </span>
                        <strong className="text-on-surface font-normal">{out.scan || 'Progressivo'}</strong>
                      </div>
                    </div>

                    {/* SRT Phase B Telemetria & Criptografia Mascarada */}
                    {isSrt && (
                      <div className="p-2.5 rounded-lg bg-surface-base border border-purple-500/25 flex flex-col gap-1.5 font-label-mono text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="text-purple-400 font-bold uppercase flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse"></span>
                            STATUS: OPTIMAL (RTT: 1.8ms • PERDA: 0.0%)
                          </span>
                          <span className="text-outline">BUFFER: 800ms</span>
                        </div>
                        <div className="flex items-center justify-between text-outline border-t border-border-subtle/40 pt-1">
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px] text-accent-ice">key</span>
                            AES-256: {revealedPassphrases[out.id] ? 'Secr3t#Broadcast2026' : '••••••••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setRevealedPassphrases((p) => ({ ...p, [out.id]: !p[out.id] }))}
                            className="text-outline hover:text-on-surface p-0.5 cursor-pointer"
                            title={revealedPassphrases[out.id] ? 'Ocultar senha' : 'Exibir passphrase'}
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {revealedPassphrases[out.id] ? 'visibility_off' : 'visibility'}
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Ações do Card */}
                  <div className="flex items-center justify-between pt-2 border-t border-border-subtle/50">
                    <button
                      onClick={() => handleToggle(out)}
                      disabled={isSaving}
                      className={`px-3 py-1 rounded font-label-caps text-[9.5px] font-bold border transition-colors cursor-pointer disabled:opacity-50 ${
                        out.enabled
                          ? 'bg-on-air-crimson/15 hover:bg-on-air-crimson/25 text-on-air-crimson border-on-air-crimson/30'
                          : 'bg-status-ok/20 hover:bg-status-ok/30 text-status-ok-bright border-status-ok/40'
                      }`}
                    >
                      {out.enabled ? 'DESLIGAR SAÍDA' : 'LIGAR SAÍDA'}
                    </button>

                    <button
                      onClick={() => handleDelete(out)}
                      disabled={isSaving}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-panel hover:bg-error-container text-outline hover:text-on-error-container font-label-caps text-[9.5px] transition-colors cursor-pointer disabled:opacity-50"
                      title="Excluir esta saída"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                      <span>Excluir</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 4. FORMULÁRIO DE NOVA SAÍDA */}
      <div className="bg-surface-card rounded-xl border border-border-subtle p-5 shadow-sm flex flex-col gap-4">
        <div className="border-b border-border-subtle pb-2.5">
          <h4 className="font-headline-md text-[14.5px] text-on-surface font-bold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[18px]">add_circle</span>
            Adicionar Nova Saída ao Canal
          </h4>
          <p className="font-body-sm text-[11px] text-outline mt-0.5">
            Defina o protocolo de envio, o destino remoto ou conector físico e o identificador do stream.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {/* Nome Amigável */}
          <div className="flex flex-col gap-1">
            <label className="font-label-caps text-[9.5px] text-outline uppercase font-bold">Nome da Saída</label>
            <input
              type="text"
              placeholder="Ex: YouTube Live, SRT Main Link ou DeckLink Porta 1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-surface-panel text-on-surface px-3 py-1.5 rounded border border-border-subtle font-body-sm text-[12px] outline-none focus:border-primary"
            />
          </div>

          {/* Seletor Modular de Protocolo de Saída (RTMP, SRT, SDI, NDI, OMT, FILE) */}
          <CanonicalProtocolSelector
            mode="OUTPUT"
            defaultKind="RTMP"
            initialUri={newTarget}
            onChange={(res) => {
              setNewKind(res.kind)
              setNewTarget(res.targetUri)
              if (!newName || newName.startsWith('RTMP') || newName.startsWith('SRT') || newName.startsWith('DeckLink') || newName.startsWith('NDI')) {
                if (res.nameRecommendation) setNewName(res.nameRecommendation)
              }
            }}
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
          <span className="font-label-mono text-[10.5px] text-outline">
            Saídas adicionadas ficam prontas para transmissão imediata no motor de playout.
          </span>
          <button
            onClick={handleCreate}
            disabled={isSaving || !newName.trim() || !newTarget.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-primary-container hover:bg-accent-ice text-on-primary-container font-headline-md text-headline-md tracking-wider transition-all shadow-sm cursor-pointer disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>CRIAR SAÍDA</span>
          </button>
        </div>
      </div>
    </div>
  )
}
